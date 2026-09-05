// NativeSecureCore — the future bridge to the HuCentAI SecureCore Swift/Kotlin SDK.
// This file is the integration boundary for the native security developer.
// It currently expects an Expo native module named "HuCentAISecureCore" exposing
// the methods below (each returning a JSON string). Nothing here invents native
// behaviour: if the module is missing, every call fails closed.

import { requireOptionalNativeModule } from "expo-modules-core";

import type { HuCentAISecureCore } from "../HuCentAISecureCore";
import { SecureCoreError } from "../SecureCoreErrors";
import { SecureCoreLogger } from "../SecureCoreLogger";
import type {
  AttestationResult, AuthenticationResult, DecryptionResult, DeviceIdentity, EncryptionResult, SecurityCapabilities, SecurityStatus,
  SignatureResult, VerificationResult,
} from "../SecureCoreTypes";

interface NativeSecureCoreModule {
  initialize(): Promise<void>;
  getSecurityCapabilities(): Promise<string>;
  createDeviceIdentity(): Promise<string>;
  deleteDeviceIdentity(): Promise<void>;
  authenticate(reason: string): Promise<string>;
  signPayload(payload: string): Promise<string>;
  verifySignature(payload: string, signature: string): Promise<string>;
  encrypt(data: string): Promise<string>;
  decrypt(data: string): Promise<string>;
  getAttestation(): Promise<string>;
  getSecurityStatus(): Promise<string>;
}

export function isNativeSecureCoreAvailable(): boolean {
  try {
    return requireOptionalNativeModule<NativeSecureCoreModule>("HuCentAISecureCore") != null;
  } catch {
    return false;
  }
}

class NativeSecureCoreImpl implements HuCentAISecureCore {
  readonly implementation = "HuCentAI SecureCore (native)";

  private mod(): NativeSecureCoreModule {
    const m = requireOptionalNativeModule<NativeSecureCoreModule>("HuCentAISecureCore");
    if (!m) {
      SecureCoreLogger.log("Native module unavailable");
      throw new SecureCoreError("SC_NATIVE_MODULE_UNAVAILABLE", "HuCentAI SecureCore native SDK is required but unavailable.");
    }
    return m;
  }
  private async json<T>(p: Promise<string>): Promise<T> { return JSON.parse(await p) as T; }

  async initialize() { await this.mod().initialize(); SecureCoreLogger.log("SecureCore initialized", { implementation: "native" }); }
  getSecurityCapabilities() { return this.json<SecurityCapabilities>(this.mod().getSecurityCapabilities()); }
  getDeviceIdentity() { return this.json<DeviceIdentity>(this.mod().createDeviceIdentity()); }
  createDeviceIdentity() { return this.json<DeviceIdentity>(this.mod().createDeviceIdentity()); }
  deleteDeviceIdentity() { return this.mod().deleteDeviceIdentity(); }
  authenticate(reason = "Confirm it's you") { return this.json<AuthenticationResult>(this.mod().authenticate(reason)); }
  signPayload(payload: string) { return this.json<SignatureResult>(this.mod().signPayload(payload)); }
  verifySignature(payload: string, signature: string) { return this.json<VerificationResult>(this.mod().verifySignature(payload, signature)); }
  encrypt(data: string) { return this.json<EncryptionResult>(this.mod().encrypt(data)); }
  decrypt(data: string) { return this.json<DecryptionResult>(this.mod().decrypt(data)); }
  getAttestation() { return this.json<AttestationResult>(this.mod().getAttestation()); }
  getSecurityStatus() { return this.json<SecurityStatus>(this.mod().getSecurityStatus()); }
}

export const NativeSecureCore: HuCentAISecureCore = new NativeSecureCoreImpl();
