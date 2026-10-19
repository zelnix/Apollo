// The original source Apollo investigated (exact text / URL / fields / raw device evidence), kept unaltered
// on this device only, one key per case. Deleted with the case and on full data wipe.
import { storage } from "@/src/utils/storage";

export type OriginalSourceKind = "email" | "text" | "link" | "website" | "screenshot" | "call" | "app" | "file" | "account" | "device" | "network";

export interface OriginalSource {
  kind: OriginalSourceKind;
  /** Exact fields as captured (e.g. From, Subject, Number). */
  fields?: { label: string; value: string }[];
  /** Exact original text/body. */
  text?: string | null;
  /** Exact original link as entered or received. */
  url?: string | null;
  /** Exact raw record reported by the device / OS (network, DNS, enforcement, device signals). */
  data?: unknown;
  capturedAt: string;
  /** Where the copy came from: captured on this device, or downloaded once from the investigation. */
  origin: "this_device" | "investigation";
}

const key = (caseKey: string) => `apollo.original.v1.${caseKey}`;
const listeners = new Set<() => void>();
export function subscribeOriginalSource(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export type OriginalSourceInput = Omit<OriginalSource, "capturedAt" | "origin"> & Partial<Pick<OriginalSource, "capturedAt" | "origin">>;

export async function saveOriginalSource(caseKeys: (string | null | undefined)[], source: OriginalSourceInput) {
  const record: OriginalSource = { capturedAt: new Date().toISOString(), origin: "this_device", ...source };
  try {
    for (const k of caseKeys) if (k && !(await getOriginalSource(k))) await storage.setItem(key(k), JSON.stringify(record));
    listeners.forEach((l) => l());
  } catch (e) { console.warn("[originalSource] could not save original source:", e); }
}

export async function getOriginalSource(caseKey: string): Promise<OriginalSource | null> {
  try { const raw = await storage.getItem<string | null>(key(caseKey), null); return raw ? (JSON.parse(raw) as OriginalSource) : null; }
  catch { return null; }
}

export async function deleteOriginalSource(caseKey: string) { await storage.removeItem(key(caseKey)); listeners.forEach((l) => l()); }
