/**
 * On-device Image Privacy — Pure Detection & Redaction Functions
 *
 * Contains ONLY the text-analysis logic that runs in any JS environment.
 * No native module dependencies. Testable in Node.js test runner.
 *
 * The native-dependent functions (OCR, metadata stripping, image manipulation)
 * are in imagePrivacy.ts which imports from this file.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SensitiveDetection {
  match: string;
  type: "credential" | "pii" | "financial" | "medical";
  startIndex: number;
}

export interface TextRegion {
  text: string;
  frame: { x: number; y: number; width: number; height: number };
  isSensitive: boolean;
  sensitiveType?: "credential" | "pii" | "financial" | "medical";
}

// ── Sensitive Content Detection ──────────────────────────────────────────────

// Credential patterns — MUST be detected and redacted before any transmission.
const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; type: "credential" }> = [
  { pattern: /(?:password|passcode|p\.?i\.?n\.?)\s*(?:is|was|:|=)\s*\S+/i, type: "credential" },
  { pattern: /\b(?:otp|one[- ]?time[- ]?code|verification[- ]?code|security[- ]?code|recovery[- ]?code)\s*(?:is|was|:|=)\s*\S+/i, type: "credential" },
  { pattern: /\b(?:recovery[- ]?phrase|seed[- ]?phrase|mnemonic)\b/i, type: "credential" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/i, type: "credential" },
  { pattern: /(?:api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token)\s*(?::|=)\s*\S+/i, type: "credential" },
  { pattern: /(?:https?:\/\/)[^\s/@]+:[^\s/@]+@/i, type: "credential" },
  { pattern: /[?&](?:(?:access|refresh|auth|api)[_-]?)?(?:token|password|secret|key|code|session)=[^\s&#"']+/i, type: "credential" },
  // 2FA codes: 4-8 digit sequences that appear to be verification codes
  { pattern: /\b(?:code|otp|pin)\s*[:=]?\s*\d{4,8}\b/i, type: "credential" },
];

// PII patterns — flagged for user awareness and optional redaction.
const PII_PATTERNS: Array<{ pattern: RegExp; type: "pii" | "financial" | "medical" }> = [
  // Australian/international phone numbers
  { pattern: /(?<![0-9])\+?\d[\d\s().-]{7,}\d(?![0-9])/, type: "pii" },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, type: "pii" },
  // Credit/debit card numbers (basic pattern)
  { pattern: /\b(?:\d[ -]?){13,19}\b/, type: "financial" },
  // BSB + account (Australian banking)
  { pattern: /\b\d{3}[- ]?\d{3}[- ]?\d{6,10}\b/, type: "financial" },
  // Medicare number (Australian)
  { pattern: /\b\d{4}\s?\d{5}\s?\d{1}\b/, type: "medical" },
  // Tax File Number (Australian, 8-9 digits)
  { pattern: /\bTFN\s*[:=]?\s*\d{3}\s?\d{3}\s?\d{2,3}\b/i, type: "financial" },
];

/** Classify a text string for sensitive content. Returns all detected patterns. */
export function detectSensitiveContent(text: string): SensitiveDetection[] {
  const detections: SensitiveDetection[] = [];
  for (const { pattern, type } of CREDENTIAL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags + (pattern.flags.includes("g") ? "" : "g"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      detections.push({ match: m[0], type, startIndex: m.index });
    }
  }
  for (const { pattern, type } of PII_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags + (pattern.flags.includes("g") ? "" : "g"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      detections.push({ match: m[0], type, startIndex: m.index });
    }
  }
  return detections;
}

/** Redact credential patterns from text, replacing with category labels. */
export function redactText(text: string): string {
  let result = text;
  for (const { pattern } of CREDENTIAL_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags.replace("g", "") + "g"), "[credential redacted]");
  }
  return result;
}

/** Redact ALL sensitive content including PII from text. */
export function redactAllSensitive(text: string): string {
  let result = redactText(text);
  for (const { pattern, type } of PII_PATTERNS) {
    const label = type === "financial" ? "[financial data redacted]"
      : type === "medical" ? "[medical data redacted]"
      : "[personal data redacted]";
    result = result.replace(new RegExp(pattern.source, pattern.flags.replace("g", "") + "g"), label);
  }
  return result;
}

/** Classify OCR text regions for sensitivity. Pure function — no native dependencies. */
export function classifyRegions(blocks: Array<{ text: string; frame: { x: number; y: number; width: number; height: number } }>): TextRegion[] {
  return blocks.map((block) => {
    const detections = detectSensitiveContent(block.text);
    const isSensitive = detections.length > 0;
    const sensitiveType = detections.length > 0 ? detections[0].type : undefined;
    return { text: block.text, frame: block.frame, isSensitive, sensitiveType };
  });
}

/** Check if text regions contain visually significant content beyond text. */
export function hasVisuallySignificantContent(regions: TextRegion[]): boolean {
  if (regions.length === 0) return true;
  if (regions.length > 15) return false;
  return true;
}
