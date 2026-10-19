/**
 * Personal Data Learning — auto-detection of likely user-owned information
 * from submitted content (email signatures, receiving addresses, etc.).
 *
 * Detected items are stored as "pending suggestions" — NEVER auto-added.
 * The user reviews and approves/dismisses each suggestion in Settings → My Personal Data.
 *
 * Architecture rules:
 * - All detection runs on-device only
 * - Suggestions stored locally in AsyncStorage
 * - Dismissed items are remembered so they aren't re-suggested
 * - Non-blocking: learning runs asynchronously, never delays the screening pipeline
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import {
  type PersonalDataCategory,
  type PersonalDataEntry,
  loadPersonalData,
  matchesPersonalData,
} from "./personalDataStore";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersonalDataSuggestion {
  id: string;
  category: PersonalDataCategory;
  label: string;
  value: string;
  source: "email_signature" | "receiving_address" | "message_content" | "screenshot";
  /** Human-readable reason this was suggested */
  reason: string;
  detectedAt: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const SUGGESTIONS_KEY = "apollo.personal_data_suggestions.v1";
const DISMISSED_KEY = "apollo.personal_data_dismissed.v1";

let suggestionsCache: PersonalDataSuggestion[] | null = null;
let dismissedCache: Set<string> | null = null;

export async function loadSuggestions(): Promise<PersonalDataSuggestion[]> {
  if (suggestionsCache !== null) return suggestionsCache;
  try {
    const raw = await AsyncStorage.getItem(SUGGESTIONS_KEY);
    if (!raw) { suggestionsCache = []; return []; }
    const parsed = JSON.parse(raw);
    suggestionsCache = Array.isArray(parsed) ? parsed : [];
    return suggestionsCache;
  } catch {
    suggestionsCache = [];
    return [];
  }
}

async function loadDismissed(): Promise<Set<string>> {
  if (dismissedCache !== null) return dismissedCache;
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_KEY);
    if (!raw) { dismissedCache = new Set(); return dismissedCache; }
    const parsed = JSON.parse(raw);
    dismissedCache = new Set(Array.isArray(parsed) ? parsed : []);
    return dismissedCache;
  } catch {
    dismissedCache = new Set();
    return dismissedCache;
  }
}

async function persistSuggestions(items: PersonalDataSuggestion[]): Promise<void> {
  suggestionsCache = items;
  await AsyncStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(items));
}

async function persistDismissed(items: Set<string>): Promise<void> {
  dismissedCache = items;
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify([...items]));
}

/** Dismiss a suggestion so it won't be re-suggested. */
export async function dismissSuggestion(id: string): Promise<void> {
  const suggestions = await loadSuggestions();
  const target = suggestions.find((s) => s.id === id);
  // Remember the normalised value so the same data isn't re-suggested
  if (target) {
    const dismissed = await loadDismissed();
    dismissed.add(normalise(target.value));
    await persistDismissed(dismissed);
  }
  await persistSuggestions(suggestions.filter((s) => s.id !== id));
}

/** Remove a suggestion after it's been accepted (added to personal data). */
export async function acceptSuggestion(id: string): Promise<void> {
  const suggestions = await loadSuggestions();
  await persistSuggestions(suggestions.filter((s) => s.id !== id));
}

/** Clear all pending suggestions. */
export async function clearAllSuggestions(): Promise<void> {
  suggestionsCache = [];
  dismissedCache = new Set();
  await AsyncStorage.multiRemove([SUGGESTIONS_KEY, DISMISSED_KEY]);
}

// ── Normalisation ────────────────────────────────────────────────────────────

function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s\-().+]/g, "").trim();
}

// ── Email Signature Detection ────────────────────────────────────────────────

/** Common sign-off patterns that precede email signatures. */
const SIGN_OFF_PATTERNS = [
  /^(?:regards|kind\s+regards|best\s+regards|warm\s+regards|many\s+thanks|thanks|thank\s+you|cheers|sincerely|yours\s+(?:sincerely|truly|faithfully)|best|best\s+wishes|with\s+(?:thanks|regards|appreciation)),?\s*$/im,
  /^(?:sent\s+from\s+my\s+(?:iphone|ipad|android|samsung|pixel|mobile))/im,
  /^-{2,}\s*$/m, // -- separator (common RFC signature delimiter)
];

