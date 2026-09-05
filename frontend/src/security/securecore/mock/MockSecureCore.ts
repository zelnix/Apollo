// MockSecureCore — DEVELOPMENT/TEST ONLY. Implements HuCentAISecureCore with
// simulated responses. Contains NO real cryptography and must never ship as
// the production implementation (see SecureCore.ts fail-closed rule).

import * as Crypto from "expo-crypto";

import { storage } from "@/src/utils/storage";
import type { HuCentAISecureCore } from "../HuCentAISecureCore";
import { SecureCoreError } from "../SecureCoreErrors";
import { SecureCoreLogger } from "../SecureCoreLogger";
import type {
  AttestationResult, AuthenticationResult, DecryptionResult, DeviceIdentity, EncryptionResult, SecurityCapabilities, SecurityStatus,
  SignatureResult, VerificationResult,
} from "../SecureCoreTypes";
import { MockScenarioEngine, type MockScenario } from "./MockSecureCoreScenarios";

export const MOCK_SECURECORE_LABEL = "MOCK SecureCore — not real security";
const IDENTITY_KEY = "apollo.securecore.mock.identity";
const MOCK_PREFIX = "mock:";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class MockSecureCoreImpl implements HuCentAISecureCore {
  readonly implementation = MOCK_SECURECORE_LABEL;
  private initialized = false;
  private identity: DeviceIdentity | null = null;

  /** Developer control. Not exposed in production builds (see dev-tools screen gating). */
  setScenario(s: MockScenario) { MockScenarioEngine.set(s); SecureCoreLogger.log("Scenario changed", { scenario: s }); }
  getScenario() { return MockScenarioEngine.get(); }

  private scenario() { return MockScenarioEngine.get(); }
  private async gate() {
    const s = this.scenario();
    if (s === "SECURECORE_UNAVAILABLE") throw new SecureCoreError("SC_NATIVE_MODULE_UNAVAILABLE");
    if (s === "TIMEOUT") { await delay(1500); throw new SecureCoreError("SC_TIMEOUT"); }
    if (s === "UNKNOWN_ERROR") throw new SecureCoreError("SC_UNKNOWN");
    if (!this.initialized) throw new SecureCoreError("SC_NOT_INITIALIZED");
  }

  async initialize() {
    if (this.scenario() === "SECURECORE_UNAVAILABLE") throw new SecureCoreError("SC_NATIVE_MODULE_UNAVAILABLE");
    const stored = await storage.getItem<string | null>(IDENTITY_KEY, null);
    this.identity = stored ? (JSON.parse(stored) as DeviceIdentity) : null;
    this.initialized = true;
    SecureCoreLogger.log("SecureCore initialized", { implementation: "mock" });
  }

  async getSecurityCapabilities(): Promise<SecurityCapabilities> {
    await this.gate();
    const s = this.scenario();
    SecureCoreLogger.log("Capabilities read");
    return {
      biometricsAvailable: s !== "BIOMETRIC_UNAVAILABLE",
      hardwareBackedKeysAvailable: s !== "HARDWARE_KEY_UNAVAILABLE" && s !== "KEY_UNAVAILABLE",
      secureStorageAvailable: true,
      deviceAttestationAvailable: s !== "ATTESTATION_FAILED",
      platform: "mock",
    };
  }

  async createDeviceIdentity(): Promise<DeviceIdentity> {
    await this.gate();
    if (this.scenario() === "KEY_UNAVAILABLE" || this.scenario() === "HARDWARE_KEY_UNAVAILABLE") throw new SecureCoreError("SC_KEY_UNAVAILABLE");
    if (this.identity && this.scenario() !== "DEVICE_IDENTITY_CREATED") return this.identity;
    const id: DeviceIdentity = { deviceId: Crypto.randomUUID(), publicKey: `${MOCK_PREFIX}pub:${Crypto.randomUUID()}`, createdAt: new Date().toISOString() };
    this.identity = id;
    await storage.setItem(IDENTITY_KEY, JSON.stringify(id));
    SecureCoreLogger.log("Device identity created");
    return id;
  }

  async deleteDeviceIdentity() {
    await this.gate();
    this.identity = null;
    await storage.removeItem(IDENTITY_KEY);
    SecureCoreLogger.log("Device identity deleted");
  }

  async authenticate(): Promise<AuthenticationResult> {
    await this.gate();
    SecureCoreLogger.log("Authentication requested");
    await delay(300);
    switch (this.scenario()) {
      case "BIOMETRIC_FAILED": SecureCoreLogger.log("Authentication failed"); return { success: false, method: "mock", errorCode: "SC_AUTH_FAILED" };
      case "BIOMETRIC_CANCELLED": SecureCoreLogger.log("Authentication cancelled"); return { success: false, method: "mock", errorCode: "SC_AUTH_CANCELLED" };
      case "BIOMETRIC_UNAVAILABLE": return { success: false, method: "mock", errorCode: "SC_AUTH_UNAVAILABLE" };
      default: SecureCoreLogger.log("Authentication succeeded"); return { success: true, method: "mock" };
    }
  }

  async signPayload(payload: string): Promise<SignatureResult> {
    await this.gate();
    if (this.scenario() === "DEVICE_IDENTITY_MISSING" || !this.identity) return { success: false, errorCode: "SC_DEVICE_IDENTITY_MISSING" };
    if (this.scenario() === "SIGNING_FAILED") { SecureCoreLogger.log("Signing failed"); return { success: false, errorCode: "SC_SIGNING_FAILED" }; }
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${this.identity.publicKey}|${payload}`);
    SecureCoreLogger.log("Payload signed");
    return { success: true, signature: `${MOCK_PREFIX}sig:${digest}` }; // NOT a real signature
  }

  async verifySignature(payload: string, signature: string): Promise<VerificationResult> {
    await this.gate();
    if (!this.identity) return { valid: false, errorCode: "SC_DEVICE_IDENTITY_MISSING" };
    const expected = await this.signPayload(payload);
    const valid = expected.success && expected.signature === signature;
    SecureCoreLogger.log(valid ? "Signature verified" : "Signature invalid");
    return { valid };
  }

  async encrypt(data: string): Promise<EncryptionResult> {
    await this.gate();
    if (this.scenario() === "ENCRYPTION_FAILED") { SecureCoreLogger.log("Encryption failed"); return { success: false, errorCode: "SC_ENCRYPTION_FAILED" }; }
    SecureCoreLogger.log("Data encrypted");
    return { success: true, encryptedData: `${MOCK_PREFIX}enc:${encodeBase64(data)}` }; // obfuscation only, NOT encryption
  }

  async decrypt(data: string): Promise<DecryptionResult> {
    await this.gate();
    if (this.scenario() === "DECRYPTION_FAILED" || !data.startsWith(`${MOCK_PREFIX}enc:`)) { SecureCoreLogger.log("Decryption failed"); return { success: false, errorCode: "SC_DECRYPTION_FAILED" }; }
    SecureCoreLogger.log("Data decrypted");
    return { success: true, data: decodeBase64(data.slice(`${MOCK_PREFIX}enc:`.length)) };
  }

  async getAttestation(): Promise<AttestationResult> {
    await this.gate();
    SecureCoreLogger.log("Attestation requested");
    if (this.scenario() === "ATTESTATION_FAILED") { SecureCoreLogger.log("Attestation failed"); return { success: false, platform: "mock", errorCode: "SC_ATTESTATION_FAILED" }; }
    if (this.scenario() === "DEVICE_INTEGRITY_FAILED") { SecureCoreLogger.log("Attestation failed"); return { success: false, platform: "mock", errorCode: "SC_INTEGRITY_FAILED" }; }
    SecureCoreLogger.log("Attestation succeeded");
    return { success: true, platform: "mock", token: `${MOCK_PREFIX}attest:${Crypto.randomUUID()}` };
  }

  async getSecurityStatus(): Promise<SecurityStatus> {
    const s = this.scenario();
    SecureCoreLogger.log("Security status read");
    return {
      secureCoreAvailable: s !== "SECURECORE_UNAVAILABLE" && this.initialized,
      deviceIdentityExists: !!this.identity && s !== "DEVICE_IDENTITY_MISSING",
      integrityVerified: s !== "DEVICE_INTEGRITY_FAILED" && s !== "ATTESTATION_FAILED",
      lastCheckedAt: new Date().toISOString(),
      implementation: MOCK_SECURECORE_LABEL,
    };
  }
}

function encodeBase64(s: string) {
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(s)));
  return s;
}
function decodeBase64(s: string) {
  if (typeof atob === "function") return decodeURIComponent(escape(atob(s)));
  return s;
}

export const MockSecureCore = new MockSecureCoreImpl();
