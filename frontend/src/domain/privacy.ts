// Data egress policy, enforced in code. Every outbound payload passes through
// `enforceEgress` which rejects anything outside the allow-list.
// Raw personal content (page text, messages, contacts, photos, identifiers
// beyond the anonymous device id) never leaves the device.

export type EgressEndpoint = "intel_check" | "patrol_sync" | "trust_sync" | "ask_apollo" | "device_register";

const ALLOWED_KEYS: Record<EgressEndpoint, Set<string>> = {
  intel_check: new Set(["indicator_type", "value", "values", "device_id"]),
  patrol_sync: new Set([
    "event_id", "device_id", "category", "state", "status", "headline", "what_happened", "why", "what_to_do",
    "indicator_host", "indicator_digest", "verified_block", "adapter_label", "occurred_at", "resolved_at",
  ]),
  trust_sync: new Set(["device_id", "indicator_type", "indicator_digest", "indicator_host", "event_id", "trust_id"]),
  ask_apollo: new Set(["device_id", "message", "context"]),
  device_register: new Set(["device_id", "platform", "adapter_mode", "app_version"]),
};

/** Keys that must never appear in any outbound payload, regardless of endpoint. */
const FORBIDDEN_KEYS = new Set(["local_indicator", "contacts", "messages", "sms", "email_body", "page_content", "clipboard", "location", "imei", "serial", "phone_number", "advertising_id"]);

export class EgressViolation extends Error {
  constructor(endpoint: EgressEndpoint, key: string) {
    super(`Privacy policy blocked field "${key}" from leaving the device (${endpoint}).`);
    this.name = "EgressViolation";
  }
}

export function enforceEgress<T extends Record<string, unknown>>(endpoint: EgressEndpoint, payload: T): T {
  const allowed = ALLOWED_KEYS[endpoint];
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) throw new EgressViolation(endpoint, key);
    out[key] = payload[key];
  }
  return out as T;
}

/** Reduce a URL to the minimal indicator we are willing to send for reputation checks. */
export function minimalIndicator(normalizedUrl: string): string {
  const u = new URL(normalizedUrl);
  u.username = "";
  u.password = "";
  u.hash = "";
  return u.toString();
}

export const PRIVACY_POLICY_SUMMARY = [
  "Links you check are analysed on your device first.",
  "Only the link itself (no page content, no messages) is sent for reputation checks, stripped of credentials and fragments.",
  "Patrol sync stores event summaries and the website domain only. The full link stays on your device.",
  "Apollo uses an anonymous device ID. No account, no email, no phone number.",
  "Ask Apollo sends only your question and, if you choose, a short event summary.",
];
