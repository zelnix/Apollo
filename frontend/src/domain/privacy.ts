import { domainOnly, packetFields, evidenceToken } from './packetEvidence.ts';
// Data egress policy, enforced in code. Every outbound payload passes through
// `enforceEgress` which rejects anything outside the allow-list.
// User-submitted content may leave the device only for the disclosed, one-off assessment the user
// requested. It must not be copied into Patrol payloads, logs, analytics, or background monitoring.

export type EgressEndpoint = "intel_check" | "patrol_sync" | "trust_sync" | "ask_apollo" | "higgins_chat" | "higgins_context" | "device_register" | "family" | "push_register" | "push_test" | "device_settings" | "message_check" | "message_extract" | "link_investigation" | "feedback" | "page_extract" | "page_crawl" | "gmail_scan" | "gmail_monitor" | "app_check" | "account_check" | "breach_check" | "voice" | "call_risk_check" | "investigation";

const ALLOWED_KEYS: Record<EgressEndpoint, Set<string>> = {
  family: new Set(["device_id", "email", "name", "owner_name", "code", "reply", "phone", "protected_device_id", "scent_id", "headline", "state", "events", "steps", "done", "note", "resolved", "kind", "text", "from_name", "enabled", "preview_only", "guardian_name", "duration_s", "submission_id"]),
  intel_check: new Set(["indicator_type", "value", "values", "device_id", "expand"]),
  // Shared investigation case (spec §8): opaque IDs, the person's question/message, explicitly submitted items and a device profile — never credentials.
  investigation: new Set(["gate", "question", "submissions", "initialFindingRefs", "initialFindings", "deviceProfile", "expectedRevision", "turnId", "message", "answerToQuestionId", "evidenceIds", "clientItemId", "parentId", "kind", "text", "url", "label", "deviceResult", "requestId", "caseRevision", "capabilityId", "status", "observedAt", "values", "simulation", "target", "device", "deviceResultIds", "responseRevision", "section", "filename", "mediaType", "declaredBytes", "expectedField", "expectedValue", "confirmed", "submissionId", "sourceKey", "revisionDigest", "sender", "capturedAt", "expiresAt", "contentComplete", "originalCharacters"]),
  // Higgins' voice: only the sentence already shown on screen, so it can be read aloud.
  voice: new Set(["device_id", "text", "scope_id"]),
  feedback: new Set(["device_id", "event_id", "kind", "state", "host", "sources", "note"]),
  patrol_sync: new Set([
    "event_id", "device_id", "category", "state", "status", "headline", "what_happened", "why", "what_to_do", "case_id",
    "indicator_host", "indicator_digest", "verified_block", "adapter_label", "occurred_at", "resolved_at", "background", "claimed_brand", "scenario", "scent_id", "enforcement_evidence", "supporting_references", "recovery_kinds",
  ]),
  trust_sync: new Set(["device_id", "indicator_type", "indicator_digest", "indicator_host", "event_id", "trust_id"]),
  ask_apollo: new Set(["device_id", "message", "context", "handoff_id", "conversation_id", "turn_id"]),
  higgins_chat: new Set(["message", "conversationId"]),
  higgins_context: new Set(["category", "summary", "provenance", "observedAt"]),
  device_register: new Set(["platform", "adapter_mode", "app_version", "tz_offset_minutes"]),
  // Alert notifications: the push token is an opaque delivery address (FCM/APNs), relayed and not stored by us.
  push_register: new Set(["platform", "provider", "projectId", "device_token"]),
  push_test: new Set(["device_id"]),
  // Gate 2: message text + URLs leave the device only when the user taps "Check message" (shown as "Shared with Apollo for analysis").
  message_check: new Set(["device_id", "sender", "text", "urls", "local_state", "scenario", "signals", "claimed_brand", "second_opinion"]),
  message_extract: new Set(["device_id"]),
  link_investigation: new Set(["device_id", "url", "local_state", "local_findings", "claimed_brand"]),
  page_extract: new Set(["device_id", "url_hint"]),
  // Gate 3 Phase C: only the link itself — Apollo fetches that page server-side and discards the
  // raw content once turned into short signals (see routers/analysis.py page_crawl, services/webcrawl.py).
  page_crawl: new Set(["device_id", "url"]),
  // Gmail read-only connect (Gate 1 add-on): only device_id — the scan itself is triggered here,
  // but the actual message fetch happens entirely on the backend against Google's API using the
  // stored OAuth token; no email content is ever part of this request body.
  gmail_scan: new Set(["device_id"]),
  gmail_monitor: new Set(["device_id", "enabled"]),
  // Gate 7: only the app's name/developer/source/purpose/permission *labels* and SDK-reported hosts — never an app inventory.
  app_check: new Set(["device_id", "name", "developer", "source", "purpose", "permissions", "hosts", "local_state", "scenario", "second_opinion"]),
  // Gate 8: alert text leaves the device only when the user taps "Check this alert"; the breach lookup sends the identifier the user typed, nothing else.
  account_check: new Set(["device_id", "kind", "provider", "sender", "text", "urls", "local_state", "scenario", "second_opinion"]),
  breach_check: new Set(["device_id", "identifier"]),
  // Quiet hours window (local minutes + UTC offset) so the server can hold growling pushes at night.
  device_settings: new Set(["quiet_hours"]),
  // Call Guard (Gate 4 add-on): only the number itself (+ optional 2-letter country for local
  // numbers) leaves the device, only when the person taps "Check this number" or a call rings with
  // no local block/allow/risk signal — see backend/services/phonerisk.py (IPQualityScore, proxied).
  call_risk_check: new Set(["device_id", "number", "country"]),
};