/** Lines that are clearly NOT part of a signature. */
const NON_SIGNATURE = [
  /^(?:from|to|cc|bcc|subject|date|sent)\s*:/i,
  /^(?:on\s+.+wrote|-----\s*original\s*message)/i,
  /^(?:begin\s+forwarded|forwarded\s+message)/i,
];

/**
 * Extract the signature block from email/message text.
 * Returns the lines after the sign-off, or null if no signature detected.
 */
function extractSignatureBlock(text: string): string[] | null {
  const lines = text.split("\n").map((l) => l.trim());
  let signOffIdx = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    // Don't look too far back — signatures are typically the last 8-12 lines
    if (lines.length - i > 15) break;

    for (const pattern of SIGN_OFF_PATTERNS) {
      if (pattern.test(lines[i])) {
        signOffIdx = i;
        break;
      }
    }
    if (signOffIdx >= 0) break;
  }

  if (signOffIdx < 0) return null;

  // Collect lines after the sign-off, filtering blanks and non-signature lines
  const sigLines = lines
    .slice(signOffIdx + 1)
    .filter((l) => l.length > 0 && !NON_SIGNATURE.some((p) => p.test(l)));

  return sigLines.length > 0 ? sigLines : null;
}

// ── Pattern Extraction ───────────────────────────────────────────────────────

const PHONE_RE = /(?<![0-9])\+?\d[\d\s().-]{7,}\d(?![0-9])/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const ADDRESS_RE = /\b\d{1,5}\s+[A-Z][a-zA-Z\s]+(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Dr(?:ive)?|Blvd|Boulevard|Ln|Lane|Ct|Court|Pl(?:ace)?|Way|Cres(?:cent)?|Tce|Terrace|Pde|Parade)\b[^,\n]{0,60}/gi;
const POSTCODE_ADDRESS_RE = /\b[A-Z][a-zA-Z\s]+(?:,\s*)?(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT|[A-Z]{2})\s+\d{4,5}\b/g;

interface ExtractedItem {
  category: PersonalDataCategory;
  value: string;
  label: string;
}

function extractIdentifiers(lines: string[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const text = lines.join("\n");

  // Extract phone numbers
  const phones = text.match(PHONE_RE);
  if (phones) {
    for (const phone of phones) {
      items.push({ category: "phone", value: phone.trim(), label: "Phone (from signature)" });
    }
  }

  // Extract email addresses
  const emails = text.match(EMAIL_RE);
  if (emails) {
    for (const email of emails) {
      items.push({ category: "email", value: email, label: "Email (from signature)" });
    }
  }

  // Extract street addresses
  const addresses = text.match(ADDRESS_RE);
  if (addresses) {
    for (const addr of addresses) {
      items.push({ category: "address", value: addr.trim(), label: "Address (from signature)" });
    }
  }

  // Extract addresses with postcodes (AU/US/UK patterns)
  const postcodeAddrs = text.match(POSTCODE_ADDRESS_RE);
  if (postcodeAddrs) {
    for (const addr of postcodeAddrs) {
      // Avoid duplicates with street address matches
      if (!items.some((i) => i.category === "address" && normalise(i.value) === normalise(addr))) {
        items.push({ category: "address", value: addr.trim(), label: "Address (from signature)" });
      }
    }
  }

  // Extract names: first non-empty line after sign-off that looks like a name
  // (2-4 words, capitalised, no special chars)
  for (const line of lines.slice(0, 3)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 60) continue;
    // Skip lines that are phone/email/address
    if (PHONE_RE.test(trimmed) || EMAIL_RE.test(trimmed)) { PHONE_RE.lastIndex = 0; EMAIL_RE.lastIndex = 0; continue; }
    // Name pattern: 2-4 capitalised words
    if (/^[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,3}$/.test(trimmed)) {
      items.push({ category: "name", value: trimmed, label: "Name (from signature)" });
      break; // Only take the first name-like line
    }
  }

  // Reset lastIndex for global regexes
  PHONE_RE.lastIndex = 0;
  EMAIL_RE.lastIndex = 0;
  ADDRESS_RE.lastIndex = 0;
  POSTCODE_ADDRESS_RE.lastIndex = 0;

  return items;
}

