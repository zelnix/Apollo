// HuCentAI SecureCore — public interface. The application depends on this
// contract only. Implementations: mock/MockSecureCore (dev) and
// native/NativeSecureCore (Swift/Kotlin bridge, built by the security developer).

import type {
  AttestationResult, AuthenticationResult, DecryptionResult, DeviceIdentity, EncryptionResult, SecurityCapabilities, SecurityStatus,
  SignatureResult, VerificationResult,
} from "./SecureCoreTypes";

export interface HuCentAISecureCore {
  initialize(): Promise<void>;
  getSecurityCapabilities(): Promise<SecurityCapabilities>;
  createDeviceIdentity(): Promise<DeviceIdentity>;
  deleteDeviceIdentity(): Promise<void>;
  authenticate(reason?: string): Promise<AuthenticationResult>;
  signPayload(payload: string): Promise<SignatureResult>;
  verifySignature(payload: string, signature: string): Promise<VerificationResult>;
  encrypt(data: string): Promise<EncryptionResult>;
  decrypt(data: string): Promise<DecryptionResult>;
  getAttestation(): Promise<AttestationResult>;
  getSecurityStatus(): Promise<SecurityStatus>;
}
