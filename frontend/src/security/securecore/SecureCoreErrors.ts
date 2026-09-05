import type { SecureCoreErrorCode } from "./SecureCoreTypes";

export class SecureCoreError extends Error {
  constructor(readonly code: SecureCoreErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SecureCoreError";
  }
}

/** Map internal codes to calm, user-facing wording. Never leak internals to the UI. */
export function userMessageFor(code: SecureCoreErrorCode): string {
  switch (code) {
    case "SC_AUTH_CANCELLED": return "Verification was cancelled.";
    case "SC_AUTH_FAILED": return "Verification didn't succeed. Try again.";
    case "SC_AUTH_UNAVAILABLE": return "Device verification isn't available here.";
    case "SC_DEVICE_IDENTITY_MISSING": return "Apollo needs to set up this device first.";
    case "SC_NATIVE_MODULE_UNAVAILABLE": return "Apollo's secure core is not available in this build.";
    case "SC_TIMEOUT": return "That took too long. Try again.";
    case "SC_ATTESTATION_FAILED":
    case "SC_INTEGRITY_FAILED": return "Apollo couldn't confirm this device's integrity.";
    default: return "Something went wrong in Apollo's secure core.";
  }
}