// ── Receiving Address Detection ──────────────────────────────────────────────

const RECEIVING_PATTERNS = [
  /(?:deliver(?:y|ed)?\s+(?:to|address)|ship(?:ping|ped)?\s+to|send(?:ing)?\s+to|recipient|your\s+address)\s*[:\-]?\s*(.{10,80})/gi,
  /(?:address\s*[:\-]\s*)(\d{1,5}\s+[A-Z][a-zA-Z\s]+(?:St|Ave|Rd|Dr|Blvd|Ln|Ct|Pl|Way)[^,\n]{0,60})/gi,
];

function extractReceivingAddresses(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  for (const pattern of RECEIVING_PATTERNS) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const addr = (m[1] || m[0]).trim();
      if (addr.length >= 10 && addr.length <= 120) {
        items.push({ category: "address", value: addr, label: "Receiving address" });
      }
    }
    pattern.lastIndex = 0;
  }
  return items;
}

// ── Main Learning Function ───────────────────────────────────────────────────

/**
 * Analyse text content for likely user-owned personal data.
 * Runs non-blocking — call this from the screening pipeline.
 *
 * Detected items are stored as suggestions if:
 * 1. They don't already exist in the user's personal data
 * 2. They haven't been previously dismissed
 * 3. They aren't already pending as suggestions
 *
 * @param text    The raw text to analyse (from OCR, message content, etc.)
 * @param source  Where this text came from
 */
export async function learnFromText(
  text: string,
  source: PersonalDataSuggestion["source"],
): Promise<void> {
  if (!text || text.length < 10) return;

  try {
    const [existingData, existingSuggestions, dismissed] = await Promise.all([
      loadPersonalData(),
      loadSuggestions(),
      loadDismissed(),
    ]);

    const candidates: ExtractedItem[] = [];

    // 1. Email signature detection
    const sigBlock = extractSignatureBlock(text);
    if (sigBlock) {
      candidates.push(...extractIdentifiers(sigBlock));
    }

    // 2. Receiving address detection (from full text)
    candidates.push(...extractReceivingAddresses(text));

    if (candidates.length === 0) return;

    // Filter out items that:
    // - Already exist in personal data
    // - Were previously dismissed
    // - Are already pending suggestions
    const newSuggestions: PersonalDataSuggestion[] = [];
    const seenNorm = new Set(existingSuggestions.map((s) => normalise(s.value)));

    for (const candidate of candidates) {
      const norm = normalise(candidate.value);
      if (!norm || norm.length < 3) continue;
      if (dismissed.has(norm)) continue;
      if (seenNorm.has(norm)) continue;
      if (matchesPersonalData(candidate.value, existingData)) continue;

      seenNorm.add(norm);
      newSuggestions.push({
        id: Crypto.randomUUID(),
        category: candidate.category,
        label: candidate.label,
        value: candidate.value,
        source,
        reason: source === "email_signature"
          ? "Detected in an email signature"
          : source === "receiving_address"
            ? "Found as a receiving/delivery address"
            : `Found in ${source.replace("_", " ")}`,
        detectedAt: new Date().toISOString(),
      });
    }

    if (newSuggestions.length > 0) {
      // Cap total suggestions at 50 to prevent unbounded growth
      const all = [...existingSuggestions, ...newSuggestions].slice(-50);
      await persistSuggestions(all);
    }
  } catch {
    // Non-blocking — never fail the screening pipeline
    if (__DEV__) {
      console.warn("[personalDataLearning] Error during learning pass");
    }
  }
}

/**
 * Convenience: learn from email content, specifically targeting signature blocks.
 */
export async function learnFromEmail(emailText: string): Promise<void> {
  return learnFromText(emailText, "email_signature");
}

/**
 * Convenience: learn from message content (SMS, chat screenshots).
 */
export async function learnFromMessage(messageText: string): Promise<void> {
  return learnFromText(messageText, "message_content");
}

/**
 * Convenience: learn from screenshot OCR text.
 */
export async function learnFromScreenshot(ocrText: string): Promise<void> {
  return learnFromText(ocrText, "screenshot");
}
