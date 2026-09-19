// Security boot boundary tests — invalid production config → blocking safety screen, no protected feature
// initialises, no false "Apollo is guarding" state; valid production config → normal start-up.
// Run: cd frontend && yarn test:boot
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  failClosed, getSecurityBootError, recordSecurityBootError, resetSecurityBootErrorForTests, safeStartCopy, selectFailClosed,
} from "../src/security/securityBoot.ts";
import { SecurityConfigurationError, validateSecurityConfig } from "../src/security/securityConfig.ts";

// Shape of what the app reads from an adapter — kept minimal and local to the test.
interface Adapter { platform: string; getProtectionStatus(): Promise<{ operational: boolean }>; startProtection(): Promise<void> }
const realAdapter: Adapter = {
  platform: "android",
  getProtectionStatus: async () => ({ operational: false }),
  startProtection: async () => {},
};

// The release-build defect that surfaced on the first physical device: production, SecureCore pinned to
// native, but no `HuCentAISecureCore` module exists in the binary.
const PROD_MISSING_SECURECORE = { appEnvironment: "production", secureCoreMode: "native", securityAdapterMode: "native", nativeSecureCoreAvailable: false, nativeSecurityAdapterAvailable: true } as const;
const PROD_VALID = { appEnvironment: "production", secureCoreMode: "mock", securityAdapterMode: "native", nativeSecurityAdapterAvailable: true } as const;

beforeEach(() => resetSecurityBootErrorForTests());

test("invalid production config → boot error recorded, selector returns a fail-closed stand-in (no crash at load)", () => {
  let chosen = 0;
  const adapter = selectFailClosed<Adapter>(() => validateSecurityConfig(PROD_MISSING_SECURECORE), () => { chosen++; return realAdapter; });
  const err = getSecurityBootError();
  assert.ok(err instanceof SecurityConfigurationError, "SecurityConfigurationError is recorded, not thrown");
  assert.match(err.message, /HuCentAI SecureCore native SDK is required but unavailable/);
  assert.equal(chosen, 0, "no protected feature initialises: the real adapter factory never ran");
  assert.notEqual(adapter, realAdapter);
});

test("blocked boot → the stand-in can never yield a protection status, so no 'Apollo is guarding' state can be derived", async () => {
  const err = recordSecurityBootError(new SecurityConfigurationError("test"));
  const adapter = failClosed<Adapter>(err);
  assert.throws(() => adapter.getProtectionStatus(), (e: unknown) => e === err);
  assert.throws(() => adapter.startProtection(), (e: unknown) => e === err);
  // Not a thenable — awaiting it must not hang or resolve to a status.
  const awaited = await Promise.resolve(adapter);
  assert.equal(awaited, adapter);
  assert.equal("operational" in adapter, false);
});

test("first error wins; later errors do not overwrite the root cause shown to the person", () => {
  const first = recordSecurityBootError(new SecurityConfigurationError("first"));
  recordSecurityBootError(new Error("second"));
  assert.equal(getSecurityBootError(), first);
});

test("blocking screen copy names the cause and never claims protection", () => {
  const err = new SecurityConfigurationError("HuCentAI SecureCore native SDK is required but unavailable. Use an EAS build that includes the native module.");
  const copy = safeStartCopy(err);
  assert.equal(copy.title, "Apollo can't start safely.");
  assert.equal(copy.reason, "HuCentAI SecureCore native SDK is required but unavailable. Use an EAS build that includes the native module.");
  for (const line of Object.values(copy)) {
    assert.doesNotMatch(line, /guarding|protecting you|is protecting|patrolling/i, `no false protection claim in: ${line}`);
  }
  assert.match(copy.meaning, /Nothing is being watched, checked or blocked/);
});

test("valid production config → normal start-up: real adapter selected, no boot error", () => {
  const adapter = selectFailClosed<Adapter>(() => validateSecurityConfig(PROD_VALID), () => realAdapter);
  assert.equal(adapter, realAdapter);
  assert.equal(getSecurityBootError(), null);
});

test("valid production config but native Apollo Security Adapter missing → still blocked (live control is never weakened)", () => {
  selectFailClosed<Adapter>(() => validateSecurityConfig({ ...PROD_VALID, nativeSecurityAdapterAvailable: false }), () => realAdapter);
  assert.match(getSecurityBootError()?.message ?? "", /Apollo native security module is required but unavailable/);
});
