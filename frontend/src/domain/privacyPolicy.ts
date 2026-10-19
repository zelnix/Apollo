/**
 * Canonical Privacy Classification Policy.
 *
 * ONE source of truth for what is a credential, what is PII, what is financial,
 * what is medical, and what is a sender/investigation-subject identifier.
 *
 * Every enforcement point (egress, image screening, text redaction) imports from
 * this file. No separate regex sets are maintained elsewhere.
 *
 * Architecture rule: a fact can appear in many places, but Apollo should
 * decide that fact in only one place.
 */

// ── Classification tiers ─────────────────────────────────────────────────────

export type SensitiveType = "credential" | "pii" | "financial" | "medical" | "sender_identifier";

export interface SensitiveDetection {
  match: string;
  type: SensitiveType;
  startIndex: number;
}

// ── Credential patterns — MANDATORY redaction, never relaxed ─────────────────

export const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; type: "credential" }> = [
  { pattern: /(?:password|passcode|p\.?i\.?n\.?)\s*(?:is|was|:|=)\s*\S+/i, type: "credential" },
  { pattern: /\b(?:otp|one[- ]?time[- ]?code|verification[- ]?code|security[- ]?code|recovery[- ]?code)\s*(?:is|was|:|=)\s*\S+/i, type: "credential" },
  { pattern: /\b\d{4,8}\s+is\s+your\s+(?:verification|security|one[- ]?time|login|sign[- ]?in)\s+code\b/i, type: "credential" },
  { pattern: /your\s+(?:\w+\s+)?(?:verification|security|one[- ]?time|login|sign[- ]?in)\s+(?:code|otp|pin)\s+(?:is|was|:|=)\s*\d{4,8}\b/i, type: "credential" },
  { pattern: /(?:verification|security|one[- ]?time|sign[- ]?in)\s+code[:\s]+\d{4,8}\b/i, type: "credential" },
  { pattern: /\b(?:recovery[- ]?phrase|seed[- ]?phrase|mnemonic)\b/i, type: "credential" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/i, type: "credential" },
  { pattern: /(?:api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token)\s*(?::|=)\s*\S+/i, type: "credential" },
  { pattern: /(?:https?:\/\/)[^\s/@]+:[^\s/@]+@/i, type: "credential" },
  { pattern: /[?&](?:(?:access|refresh|auth|api)[_-]?)?(?:token|password|secret|key|code|session)=[^\s&#"']+/i, type: "credential" },
  { pattern: /\b(?:code|otp|pin)\s*[:=]?\s*\d{4,8}\b/i, type: "credential" },
];

// ── Financial / medical patterns — strongly protected ────────────────────────

export const FINANCIAL_MEDICAL_PATTERNS: Array<{ pattern: RegExp; type: "financial" | "medical" }> = [
  { pattern: /\b(?:\d[ -]?){13,19}\b/, type: "financial" },
  { pattern: /\b\d{3}[- ]?\d{3}[- ]?\d{6,10}\b/, type: "financial" },
  { pattern: /\b\d{4}\s?\d{5}\s?\d{1}\b/, type: "medical" },
  { pattern: /\bTFN\s*[:=]?\s*\d{3}\s?\d{3}\s?\d{2,3}\b/i, type: "financial" },
];

// ── Phone / email patterns — context-dependent ───────────────────────────────

export const PHONE_PATTERN = /(?<![0-9])\+?\d[\d\s().-]{7,}\d(?![0-9])/;
export const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

// ── Sender context patterns ──────────────────────────────────────────────────

export const SENDER_CONTEXT_PATTERNS: RegExp[] = [
  /(?:^|\n)\s*(?:from|sender|reply[- ]?to|sent\s+by|contact|callback)\s*[:]\s*/i,
  /(?:^|\n)\s*\+?\d[\d\s().-]{7,}\d\s*$/m,
  /(?:^|\n)\s*from\s*:\s*[^\n]*@/im,
  /(?:message|sms|text|call|missed call)\s+from\s+/i,
  /received\s+(?:a\s+)?(?:message|sms|text|call|email)\s+from\s+/i,
];

// ── Egress fields that the sanitisation pipeline intentionally produces ──────
// Only these fields may be added to endpoint allow-lists for sanitisation metadata.
// Adding a field here is a policy decision — do not add fields without review.

export const SANITISATION_EGRESS_FIELDS = [
] as const;

// ── Screening context ───────────────────────────────────────────────────────

/**
 * Source context passed into detection to inform classification.
 * This does NOT create a separate processing path — it adjusts how
 * phone numbers and emails are classified within the single engine.
 */
export interface ScreeningContext {
  purpose: "message_screenshot" | "investigation_evidence" | "page_screenshot";
  blockIndex?: number;
  totalBlocks?: number;
}
