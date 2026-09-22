import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("candidate has one Apollo-owned runtime and excludes the frozen Expo owner", () => {
  const pkg = JSON.parse(read("../package.json"));
  assert.deepEqual(pkg.expo.autolinking.android.exclude, ["guarddog-expo-module"]);
  const native = read("../modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogCandidateRuntime.kt");
  assert.match(native, /GuardDogVpnRuntime\.reporter = reporter/);
  assert.match(native, /GuardDogSDKEngine/);
  assert.doesNotMatch(native, /GuardDogExpoModule/);
  const module = read("../modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt");
  assert.match(module, /ApolloGuardDogProcessOwner\.get\(ctx\)/);
  assert.doesNotMatch(module, /OnCreate \{ guardDogCandidate =/);
});

test("native correlation uses the original reporter evidence and never substitutes event time or port", () => {
  const native = read("../modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogCandidateRuntime.kt");
  assert.match(native, /original\.destinationPort/);
  assert.match(native, /original\.ipProtocol/);
  assert.match(native, /original\.observedAtEpochMillis/);
  assert.match(native, /original\.enforcementEvidenceId/);
  assert.doesNotMatch(native, /destinationPort\s*\?:\s*443/);
  assert.doesNotMatch(native, /event\.occurredAt/);
  assert.match(native, /acceptanceRunId/);
  assert.match(native, /acceptanceProbeId/);
  assert.match(native, /protectionSessionId/);
  assert.match(native, /historicalIds/);
});

test("production defaults to the single Apollo-owned GuardDog runtime while acceptance stays test-only", () => {
  const eas = JSON.parse(read("../eas.json"));
  assert.equal(eas.build.production.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE, "guarddog_production");
  assert.equal(eas.build["app-bundle"].env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE, "guarddog_production");
  assert.equal(eas.build["guarddog-acceptance"].env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE, "guarddog_acceptance");
  const config = read("../src/security/securityConfig.ts");
  assert.match(config, /appEnvironment === "production" && androidEnforcementEngine !== "guarddog_production"/);
  const runtime = read("../modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogCandidateRuntime.kt");
  assert.match(runtime, /requireAcceptanceEnabled\(\)/);
  assert.match(runtime, /app\.apollo\.guarddog\.acceptanceEnabled/);
  assert.match(runtime, /apollo-stage1d-acceptance-ed25519-001/);
  assert.doesNotMatch(runtime, /ccf41NL6VHYQsH171Lw98hKiIoQFvAY0t171X4PL\/ac=/);
});

test("fixture provisioner never writes the private key and verifies endpoint/key ownership inputs", () => {
  const script = read("../scripts/provision_guarddog_acceptance.py");
  assert.match(script, /GUARDDOG_ACCEPTANCE_PRIVATE_KEY_PKCS8_B64/);
  assert.match(script, /GUARDDOG_ENDPOINT_OWNERSHIP_FILE/);
  assert.match(script, /resolved != \[ipv4\]/);
  assert.match(script, /public_raw/);
  assert.doesNotMatch(script, /write_(text|bytes)\(private/);
});

test("candidate record cannot claim a build or Pixel acceptance before artifacts exist", () => {
  const record = read("../../docs/STAGE1D_CANDIDATE_RECORD.md");
  assert.match(record, /Exact build source SHA \| \*\*PENDING/);
  assert.match(record, /Android build identifier \| \*\*NOT CREATED/);
  assert.match(record, /APK SHA-256 \| \*\*NOT CREATED/);
  assert.match(record, /Pixel run ID \| \*\*NOT RUN/);
  assert.match(record, /observes a packet and intentionally drops it/);
});