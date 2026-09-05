// Safe development logging. Only event names and coarse metadata.
// NEVER pass keys, tokens, credentials, payloads or decrypted data here.

const SAFE_EVENTS = new Set([
  "SecureCore initialized", "Capabilities read", "Device identity created", "Device identity deleted",
  "Authentication requested", "Authentication succeeded", "Authentication failed", "Authentication cancelled",
  "Payload signed", "Signing failed", "Signature verified", "Signature invalid", "Data encrypted", "Encryption failed",
  "Data decrypted", "Decryption failed", "Attestation requested", "Attestation succeeded", "Attestation failed",
  "Security status read", "Scenario changed", "Native module unavailable",
]);

export type SafeEvent = string;

const listeners = new Set<(entry: { at: string; event: string; meta?: Record<string, string | number | boolean> }) => void>();

export const SecureCoreLogger = {
  log(event: SafeEvent, meta?: Record<string, string | number | boolean>) {
    if (!SAFE_EVENTS.has(event)) return; // unknown events are dropped to avoid accidental leaks
    const entry = { at: new Date().toISOString(), event, meta };
    if (__DEV__) console.log(`[SecureCore] ${event}`, meta ?? "");
    listeners.forEach((l) => l(entry));
  },
  subscribe(listener: (entry: { at: string; event: string; meta?: Record<string, string | number | boolean> }) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
