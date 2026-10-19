// Pending Settings action → return → fresh recheck (spec §10A ActionAttempt / S03).
// An ActionAttempt records that Apollo opened a destination — never that the setting changed. When the app becomes
// active again the pending attempt (and only that attempt, for its live case) is completed by taking a FRESH
// observation of the descriptor's bound capability and asking the case engine to compare it with the plan.
import { AppState, type AppStateStatus } from "react-native";

import * as api from "@/src/investigation/client";
import { CAPABILITIES, observe } from "@/src/investigation/deviceBroker";
import type { DeviceResult } from "@/src/investigation/types";
import { storage } from "@/src/utils/storage";
import { descriptorById } from "./guidance";

export interface ActionAttempt {
  id: string;
  kind?: "settings_recheck" | "restore_site";
  caseId: string | null;
  planId: string | null;
  descriptorId: string;
  startedAt: string;
  expiresAt?: string;
  returnedAt: string | null;
  status: "requested" | "opened" | "returned" | "failed";
}

export interface RecheckOutcome {
  attempt: ActionAttempt;
  observation: DeviceResult | null;
  evidenceId: string | null;
  /** Engine comparison when the attempt was bound to a plan with an expected observation. */
  plan: { outcome: "correct" | "not_yet_correct" | "cannot_observe" | "failed"; explanation: string } | null;
}

const KEY = "apollo.settings.pending_attempt";
const listeners = new Set<(o: RecheckOutcome) => void>();
let subscribed = false;
let lastState: AppStateStatus = AppState.currentState;

export async function pendingAttempt(): Promise<ActionAttempt | null> {
  const raw = await storage.getItem<string | null>(KEY, null).catch(() => null);
  try { return raw ? (JSON.parse(raw) as ActionAttempt) : null; } catch { return null; }
}

export async function recordAttempt(attempt: ActionAttempt): Promise<void> {
  await storage.setItem(KEY, JSON.stringify(attempt));
  ensureSubscribed();
}

export async function clearAttempt(): Promise<void> {
  await storage.removeItem(KEY).catch(() => undefined);
}

/** Capability the descriptor (or a `permission.<id>` attempt) can observe after return, or null when only the person can confirm. */
export function observationCapabilityFor(descriptorId: string): string | null {
  if (descriptorId.startsWith("permission.")) return descriptorId;
  const d = descriptorById(descriptorId);
  if (!d?.observes) return null;
  return d.observes === "protection" ? CAPABILITIES.protection : CAPABILITIES.permission(d.observes);
}

/** Completes a pending attempt with a fresh observation. A successful or cannot-observe recheck consumes the attempt; a FAILED recheck
 *  is retained (status "failed") so it can be retried explicitly with `retryFailedAttempt()` instead of being lost. */
export async function completeAttempt(attempt: ActionAttempt): Promise<RecheckOutcome> {
  const returned: ActionAttempt = { ...attempt, returnedAt: attempt.returnedAt ?? new Date().toISOString(), status: "returned" };
  if (attempt.kind === "restore_site") {
    const { completeSiteProtectionAttempt } = await import("@/src/protection/healthCoordinator");
    const restored = await completeSiteProtectionAttempt(attempt);
    return { attempt: restored ? returned : { ...returned, status: "failed" }, observation: null, evidenceId: null,
      plan: { outcome: restored ? "correct" : "not_yet_correct", explanation: restored ? "Site protection is running." : "Site protection still needs your approval." } };
  }
  const capabilityId = observationCapabilityFor(attempt.descriptorId);
  if (!capabilityId) { await clearAttempt(); return { attempt: returned, observation: null, evidenceId: null, plan: attempt.planId ? { outcome: "cannot_observe", explanation: "Apollo cannot read this setting on this device; only you can confirm what you changed." } : null }; }
  try {
    if (!attempt.caseId) throw new Error("This Settings check is not bound to a live investigation.");
    const fresh = await api.getCase(attempt.caseId);
    if (["cancelled", "expired", "failed"].includes(fresh.case.status)) { await clearAttempt(); return { attempt: { ...returned, status: "failed" }, observation: null, evidenceId: null, plan: null }; }
    const observation = await observe({ id: `recheck-${attempt.id}`, caseId: attempt.caseId, caseRevision: fresh.case.revision, capabilityId, fields: [], reason: `Fresh check after returning from ${attempt.descriptorId}`, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const { evidence } = await api.addObservationEvidence(fresh.case.revision, attempt.caseId, observation);
    let plan: RecheckOutcome["plan"] = null;
    if (attempt.planId) {
      const result = await api.recheckPlan(attempt.caseId, attempt.planId, [evidence.id]);
      plan = { outcome: result.outcome, explanation: result.explanation };
    }
    await clearAttempt();
    return { attempt: returned, observation, evidenceId: evidence.id, plan };
  } catch (e: unknown) {
    const failed: ActionAttempt = { ...returned, status: "failed" };
    await storage.setItem(KEY, JSON.stringify(failed)).catch(() => undefined); // retained for retry
    return { attempt: failed, observation: null, evidenceId: null, plan: { outcome: "failed", explanation: e instanceof Error ? e.message : "The fresh check could not be completed." } };
  }
}

/** Retries a retained failed recheck (user gesture). Returns null when nothing is pending. */
export async function retryFailedAttempt(): Promise<RecheckOutcome | null> {
  const attempt = await pendingAttempt();
  if (!attempt || attempt.status !== "failed") return null;
  const outcome = await completeAttempt(attempt);
  listeners.forEach((l) => l(outcome));
  return outcome;
}

/** Subscribe to recheck outcomes produced when the app returns from Settings. */
export function onRecheck(listener: (o: RecheckOutcome) => void): () => void {
  listeners.add(listener);
  ensureSubscribed();
  return () => { listeners.delete(listener); };
}

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  AppState.addEventListener("change", async (next) => {
    const cameBack = next === "active" && lastState !== "active";
    lastState = next;
    if (!cameBack) return;
    const attempt = await pendingAttempt();
    if (!attempt || attempt.status !== "opened") return;
    const outcome = await completeAttempt(attempt);
    listeners.forEach((l) => l(outcome));
  });
}
