/**
 * On-device Image Privacy — Pure Detection & Redaction Functions
 *
 * Contains ONLY the text-analysis logic that runs in any JS environment.
 * No native module dependencies. Testable in Node.js test runner.
 *
 * The native-dependent functions (OCR, metadata stripping, image manipulation)
 * are in imagePrivacy.ts which imports from this file.
 *
 * Architecture principle: ONE screening engine. Source context informs
 * interpretation — it never creates a separate processing path.
 *
 * Classification tiers:
 *   "credential"           → MANDATORY redact. Passwords, PINs, OTPs, tokens, keys, seeds.
 *   "financial"            → Strongly protected. Card numbers, BSB, account numbers.
 *   "medical"              → Strongly protected. Medicare, health IDs.
 *   "pii"                  → User-private. User's own phone number, personal identifiers.
 *   "sender_identifier"    → Investigation subject. Sender phone, sender email, callback
 *                            numbers, suspicious URLs. MAY remain visible when part of
 *                            the scam evidence being investigated.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type { SensitiveType, SensitiveDetection } from "./privacyPolicy.ts";
export type { ScreeningContext } from "./privacyPolicy.ts";

import type { SensitiveType, SensitiveDetection, ScreeningContext } from "./privacyPolicy.ts";
import {
  CREDENTIAL_PATTERNS,
  FINANCIAL_MEDICAL_PATTERNS,
  PHONE_PATTERN,
  EMAIL_PATTERN,
  SENDER_CONTEXT_PATTERNS,
} from "./privacyPolicy.ts";

// Lazy-load personal data matching to avoid hard dependency on native modules in test environments.
// When running in Node.js tests, the store won't load — all identifiers default to "sender_identifier" (preserved).
let _isUserPersonalData: (detected: string) => boolean = () => false;
let _redactPersonalDataInText: (text: string) => string = (text) => text;
try {
  const store = require("../store/personalDataStore");
  _isUserPersonalData = store.isUserPersonalData;
  _redactPersonalDataInText = store.redactPersonalDataInText;
} catch {
  // Native modules unavailable (test environment) — personal data matching disabled
}

export interface SensitiveToken {
  match: string;
  type: SensitiveType;
  /** Character offset within the parent text block. */
  startIndex: number;
}

export interface TextRegion {
  text: string;
  frame: { x: number; y: number; width: number; height: number };
  isSensitive: boolean;
  sensitiveType?: SensitiveType;
  /** Individual sensitive tokens within this block — for token-level redaction
   *  instead of blacking out the entire OCR region. */
  sensitiveTokens?: SensitiveToken[];
}

// Sender context patterns imported from privacyPolicy.ts

/**
 * Check if a text block appears to contain sender/subject identifiers.
 */
function hasSenderContext(text: string): boolean {
  return SENDER_CONTEXT_PATTERNS.some((p) => p.test(text));
}

/**
 * Determine if a phone number or email in this text block is likely
 * the investigation subject (sender) rather than user-private PII.
 *
 * Only uses explicit textual signals — NOT block position.
 * Ownership/role is established by content, not position in the image.
 *
 * Context signals that indicate "investigation subject":
 * - Text contains sender-label patterns ("From:", "Sender:", etc.)
 * - Text is a standalone phone number (typical of SMS/WhatsApp sender display)
 */
function isLikelyInvestigationSubject(
  text: string,
  _context?: ScreeningContext,
): boolean {
  // Explicit sender context in the text (e.g. "From: +61...")
  if (hasSenderContext(text)) return true;

  // Standalone phone number (the entire text block is just a number)
  const trimmed = text.trim();
  if (/^\+?\d[\d\s().-]{7,}\d$/.test(trimmed) && trimmed.length < 25) return true;

  return false;
}

// Phone and email patterns imported from privacyPolicy.ts
// Financial/medical patterns imported from privacyPolicy.ts

/** Classify a text string for sensitive content. Returns all detected patterns.
 *
 * @param text      The text to analyse
 * @param context   Optional screening context to inform sender vs user-private classification
 */
export function detectSensitiveContent(
  text: string,
  context?: ScreeningContext,
): SensitiveDetection[] {
  const detections: SensitiveDetection[] = [];

  // 1. Credentials — always mandatory, never relaxed
  for (const { pattern, type } of CREDENTIAL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags + (pattern.flags.includes("g") ? "" : "g"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      detections.push({ match: m[0], type, startIndex: m.index });
    }
  }

  // 2. Financial and medical — always strongly protected
  for (const { pattern, type } of FINANCIAL_MEDICAL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags + (pattern.flags.includes("g") ? "" : "g"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      detections.push({ match: m[0], type, startIndex: m.index });
    }
  }

  // 3. Phone numbers and emails — only the USER's own data is classified as PII.
  //    Third-party identifiers are preserved as investigation evidence.
  //    If the user hasn't stored personal data, identifiers default to "sender_identifier" (preserved).

  // Phone numbers
  {
    const re = new RegExp(PHONE_PATTERN.source, PHONE_PATTERN.flags + (PHONE_PATTERN.flags.includes("g") ? "" : "g"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Don't double-count as PII if already matched by a credential pattern
      const alreadyCred = detections.some(
        (d) => d.type === "credential" && d.startIndex <= m!.index && d.startIndex + d.match.length >= m!.index + m![0].length,
      );
      if (!alreadyCred) {
        // Only classify as user-private PII if it matches the user's stored personal data
        const isOwnData = _isUserPersonalData(m[0]);
        detections.push({ match: m[0], type: isOwnData ? "pii" : "sender_identifier", startIndex: m.index });
      }
    }
  }

  // Email addresses
  {
    const re = new RegExp(EMAIL_PATTERN.source, EMAIL_PATTERN.flags + (EMAIL_PATTERN.flags.includes("g") ? "" : "g"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const alreadyCred = detections.some(
        (d) => d.type === "credential" && d.startIndex <= m!.index && d.startIndex + d.match.length >= m!.index + m![0].length,
      );
      if (!alreadyCred) {
        // Only classify as user-private PII if it matches the user's stored personal data
        const isOwnData = _isUserPersonalData(m[0]);
        detections.push({ match: m[0], type: isOwnData ? "pii" : "sender_identifier", startIndex: m.index });
      }
    }
  }

  return detections;
}

/** Redact credential patterns from text, replacing with category labels.
 *  Credentials are ALWAYS redacted regardless of context. */
export function redactText(text: string): string {
  let result = text;
  for (const { pattern } of CREDENTIAL_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags.replace("g", "") + "g"), "[credential redacted]");
  }
  return result;
}

