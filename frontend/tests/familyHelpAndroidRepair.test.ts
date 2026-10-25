// Family Help Android restoration, stage 1 (repairs while the module stays unlinked on Android).
// These read the native sources, so they run anywhere (CI included) without an Android toolchain; the state
// logic itself is also unit-tested on the JVM (modules/apollo-family-assist/android/src/test).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const KOTLIN_DIR = "modules/apollo-family-assist/android/src/main/java/app/apollo/familyassist/";
const kotlin = Object.fromEntries(readdirSync(new URL(KOTLIN_DIR, root)).filter((f) => f.endsWith(".kt")).map((f) => [f, read(KOTLIN_DIR + f)]));
const allKotlin = Object.values(kotlin).join("\n");
// Code only: Kotlin comments may name the things the code must not do.
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("startup crash: no null-rejecting ConcurrentHashMap holds Family Help state", () => {
  assert.doesNotMatch(code(allKotlin), /ConcurrentHashMap/);
  assert.match(kotlin["FamilyAssistState.kt"], /data class FamilyAssistState\(/);
  assert.match(kotlin["FamilyAssistState.kt"], /fun toMap\(\): HashMap<String, Any\?>/);
  // Nothing outside the store writes state directly.
  assert.doesNotMatch(code(allKotlin), /state\[\s*"/);
  assert.doesNotMatch(code(allKotlin), /state\.put(All)?\(/);
});

test("WebRTC is initialised in one place and every factory has one owner that disposes it", () => {
  for (const [file, source] of Object.entries(kotlin)) {
    if (file === "FamilyAssistWebRtc.kt") continue;
    assert.doesNotMatch(code(source), /PeerConnectionFactory\.initialize/, `${file} initialises WebRTC`);
    assert.doesNotMatch(code(source), /createPeerConnectionFactory\(/, `${file} builds its own factory`);
  }
  assert.equal((code(kotlin["FamilyAssistWebRtc.kt"]).match(/PeerConnectionFactory\.initialize\(/g) ?? []).length, 1);
  const peer = code(kotlin["FamilyAssistRtcPeer.kt"]);
  assert.match(peer, /private val factory: PeerConnectionFactory = FamilyAssistWebRtc\.createFactory\(context\)/);
  assert.match(peer, /factory\.dispose\(\)/);
  assert.match(peer, /peer\?\.dispose\(\)/);
  assert.match(peer, /source\?\.dispose\(\)/);
  // The sharer's screen track comes from the session's own factory, not a second one in the service.
  assert.match(peer, /fun createScreenSource\(\): VideoSource/);
  assert.match(code(kotlin["FamilyAssistProjectionService.kt"]), /createScreenSource\(\)/);
});

test("renderer updates happen on the main thread and frames never go to a missing view", () => {
  const peer = code(kotlin["FamilyAssistRtcPeer.kt"]);
  assert.doesNotMatch(peer, /\.visibility\s*=/, "the peer must not touch a view from its threads");
  assert.doesNotMatch(allKotlin, /addSink\(FamilyAssistRenderer\.view\)/);
  assert.match(peer, /addSink\(FamilyAssistRenderer\)/);
  const view = code(kotlin["FamilyAssistViewerView.kt"]);
  assert.match(view, /internal object FamilyAssistRenderer : VideoSink/);
  assert.match(view, /Handler\(Looper\.getMainLooper\(\)\)/);
  assert.match(view, /override fun onAttachedToWindow\(\)[\s\S]*renderer\.init\(/);
  assert.match(view, /override fun onDetachedFromWindow\(\)[\s\S]*FamilyAssistRenderer\.detach\(renderer\)[\s\S]*renderer\.release\(\)/);
});

test("stale sessions are fenced: every state change names its session and generation", () => {
  for (const file of ["FamilyAssistRtcPeer.kt", "FamilyAssistProjectionService.kt"]) {
    for (const call of code(kotlin[file]).match(/FamilyAssistRuntime\.update\([^)]*/g) ?? []) {
      assert.match(call, /^FamilyAssistRuntime\.update\(sessionId, generation, /, `${file}: ${call}`);
    }
  }
  const store = code(kotlin["FamilyAssistState.kt"]);
  assert.match(store, /if \(!now\.owns\(sessionId, generation\)\) return false/);
  const peer = code(kotlin["FamilyAssistRtcPeer.kt"]);
  assert.match(peer, /messageGeneration != generation\) return/);
  assert.match(code(kotlin["ApolloFamilyAssistModule.kt"]), /if \(viewer !== peer\) return/);
});

test("signaling callbacks cannot crash the app", () => {
  const peer = code(kotlin["FamilyAssistRtcPeer.kt"]);
  assert.match(peer, /override fun onMessage[\s\S]*?try \{[\s\S]*?handle\(JSONObject\(text\)\)[\s\S]*?catch \(error: Exception\)/);
  assert.match(peer, /catch \(_: RejectedExecutionException\)/);
  assert.match(peer, /override fun onFailure\(webSocket: WebSocket/);
  // The sharer only sends termination reasons the signaling server accepts.
  const backend = readFileSync(new URL("../../backend/services/family_assist/signaling.py", import.meta.url), "utf8");
  const accepted = backend.match(/message\.get\("reason"\) not in \{([^}]*)\}/)![1].match(/"([a-z_]+)"/g)!.map((s) => s.replaceAll('"', "")).sort();
  const wire = peer.match(/WIRE_REASONS = setOf\(([^)]*)\)/)![1].match(/"([a-z_]+)"/g)!.map((s) => s.replaceAll('"', "")).sort();
  assert.deepEqual(wire, accepted);
});

test("the capture is stopped before the peer disposes its source", () => {
  const service = code(kotlin["FamilyAssistProjectionService.kt"]);
  const stop = service.slice(service.indexOf("private fun stopOwned"));
  const order = ["capturer?.stopCapture()", "capturer?.dispose()", "textureHelper?.dispose()", "peer?.terminate(reason)"].map((step) => stop.indexOf(step));
  assert.ok(order.every((i) => i >= 0), "every teardown step is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "teardown order");
  assert.match(stop, /if \(stopped\) return/);
});

test("WebRTC dependency lives inside the Family Help module and matches the iOS release", () => {
  const gradle = read("modules/apollo-family-assist/android/build.gradle");
  assert.doesNotMatch(code(gradle), /react-native-webrtc/);
  assert.match(gradle, /implementation 'org\.jitsi:webrtc:124\.0\.0'/);
  assert.match(gradle, /testImplementation 'junit:junit:/);
  assert.match(read("modules/apollo-family-assist/ios/ApolloFamilyAssist.podspec"), /s\.dependency 'JitsiWebRTC', '~> 124\.0\.0'/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies?.["react-native-webrtc"], undefined, "no app-wide WebRTC dependency");
});

test("JVM regression checks cover construction, empty state, stop/failure and stale fencing", () => {
  const tests = read("modules/apollo-family-assist/android/src/test/java/app/apollo/familyassist/FamilyAssistStateTest.kt");
  for (const name of ["constructing the store at startup does not throw", "the empty state crosses the bridge with its nulls intact", "stop and failure end the session", "a stale session or generation cannot change the current one"]) {
    assert.ok(tests.includes(name), name);
  }
});

test("activation (step 6): Family Help is linked into Android builds again, and still into iOS builds", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(!(pkg.expo.autolinking.android?.exclude ?? []).includes("apollo-family-assist"), "Android links the module");
  assert.ok(!(pkg.expo.autolinking.ios?.exclude ?? []).includes("apollo-family-assist"), "iOS links the module");
  // The generated-project check now expects exactly one Android link and the projection service in the merged manifest.
  assert.match(read("scripts/verify-generated-projects.mjs"), /familyAssistLinks !== \(familyAssistExcluded \? 0 : 1\)/);
  assert.match(read("modules/apollo-family-assist/android/src/main/AndroidManifest.xml"), /FamilyAssistProjectionService/);
});

test("signaling messages leave in sequence order and relay expiry times parse on every Android version", () => {
  const peer = code(kotlin["FamilyAssistRtcPeer.kt"]);
  assert.doesNotMatch(peer, /fun envelope[^\n]*sequence/, "numbering happens at send time, not when the message is built");
  assert.match(peer, /private fun send\(body: JSONObject\) \{\s*synchronized\(sendLock\) \{[\s\S]*?body\.put\("sequence", sequence\.getAndIncrement\(\)\)/);
  // Instant.parse rejects the server's "+00:00" offset before Android 14.
  assert.doesNotMatch(peer, /Instant\.parse\(/);
  assert.match(peer, /OffsetDateTime\.parse\(relay\.getString\("expiresAt"\)\)/);
});
