// HuCentAI SecureCore — public TypeScript types. Stable contract for the
// future Swift/Kotlin SDK. Keep simple; extend only additively.

export type SecureCorePlatform = "ios" | "android" | "mock";

export type SecurityCapabilities = {
  biometricsAvailable: boolean;
  hardwareBackedKeysAvailable: boolean;
  secureStorageAvailable: boolean;
  deviceAttestationAvailable: boolean;
  platform: SecureCorePlatform;
};

export type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  createdAt: string;
};

export type AuthenticationMethod = "face" | "fingerprint" | "device_credential" | "mock";

export type AuthenticationResult = {
  success: boolean;
  method: AuthenticationMethod;
  errorCode?: SecureCoreErrorCode;
};

export type SignatureResult = { success: boolean; signature?: string; errorCode?: SecureCoreErrorCode };
export type VerificationResult = { valid: boolean; errorCode?: SecureCoreErrorCode };
export type EncryptionResult = { success: boolean; encryptedData?: string; errorCode?: SecureCoreErrorCode };
export type DecryptionResult = { success: boolean; data?: string; errorCode?: SecureCoreErrorCode };

export type AttestationResult = {
  success: boolean;
  token?: string;
  platform: SecureCorePlatform;
  errorCode?: SecureCoreErrorCode;
};

export type SecurityStatus = {
  secureCoreAvailable: boolean;
  deviceIdentityExists: boolean;
  integrityVerified: boolean;
  lastCheckedAt: string;
  /** Visible implementation label, e.g. "MOCK SecureCore". Never hide this. */
  implementation: string;
};

export type SecureCoreErrorCode =
  | "SC_NOT_INITIALIZED"
  | "SC_AUTH_FAILED"
  | "SC_AUTH_CANCELLED"
  | "SC_AUTH_UNAVAILABLE"
  | "SC_DEVICE_IDENTITY_MISSING"
  | "SC_KEY_UNAVAILABLE"
  | "SC_SIGNING_FAILED"
  | "SC_ENCRYPTION_FAILED"
  | "SC_DECRYPTION_FAILED"
  | "SC_ATTESTATION_FAILED"
  | "SC_INTEGRITY_FAILED"
  | "SC_NATIVE_MODULE_UNAVAILABLE"
  | "SC_TIMEOUT"
  | "SC_UNKNOWN";
