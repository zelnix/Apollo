// Selectable mock scenarios. Development/test only.

export const MOCK_SCENARIOS = [
  "NORMAL",
  "BIOMETRIC_SUCCESS", "BIOMETRIC_FAILED", "BIOMETRIC_CANCELLED", "BIOMETRIC_UNAVAILABLE",
  "DEVICE_IDENTITY_MISSING", "DEVICE_IDENTITY_CREATED",
  "KEY_UNAVAILABLE", "HARDWARE_KEY_UNAVAILABLE",
  "SIGNING_SUCCESS", "SIGNING_FAILED",
  "ENCRYPTION_SUCCESS", "ENCRYPTION_FAILED", "DECRYPTION_FAILED",
  "ATTESTATION_SUCCESS", "ATTESTATION_FAILED", "DEVICE_INTEGRITY_FAILED",
  "SECURECORE_UNAVAILABLE",
  "TIMEOUT", "UNKNOWN_ERROR",
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

let current: MockScenario = "NORMAL";
const listeners = new Set<(s: MockScenario) => void>();

export const MockScenarioEngine = {
  get(): MockScenario { return current; },
  set(s: MockScenario) { current = s; listeners.forEach((l) => l(s)); },
  subscribe(l: (s: MockScenario) => void) { listeners.add(l); return () => listeners.delete(l); },
};