/** Keys that must never appear in any outbound payload, regardless of endpoint. */
const FORBIDDEN_KEYS = new Set(["local_indicator", "contacts", "messages", "sms", "email_body", "page_content", "clipboard", "location", "imei", "serial", "phone_number", "advertising_id"]);
const NON_SECRET_WORDS = new Set(["reset", "change", "changed", "request", "requested", "prompt", "field", "link", "page", "screen", "required", "with", "without", "from", "using", "manager", "management", "sharing", "protection", "protected", "never", "should", "must"]);

export function redactUserSecrets(value: string): string {
  return redactInvestigationSecrets(value)
    .replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, '[ip address]')
    .replace(/\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi, '[ip address]');
}

/** Private investigation evidence may retain relevant identifiers; durable Patrol does not. */
export function redactInvestigationSecrets(value: string): string {
  return value.replace(/\b(password|passcode|p\.?i\.?n\.?|otp|one[- ]time(?: security)? code|verification code|security code|recovery code|username|login id)\b(\s*(?:is|was|:|=)\s*|\s+)([A-Za-z0-9!@#$%^&*_.+\-/]{3,96})/gi,
    (full, label: string, joiner: string, secret: string) => NON_SECRET_WORDS.has(secret.toLowerCase()) && !/[:=]/.test(joiner) ? full : `${label}${joiner}[redacted]`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:(?:access|refresh|auth|api)[_-]?)?(?:token|password|secret|key|code|session|signature)=)[^\s&#"']+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@');
}

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
  if (endpoint === 'message_check' || endpoint === 'account_check') {
    if (typeof out.text !== 'string' || typeof out.sender !== 'string') throw new EgressViolation(endpoint, 'submission types');
    out.text = redactInvestigationSecrets(out.text);
    out.urls = Array.isArray(out.urls) ? out.urls.map(u => purposeLimitedUrl(String(u))) : [];
  }
  if (endpoint === 'link_investigation') {
    out.url = purposeLimitedUrl(String(out.url ?? ''));
    if (!Array.isArray(out.local_findings) || out.local_findings.length > 12 || out.local_findings.some((value) => typeof value !== 'string' || value.length > 160)) {
      throw new EgressViolation(endpoint, 'local_findings');
    }
  }
  if (endpoint === 'intel_check') {
    if (typeof out.value === 'string') out.value = out.indicator_type === 'domain' ? new URL(minimalIndicator(out.value)).hostname : minimalIndicator(out.value);
    if (Array.isArray(out.values)) out.values = out.values.map(v => minimalIndicator(String(v)));
  }
  if (endpoint === 'patrol_sync') {
    const ev = out.enforcement_evidence as Record<string, unknown> | null | undefined;
    if (ev) validateEvidence(ev, out);
    if (out.category === 'call' && (ev || out.verified_block || out.state === 'biting' || out.indicator_host)) throw new EgressViolation(endpoint, 'call packet claim');
    if (out.indicator_host != null && !domainOnly(out.indicator_host)) throw new EgressViolation(endpoint, 'indicator_host');
    for (const key of ['headline', 'what_happened', 'what_to_do', 'adapter_label']) {
      if (typeof out[key] !== 'string' || /https?:\/\/|[+@]|\b\d[\d ()-]{6,}\d/.test(out[key] as string)) throw new EgressViolation(endpoint, key);
    }
    if (!Array.isArray(out.why) || out.why.some(w => typeof w !== 'string' || w.length > 160)) throw new EgressViolation(endpoint, 'why');
    if (out.supporting_references === undefined) out.supporting_references = [];
    if (!Array.isArray(out.supporting_references) || out.supporting_references.length > 6 || out.supporting_references.some((ref) => {
      if (!ref || typeof ref !== 'object') return true;
      const item = ref as Record<string, unknown>;
      return typeof item.label !== 'string' || item.label.length > 100 || typeof item.url !== 'string' ||
        !item.url.startsWith('https://') || /[?#@]/.test(item.url) || item.url.length > 500;
    })) throw new EgressViolation(endpoint, 'supporting_references');
    const category = String(out.category);
    if (!['link', 'website', 'connection', 'known_threat', 'protection', 'system', 'message', 'call', 'app', 'device', 'account', 'email'].includes(category)) throw new EgressViolation(endpoint, 'category');
    for (const key of ['event_id', 'device_id', 'scent_id']) if (out[key] != null && !evidenceToken(out[key])) throw new EgressViolation(endpoint, key);
    out.headline = ev ? 'Apollo observed a blocked connection' : `Apollo recorded a ${category} check`;
    out.what_happened = ev ? 'An observed packet was intentionally blocked by the on-device filter.' : 'A local assessment was recorded. Details stay on the device.';
    out.why = [ev ? 'Packet-backed enforcement evidence is attached.' : 'Only a minimal security summary is shared.'];
    out.what_to_do = 'Review the original alert on your phone. A past check does not establish current safety.';
    out.claimed_brand = null;
    out.scenario = typeof out.scenario === 'string' && /^[A-Z]{1,3}\d{1,3}[a-z]?$/.test(out.scenario) ? out.scenario : null;
    out.adapter_label = 'Apollo on-device assessment';
  }
  if (endpoint === 'family' && Array.isArray(out.events)) {
    out.headline = 'Shared Apollo security incident';
    out.events = out.events.map((v: Record<string, unknown>) => ({ event_id: v.event_id, category: v.category,
      state: v.state, headline: 'Security check — review with the protected person', occurred_at: v.occurred_at, status: v.status }));
    if (Array.isArray(out.steps)) out.steps = out.steps.map((v: Record<string, unknown>) => ({ id: v.id, text: 'Review this recovery step on the protected phone together.' }));
  }
  if (endpoint === 'ask_apollo') {
    if (typeof out.message !== 'string' || out.message.length > 262144) throw new EgressViolation(endpoint, 'message');
    out.message = redactInvestigationSecrets(out.message);
    if (out.handoff_id != null && (typeof out.handoff_id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(out.handoff_id))) throw new EgressViolation(endpoint, 'handoff_id');
    if (out.conversation_id == null) out.conversation_id = 'general';
    if (typeof out.conversation_id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(out.conversation_id)) throw new EgressViolation(endpoint, 'conversation_id');
    if (out.context != null) out.context = validateAskContext(out.context);
  }
  return out as T;
}

const ASK_CONTEXT_KEYS = new Set(['gate', 'issue_summary', 'assessment_state', 'findings', 'uncertainty', 'confirmed_protective_actions', 'user_reported_actions', 'available_actions']);
const ASK_FINDING_KEYS = new Set(['summary', 'provenance', 'status']);
const ASK_ACTION_KEYS = new Set(['label', 'instruction']);
const ASK_GATES = new Set(['site', 'link', 'text', 'call', 'network', 'account', 'email', 'app', 'file', 'device', 'incident']);
const ASK_STATES = new Set(['sniffing', 'resting', 'ears_up', 'growling', 'barking', 'biting', 'unknown']);
function validateAskContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EgressViolation('ask_apollo', 'context');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !ASK_CONTEXT_KEYS.has(key)) || !ASK_GATES.has(String(raw.gate)) || !ASK_STATES.has(String(raw.assessment_state))) throw new EgressViolation('ask_apollo', 'context');
  const cleanLine = (line: unknown, max = 180) => {
    if (typeof line !== 'string' || !line.trim() || line.length > max) throw new EgressViolation('ask_apollo', 'context');
    return redactInvestigationSecrets(line.trim());
  };
  const lines = (key: string, limit: number) => {
    const items = raw[key] ?? [];
    if (!Array.isArray(items) || items.length > limit) throw new EgressViolation('ask_apollo', `context.${key}`);
    return items.map((line) => cleanLine(line));
  };
  const findings = raw.findings ?? [];
  if (!Array.isArray(findings) || findings.length > 8) throw new EgressViolation('ask_apollo', 'context.findings');
  const actions = raw.available_actions ?? [];
  if (!Array.isArray(actions) || actions.length > 4) throw new EgressViolation('ask_apollo', 'context.available_actions');
  return {
    gate: raw.gate,
    issue_summary: cleanLine(raw.issue_summary, 240),
    assessment_state: raw.assessment_state,
    findings: findings.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EgressViolation('ask_apollo', 'context.findings');
      const finding = value as Record<string, unknown>;
      if (Object.keys(finding).some((key) => !ASK_FINDING_KEYS.has(key)) || !['observed', 'inferred', 'user_reported'].includes(String(finding.provenance)) || !['confirmed', 'warning', 'uncertain'].includes(String(finding.status))) throw new EgressViolation('ask_apollo', 'context.findings');
      return { summary: cleanLine(finding.summary), provenance: finding.provenance, status: finding.status };
    }),
    uncertainty: lines('uncertainty', 6),
    confirmed_protective_actions: lines('confirmed_protective_actions', 4),
    user_reported_actions: lines('user_reported_actions', 6),
    available_actions: actions.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EgressViolation('ask_apollo', 'context.available_actions');
      const action = value as Record<string, unknown>;
      if (Object.keys(action).some((key) => !ASK_ACTION_KEYS.has(key))) throw new EgressViolation('ask_apollo', 'context.available_actions');
      return { label: cleanLine(action.label, 80), instruction: cleanLine(action.instruction, 240) };
    }),
  };
}