/** Redact ALL sensitive content including user-private PII from text.
 *  Only the user's OWN personal data is redacted. Third-party identifiers are preserved.
 *  Credentials and financial/medical data are always redacted.
 *
 *  @param text     The text to redact
 *  @param context  Optional context (unused after simplification, kept for API compat)
 */
export function redactAllSensitive(text: string, context?: ScreeningContext): string {
  // 1. Redact credentials (always)
  let result = redactText(text);

  // 2. Redact financial/medical (always)
  for (const { pattern, type } of FINANCIAL_MEDICAL_PATTERNS) {
    const label = type === "financial" ? "[financial data redacted]"
      : "[medical data redacted]";
    result = result.replace(new RegExp(pattern.source, pattern.flags.replace("g", "") + "g"), label);
  }

  // 3. Phone numbers and emails — only redact if they match the user's personal data profile.
  //    Third-party identifiers (sender numbers, business emails, etc.) are preserved as evidence.
  result = _redactPersonalDataInText(result);

  return result;
}

/** Classify OCR text regions for sensitivity. Pure function — no native dependencies.
 *
 *  @param blocks   OCR text blocks with bounding box frames
 *  @param context  Optional screening context for sender-aware classification
 */
export function classifyRegions(
  blocks: Array<{ text: string; frame: { x: number; y: number; width: number; height: number } }>,
  context?: Omit<ScreeningContext, "blockIndex" | "totalBlocks">,
): TextRegion[] {
  return blocks.map((block, idx) => {
    const blockContext: ScreeningContext = {
      purpose: context?.purpose ?? "investigation_evidence",
      blockIndex: idx,
      totalBlocks: blocks.length,
    };
    const detections = detectSensitiveContent(block.text, blockContext);
    // A region needs redaction only if it holds a credential/authentication secret. Everything else —
    // names, numbers, emails, accounts, payment details, senders — is scam evidence and is kept.
    const mandatoryRedactTypes: SensitiveType[] = ["credential"]; // evidence (PII, payment, senders…) is preserved
    const mustRedact = detections.filter((d) => mandatoryRedactTypes.includes(d.type));
    const isSensitive = mustRedact.length > 0;
    const sensitiveType = mustRedact.length > 0 ? mustRedact[0].type : (detections.length > 0 ? detections[0].type : undefined);
    // Build token-level list for precise redaction (not whole-block)
    const sensitiveTokens: SensitiveToken[] = mustRedact.map((d) => ({
      match: d.match,
      type: d.type,
      startIndex: d.startIndex,
    }));
    return { text: block.text, frame: block.frame, isSensitive, sensitiveType, sensitiveTokens };
  });
}

/** Check if text regions contain visually significant content beyond text. */
export function hasVisuallySignificantContent(regions: TextRegion[]): boolean {
  if (regions.length === 0) return true;
  if (regions.length > 15) return false;
  return true;
}

// ── Sender Extraction ────────────────────────────────────────────────────────

/**
 * Extract a sender identifier (phone number or email) from OCR text.
 *
 * Scans the text for sender-context patterns and returns the first
 * phone number or email found in a sender position. This is used to
 * populate the investigation's `sender` field separately from the
 * message body, preserving it as evidence even when body text is
 * privacy-sanitised.
 *
 * Returns null if no sender identifier is found.
 */
export function extractSenderFromText(fullText: string): string | null {
  const lines = fullText.split("\n");
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for explicit sender labels
    const senderLabelMatch = line.match(
      /(?:from|sender|reply[- ]?to|sent\s+by)\s*[:]\s*(.+)/i,
    );
    if (senderLabelMatch) {
      const value = senderLabelMatch[1].trim();
      // Extract email or phone from the value
      const emailMatch = value.match(EMAIL_PATTERN);
      if (emailMatch) return emailMatch[0];
      const phoneMatch = value.match(PHONE_PATTERN);
      if (phoneMatch) return phoneMatch[0].trim();
      // Return the raw value if it's short enough to be a name/identifier
      if (value.length < 60) return value;
    }

    // Standalone phone number in the first few lines (WhatsApp/SMS sender display)
    if (/^\+?\d[\d\s().-]{7,}\d$/.test(line) && line.length < 25) {
      return line;
    }

    // "Message from +61..." pattern
    const msgFromMatch = line.match(
      /(?:message|sms|text|call|missed call)\s+from\s+(\+?\d[\d\s().-]{7,}\d)/i,
    );
    if (msgFromMatch) return msgFromMatch[1].trim();
  }

  return null;
}
