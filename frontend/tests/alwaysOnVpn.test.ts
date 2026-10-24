// Always-on VPN: Android must reach exactly one VpnService entry point — Apollo's starter — and the
// certified GuardDog engine must stay byte-identical.
// Run: node --test tests/alwaysOnVpn.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { applySingleVpnEntryPoint, GUARDDOG_VPN_SERVICE_ATTRIBUTES } = require("../plugins/withGuardDogEngine.js");
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const CERTIFIED_VPN_MANIFEST = "packages/guarddog-android-sdk/guarddog-vpn/src/main/AndroidManifest.xml";
const APOLLO_MANIFEST = "modules/apollo-security/android/src/main/AndroidManifest.xml";
const KOTLIN = "modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity";

function serviceBlock(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<service[^>]*android:name="${name.replace(/\./g, "\\.")}"[\\s\\S]*?</service>`));
  assert.ok(match, `${name} must be declared`);
  return match![0];
}
const attr = (block: string, key: string) => block.match(new RegExp(`${key}="([^"]*)"`))?.[1];

test("the certified GuardDog source is untouched (every file still matches the Stage 1B SHA-256 manifest)", () => {
  const manifest = readFileSync(new URL("../../docs/APOLLO_STAGE1B_SHA256_MANIFEST.txt", import.meta.url), "utf8");
  let checked = 0;
  for (const line of manifest.split("\n")) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\.\/(\S+)$/);
    if (!m) continue;
    const bytes = readFileSync(new URL(`../packages/${m[2]}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), m[1], `certified file changed: ${m[2]}`);
    checked++;
  }
  assert.ok(checked >= 90, `expected the full certified manifest, checked ${checked}`);
});

test("the app manifest replaces the certified VPN service with the identical declaration minus its filter", () => {
  const certified = serviceBlock(read(CERTIFIED_VPN_MANIFEST), "com.guarddog.vpn.GuardDogVpnService");
  // The certified one carries the system action — which is why the replacement is needed.
  assert.match(certified, /<action android:name="android\.net\.VpnService"/);
  for (const [key, value] of Object.entries(GUARDDOG_VPN_SERVICE_ATTRIBUTES)) {
    assert.equal(attr(certified, key), value, `replacement must keep the certified ${key}`);
  }

  const app = { manifest: { $: {}, application: [{ $: {}, service: [{ $: { "android:name": "com.other.Service" } }] }] } };
  applySingleVpnEntryPoint(app);
  applySingleVpnEntryPoint(app); // idempotent across repeated prebuilds
  assert.equal(app.manifest.$["xmlns:tools"], "http://schemas.android.com/tools");
  const replaced = app.manifest.application[0].service.filter((s: { $: Record<string, string> }) => s.$["android:name"] === "com.guarddog.vpn.GuardDogVpnService");
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].$["tools:node"], "replace");
  assert.equal((replaced[0] as Record<string, unknown>)["intent-filter"], undefined, "the replacement must not carry the VpnService action");
  assert.equal(app.manifest.application[0].service.length, 2, "other services are left alone");
});

test("Apollo's starter is the one component answering Android's VpnService request", () => {
  const xml = read(APOLLO_MANIFEST);
  const starter = serviceBlock(xml, "com.hucentai.apollosecurity.ApolloAlwaysOnVpnStarter");
  assert.match(starter, /<action android:name="android\.net\.VpnService"/);
  assert.equal(attr(starter, "android:permission"), "android.permission.BIND_VPN_SERVICE");
  assert.equal(attr(starter, "android:exported"), "false");
  // Exactly one VpnService action across Apollo's own manifests.
  assert.equal((xml.match(/android:name="android\.net\.VpnService"/g) ?? []).length, 1);
  // Always-on must not be declared unsupported.
  assert.doesNotMatch(xml, /SUPPORTS_ALWAYS_ON/);
});

test("the starter rebuilds protection from saved rules, idempotently, and records every outcome", () => {
  const starter = read(`${KOTLIN}/ApolloAlwaysOnVpnStarter.kt`);
  assert.match(starter, /awaitPhysicalDns\(/);
  assert.match(starter, /startForSystemRequest\(\)/);
  assert.match(starter, /stopSelf\(startId\)/);
  assert.match(starter, /START_NOT_STICKY/);

  const runtime = read(`${KOTLIN}/ApolloGuardDogProductionRuntime.kt`);
  const body = runtime.slice(runtime.indexOf("fun startForSystemRequest"), runtime.indexOf("fun awaitPhysicalDns"));
  assert.match(body, /if \(actualOperational\(\)\)/, "a request while running must not start a second tunnel");
  assert.match(body, /checkNotNull\(config\)/, "never starts without the saved configuration");
  assert.match(body, /check\(ruleBundleCurrent\(\)\)/, "never starts without current, validated rules");
  assert.match(body, /recordSystemStart\("failed"/);
  // The failure is reported, never hidden, and Always-on/lockdown are read only while the tunnel is up.
  assert.match(runtime, /Android asked Apollo to reconnect its protection \(Always-on VPN\) and it couldn't/);
  assert.match(runtime, /\.put\("alwaysOn", alwaysOn\)\.put\("lockdown", lockdown\)\.put\("systemStart", systemStartJson\(\)\)/);
  assert.match(runtime, /if \(operational\) ApolloVpnSystemState\.lockdown\(\)/);
});

test("a network change only stops a tunnel that exists", () => {
  const runtime = read(`${KOTLIN}/ApolloGuardDogProductionRuntime.kt`);
  const body = runtime.slice(runtime.indexOf("private fun onNetworkDnsChanged"), runtime.indexOf("fun resumeRequested"));
  assert.match(body, /if \(state\.current\(\)\.state in setOf\(ProtectionState\.STARTING, ProtectionState\.ACTIVE\)\) stopLocked\(clearIntent = false\)/);
});

test("Private DNS is read from the physical network, never Apollo's own tunnel", () => {
  const runtime = read(`${KOTLIN}/ApolloGuardDogProductionRuntime.kt`);
  const body = runtime.slice(runtime.indexOf("fun privateDnsStatus"), runtime.indexOf("// ── Urgent rule refresh"));
  assert.match(body, /NET_CAPABILITY_NOT_VPN/);
  assert.doesNotMatch(body, /\.activeNetwork\b/, "must not read the default (possibly Apollo's own VPN) network");
  assert.match(body, /PrivateDnsTruth\.mode\(/);
  assert.match(body, /Build\.VERSION_CODES\.P/, "LinkProperties' Private DNS reads need Android 9");
  const truth = read(`${KOTLIN}/PrivateDnsTruth.kt`);
  // Only a provider hostname bypasses Apollo; Automatic never does.
  assert.match(truth, /HOSTNAME -> "confirmed"/);
});