const EVIDENCE_KEYS = new Set(['evidence_id', 'event_id', 'device_id', 'platform', 'os_version', 'sdk_version', 'observed_at', 'mechanism', 'direction', 'protocol', 'destination_ip', 'destination_domain', 'destination_port', 'app_id', 'process_name', 'attribution_confidence', 'matched_rule_id', 'threat_id', 'requested_action', 'enforced_action', 'result', 'rule_source', 'confidence', 'correlation_id']);
function validateEvidence(ev: Record<string, unknown>, event: Record<string, unknown>) {
  for (const key of Object.keys(ev)) if (!EVIDENCE_KEYS.has(key)) throw new EgressViolation('patrol_sync', `enforcement_evidence.${key}`);
  for (const key of ['os_version', 'sdk_version', 'destination_ip', 'app_id', 'process_name', 'threat_id', 'correlation_id']) if (ev[key] != null) throw new EgressViolation('patrol_sync', `enforcement_evidence.${key}`);
  if (!packetFields(ev as any) || (ev.event_id != null && (ev.event_id !== event.event_id || !evidenceToken(ev.event_id))) ||
    (ev.device_id != null && ev.device_id !== event.device_id) || Date.parse(String(ev.observed_at)) !== Date.parse(String(event.occurred_at))) throw new EgressViolation('patrol_sync', 'enforcement_evidence');
}

