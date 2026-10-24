// Higgins' explanations of protections — fetched from Apollo's backend, kept on the phone once fetched.
//
// The backend serves one canonical explanation per Apollo Protection, and for Device Protections a reviewed
// explanation or one Higgins wrote once and reuses (Gemini only on a genuine miss, never per person). This
// phone keeps its copy, so reopening a protection never asks again. Only the protection's name, the OS, the
// maker, the OS version and the model leave the device — never its current state.
import { Platform } from "react-native";

import { ApiError, apiGet, apiPost } from "@/src/api/client";
import type { DeviceProtectionRow } from "@/src/domain/deviceCapabilities";
import { capabilityPlatform, deviceFacts } from "@/src/security/deviceCapabilityState";
import { storage } from "@/src/utils/storage";

export interface ProtectionExplanation {
  what: string;
  why: string;
  protectsAgainst: string;
  recommended: string | null;
}

export interface ExplanationResult {
  explanation: ProtectionExplanation;
  /** apollo_reviewed = written once by Apollo; higgins_cached/new = taught once by Higgins and reused. */
  source: "apollo_reviewed" | "higgins_cached" | "higgins_new";
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

async function remember(key: string, value: ExplanationResult): Promise<void> {
  const all = await cached();
  await storage.setItem(CACHE, JSON.stringify({ ...all, [key]: { ...value, source: value.source === "higgins_new" ? "higgins_cached" : value.source } }));
}

/** The one canonical explanation of an Apollo Protection (a Gate). */
export async function apolloProtectionExplanation(gateId: string): Promise<ExplanationResult> {
  const key = `apollo:${gateId}`;
  const local = (await cached())[key];
  if (local) return local;
  const result = await apiGet<ExplanationResult>(`/protections/apollo/${encodeURIComponent(gateId)}`);
  await remember(key, result);
  return result;
}

const PENDING_MESSAGE = {
  generating: "Higgins is still writing this explanation. Try again in a moment.",
  limited: "Higgins has written enough new explanations for this device today. Try again tomorrow.",
  device_only: "Open Apollo on your device to see Higgins' explanation of this protection.",
} as const;

/** No explanation yet — said plainly, never filled in with made-up text. */
export class ExplanationPending extends Error {
  constructor(readonly reason: keyof typeof PENDING_MESSAGE) { super(PENDING_MESSAGE[reason]); }
}

/** Higgins' explanation of a Device Protection, for this OS / maker / version at the protection's own scope. */
export async function deviceProtectionExplanation(row: Pick<DeviceProtectionRow, "id" | "title" | "explanationScope">): Promise<ExplanationResult> {
  const platform = capabilityPlatform();
  const device = deviceFacts();
  const key = `device:${row.id}|${platform}|${row.explanationScope}|${row.explanationScope === "os" ? "" : `${device.manufacturer}|${device.osVersion}`}`;
  const local = (await cached())[key];
  if (local) return local;
  if (platform === "web") {
    // Not on a device: only the pre-written explanation can be shown — nothing is taught for a browser.
    const reviewed = await apiGet<ExplanationResult>(`/protections/device/${encodeURIComponent(row.id)}`).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) throw new ExplanationPending("device_only");
      throw error;
    });
    await remember(key, reviewed);
    return reviewed;
  }
  const result = await apiPost<ExplanationResult & { status?: string }>("/protections/device/explanation", "protection_explanation", {
    protectionId: row.id, title: row.title.slice(0, 80), platform,
    osVersion: device.osVersion ? String(device.osVersion).slice(0, 20) : null,
    oem: device.manufacturer ? device.manufacturer.slice(0, 40) : (Platform.OS === "ios" ? "apple" : null),
    model: device.model ? device.model.slice(0, 60) : null,
    scope: row.explanationScope,
  });
  if (result.status) throw new ExplanationPending(result.status === "limited" ? "limited" : "generating");
  await remember(key, result);
  return result;
}
