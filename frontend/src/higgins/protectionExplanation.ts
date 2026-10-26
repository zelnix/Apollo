// Explanations of protections — reviewed text fetched from ApolloSG's backend, kept on the phone once fetched.
//
// Every Apollo Protection has one canonical explanation, and the common Device Protections have a reviewed one.
// Anything else has no explanation and the app says so; no AI writes one. Only the protection's id leaves the phone.
import { ApiError, apiGet } from "@/src/api/client";
import type { DeviceProtectionRow } from "@/src/domain/deviceCapabilities";
import { storage } from "@/src/utils/storage";

export interface ProtectionExplanation {
  what: string;
  why: string;
  protectsAgainst: string;
  recommended: string | null;
}

export interface ExplanationResult {
  explanation: ProtectionExplanation;
  source: "apollo_reviewed";
  scopeLabel: string;
}

const CACHE = "apollo.protectionExplanations.v1";
type Cached = Record<string, ExplanationResult>;

async function cached(): Promise<Cached> {
  try {
    const raw = await storage.getItem<string | null>(CACHE, null);
    return typeof raw === "string" ? (JSON.parse(raw) as Cached) : {};
  } catch { return {}; }
}

/** A copy this phone kept, if it is reviewed text (older copies written by Higgins are no longer shown). */
async function local(key: string): Promise<ExplanationResult | undefined> {
  const found = (await cached())[key];
  return found?.source === "apollo_reviewed" ? found : undefined;
}

async function remember(key: string, value: ExplanationResult): Promise<void> {
  const all = await cached();
  await storage.setItem(CACHE, JSON.stringify({ ...all, [key]: value }));
}

/** The one canonical explanation of an Apollo Protection (a Gate). */
export async function apolloProtectionExplanation(gateId: string): Promise<ExplanationResult> {
  const key = `apollo:${gateId}`;
  const kept = await local(key);
  if (kept) return kept;
  const result = await apiGet<ExplanationResult>(`/protections/apollo/${encodeURIComponent(gateId)}`);
  await remember(key, result);
  return result;
}

/** No explanation of this protection — said plainly, never filled in with made-up text. */
export class ExplanationPending extends Error {
  constructor() { super("ApolloSG doesn’t have an explanation of this protection yet."); }
}

/** The reviewed explanation of a Device Protection. */
export async function deviceProtectionExplanation(row: Pick<DeviceProtectionRow, "id">): Promise<ExplanationResult> {
  const key = `device:${row.id}`;
  const kept = await local(key);
  if (kept) return kept;
  const reviewed = await apiGet<ExplanationResult>(`/protections/device/${encodeURIComponent(row.id)}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) throw new ExplanationPending();
    throw error;
  });
  await remember(key, reviewed);
  return reviewed;
}