/** Reduce a URL to the minimal indicator we are willing to send for reputation checks. */
export function minimalIndicator(normalizedUrl: string): string {
  const u = new URL(normalizedUrl.includes('://') ? normalizedUrl : `https://${normalizedUrl}`);
  if (!['http:', 'https:'].includes(u.protocol)) throw new EgressViolation('intel_check', 'scheme');
  u.username = "";
  u.password = "";
  u.hash = "";
  u.search = '';
  u.pathname = '/'; // origin-only: paths can contain private document IDs and reset tokens too
  return u.toString();
}

/** Preserve the submitted path/context while stripping credentials, fragments and secret query values. */
export function purposeLimitedUrl(normalizedUrl: string): string {
  const u = new URL(normalizedUrl.includes('://') ? normalizedUrl : `https://${normalizedUrl}`);
  if (!['http:', 'https:'].includes(u.protocol)) throw new EgressViolation('message_check', 'scheme');
  u.username = '';
  u.password = '';
  u.hash = '';
  const secret = /token|code|otp|auth|session|password|pass|secret|key|signature|sig/i;
  for (const key of [...u.searchParams.keys()]) if (secret.test(key)) u.searchParams.set(key, '[redacted]');
  return u.toString();
}

export const PRIVACY_POLICY_SUMMARY = [
  "Links you check are analysed on your device first.",
  "When you tap Check, the submitted text, sender and links are processed for that assessment. Credentials, fragments and secret query values are removed before sending.",
  "Submitted screenshots are processed only for the requested assessment and Apollo closes request-scoped upload copies after success or failure.",
  "Background notification access, mailbox connections and ongoing monitoring require separate opt-in. Automatic notification checks remain local unless you enable a supported connection.",
  "Patrol keeps the assessment summary and safe supporting references, not full messages, screenshots, files or sensitive tokens.",
  "Ask Higgins conversation content and generated speech are encrypted temporarily, for no more than 15 minutes. Clear temporary history invalidates them; provider-side retention follows your Gemini account policy.",
  "Apollo uses an anonymous device ID. No account, no email. A phone number is shared only if you choose to add one so family can call you.",
  "Ask Higgins sends only your question and, if you choose, a short event summary.",
  "Hear Higgins reads the displayed explanation in temporary protected audio sections. It uses the owner's Gemini account, not a different AI provider.",
];
