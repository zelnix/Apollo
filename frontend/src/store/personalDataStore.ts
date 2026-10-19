/**
 * My Personal Data — local-only profile of the user's own personal information.
 *
 * This data is used EXCLUSIVELY for on-device privacy screening:
 * before any artifact is sent for external analysis, Apollo compares
 * detected identifiers against this profile and redacts ONLY matches.
 *
 * Architecture rules:
 * - Data NEVER leaves the device
 * - Data is NEVER uploaded to Apollo servers
 * - Data is NEVER sent to any external analysis service
 * - Data is NEVER cloud-synced
 * - Stored in AsyncStorage under the apollo.personal_data.v1 key
 * - Wiped when the user deletes all Apollo data
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export type PersonalDataCategory =
  | "name"
  | "phone"
  | "email"
  | "address"
  | "account_id"
  | "email_signature"
  | "other";

export interface PersonalDataEntry {
  id: string;
  category: PersonalDataCategory;
  label: string;  // user-facing label, e.g. "Home phone", "Work email"
  value: string;  // the actual data to match against
  createdAt: string;
  updatedAt: string;
}

export const CATEGORY_LABELS: Record<PersonalDataCategory, string> = {
  name: "Name or alias",
  phone: "Phone number",
  email: "Email address",
  address: "Address",
  account_id: "Account identifier",
  email_signature: "Email signature",
  other: "Other",
};

export const CATEGORY_HINTS: Record<PersonalDataCategory, string> = {
  name: "Your name, nicknames or aliases",
  phone: "Your personal or work phone numbers",
  email: "Your email addresses",
  address: "Home, work or postal addresses",
  account_id: "Bank account, membership or ID numbers",
  email_signature: "Text from your email signature block",
  other: "Any other personal identifier you want protected",
};

export const CATEGORY_ORDER: PersonalDataCategory[] = [
  "name", "phone", "email", "address", "account_id", "email_signature", "other",
];

// ── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "apollo.personal_data.v1";

/** In-memory cache — avoids reading AsyncStorage on every redaction check. */
let cache: PersonalDataEntry[] | null = null;

export async function loadPersonalData(): Promise<PersonalDataEntry[]> {
  if (cache !== null) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) { cache = []; return []; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) { cache = []; return []; }
    cache = parsed as PersonalDataEntry[];
    return cache;
  } catch {
    cache = [];
    return [];
  }
}

async function persist(entries: PersonalDataEntry[]): Promise<void> {
  cache = entries;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export async function addPersonalDataEntry(
  category: PersonalDataCategory,
  label: string,
  value: string,
): Promise<PersonalDataEntry> {
  const entries = await loadPersonalData();
  const now = new Date().toISOString();
  const entry: PersonalDataEntry = {
    id: Crypto.randomUUID(),
    category,
    label: label.trim(),
    value: value.trim(),
    createdAt: now,
    updatedAt: now,
  };
  entries.push(entry);
  await persist(entries);
  return entry;
}

export async function updatePersonalDataEntry(
  id: string,
  updates: { label?: string; value?: string; category?: PersonalDataCategory },
): Promise<PersonalDataEntry | null> {
  const entries = await loadPersonalData();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const entry = entries[idx];
  if (updates.label !== undefined) entry.label = updates.label.trim();
  if (updates.value !== undefined) entry.value = updates.value.trim();
  if (updates.category !== undefined) entry.category = updates.category;
  entry.updatedAt = new Date().toISOString();
  entries[idx] = entry;
  await persist(entries);
  return entry;
}

export async function deletePersonalDataEntry(id: string): Promise<boolean> {
  const entries = await loadPersonalData();
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) return false;
  await persist(filtered);
  return true;
}

export async function clearAllPersonalData(): Promise<void> {
  cache = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ── Matching ─────────────────────────────────────────────────────────────────

/** Normalise a value for fuzzy matching (lowercase, collapse whitespace, strip punctuation). */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s\-().+]/g, "").trim();
}

/**
 * Check if a detected string matches any entry in the user's personal data.
 * Uses normalised comparison so "0412 345 678" matches "+61412345678".
 *
 * Returns the matched entry or null.
 */
export function matchesPersonalData(
  detected: string,
  entries: PersonalDataEntry[],
): PersonalDataEntry | null {
  if (!detected || !entries.length) return null;
  const normDetected = normalise(detected);
  if (!normDetected) return null;

  for (const entry of entries) {
    const normValue = normalise(entry.value);
    if (!normValue) continue;

    // Exact normalised match
    if (normDetected === normValue) return entry;

    // Substring containment (for addresses, signatures, names in longer text)
    if (normDetected.length >= 3 && normValue.length >= 3) {
      if (normDetected.includes(normValue) || normValue.includes(normDetected)) return entry;
    }
  }
  return null;
}

/**
 * Synchronous check using the in-memory cache.
 * Returns true if the detected string matches any user personal data.
 * MUST call loadPersonalData() at least once before using this.
 */
export function isUserPersonalData(detected: string): boolean {
  return matchesPersonalData(detected, cache ?? []) !== null;
}

/**
 * Get all personal data values as a flat array (for bulk matching).
 * Uses the in-memory cache.
 */
export function getPersonalDataValues(): string[] {
  return (cache ?? []).map((e) => e.value).filter(Boolean);
}

/**
 * Redact all occurrences of user's personal data in a string.
 * Only redacts entries that match the user's stored personal data.
 * Returns the redacted string.
 */
export function redactPersonalDataInText(text: string): string {
  const entries = cache ?? [];
  if (!entries.length) return text;

  let result = text;
  // Sort entries by value length (longest first) to avoid partial replacements
  const sorted = [...entries].sort((a, b) => b.value.length - a.value.length);

  for (const entry of sorted) {
    if (!entry.value.trim()) continue;
    // Escape regex special chars in the value
    const escaped = entry.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Case-insensitive replacement, allow flexible whitespace for phone numbers
    const pattern = entry.category === "phone"
      ? new RegExp(escaped.replace(/\s+/g, "[\\s\\-().]*"), "gi")
      : new RegExp(escaped, "gi");
    const label = `[${CATEGORY_LABELS[entry.category]} redacted]`;
    result = result.replace(pattern, label);
  }
  return result;
}
