// Action dispatcher for Higgins' recommended actions (spec §10A / S03). Only kinds with a real handler on THIS host render
// as buttons; `instruction` is text. `open_settings` executes exactly the bound descriptor (a platform intent on Android,
// the app's Settings page plus the path on iOS), records an ActionAttempt and lets `recheck.ts` take a fresh observation
// when the person returns — the attempt records that the destination opened, never that the setting changed.
import { Linking, Platform } from "react-native";

import * as api from "@/src/investigation/client";
import { CAPABILITIES, currentDeviceProfile, observe } from "@/src/investigation/deviceBroker";
import type { ActionProposal, DeviceResult, InvestigationCase } from "@/src/investigation/types";
import { securityAdapter } from "@/src/security/securityAdapter";
import type { ProtectionPermission } from "@/src/security/SecurityPlatformAdapter";
import { descriptorById, descriptorForTarget, type SettingsDescriptor } from "./guidance";
import { observationCapabilityFor, recordAttempt, type ActionAttempt } from "./recheck";

export type ActionOutcome =
  | { kind: "opened"; descriptor: SettingsDescriptor; attempt: ActionAttempt; iosPath: string | null; planId: string | null }
  | { kind: "requested"; attempt: ActionAttempt }
  | { kind: "opened_source" }
  | { kind: "observed"; result: DeviceResult; evidenceId: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "failed"; reason: string };

function boundDescriptor(action: ActionProposal): SettingsDescriptor | null {
  const byId = descriptorById(action.executionDescriptorId) ?? descriptorById(action.capabilityId);
  const supported = currentDeviceProfile().capabilityIds;
  if (byId) return supported.includes(byId.id) ? byId : null;
  const inferred = descriptorForTarget(`${action.label} ${action.instruction}`);
  return inferred && supported.includes(inferred.id) ? inferred : null;
}

export function isExecutable(action: ActionProposal): boolean {
  if (action.kind === "instruction") return false;
  if (action.kind === "open_verified_source") return action.sourceIds.length > 0;
  if (action.kind === "open_settings") return boundDescriptor(action) != null;
  return !!action.capabilityId && currentDeviceProfile().capabilityIds.includes(action.capabilityId);
}

async function openDescriptor(d: SettingsDescriptor): Promise<string | null> {
  if (Platform.OS === "android" && d.androidIntent) { await Linking.sendIntent(d.androidIntent); return null; }
  if (Platform.OS === "ios") { await Linking.openSettings(); return d.iosPath ?? "Apollo"; }
  if (Platform.OS === "android") { await Linking.openSettings(); return null; }
  if (d.desktopTarget && (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    const { openDesktopSettings } = await import("@/src/security/DesktopSecurityAdapter");
    await openDesktopSettings(d.desktopTarget); return null;
  }
  throw new Error("This platform has no Settings destination Apollo can open.");
}

/** Creates and binds the settings plan for a descriptor BEFORE the destination opens, so the return recheck can compare against it.
 *  The intended field/value is ALWAYS the structured intent Higgins attached to the action — never inferred from `label`/
 *  `instruction` wording. When Higgins left it null (no single observable target, or genuinely ambiguous), the plan is bound
 *  with `expectedValue: null`, which the backend leaves unobservable — the recheck then reports "cannot_observe" rather than
 *  guessing a direction. */
async function bindPlan(action: ActionProposal, caseData: InvestigationCase, descriptor: SettingsDescriptor): Promise<string | null> {
  const capabilityId = observationCapabilityFor(descriptor.id);
  try {
    const fresh = await api.getCase(caseData.id);
    const { plan } = await api.createSettingsPlan(caseData.id, {
      expectedRevision: fresh.case.revision, target: `${action.label}. ${action.instruction}`.slice(0, 300), device: currentDeviceProfile(),
      capabilityId, expectedField: action.desiredField ?? (capabilityId?.startsWith("permission.") ? "granted" : capabilityId === CAPABILITIES.protection ? "running" : "state"),
      expectedValue: action.desiredValue ?? null,
    });
    return plan.id;
  } catch {
    return null; // the destination still opens; the recheck then reports "cannot compare" instead of pretending to
  }
}

/** Same binding for a `request_permission` action, which has no Settings descriptor of its own — only the capability the
 *  permission observes. Intent still comes exclusively from `action.desiredField`/`desiredValue`. */
async function bindPermissionPlan(action: ActionProposal, caseData: InvestigationCase): Promise<string | null> {
  if (!action.capabilityId) return null;
  try {
    const fresh = await api.getCase(caseData.id);
    const { plan } = await api.createSettingsPlan(caseData.id, {
      expectedRevision: fresh.case.revision, target: `${action.label}. ${action.instruction}`.slice(0, 300), device: currentDeviceProfile(),
      capabilityId: action.capabilityId, expectedField: action.desiredField ?? "granted", expectedValue: action.desiredValue ?? null,
    });
    return plan.id;
  } catch {
    return null;
  }
}

/** Runs a supported action after a user gesture. Attempts are recorded BEFORE launching anything the person must return from. */
export async function runAction(action: ActionProposal, caseData: InvestigationCase, planId: string | null = null): Promise<ActionOutcome> {
  try {
    if (action.kind === "open_settings") {
      const descriptor = boundDescriptor(action);
      if (!descriptor) return { kind: "unsupported", reason: "Apollo cannot open that Settings destination on this device; follow the written steps instead." };
      const boundPlanId = planId ?? await bindPlan(action, caseData, descriptor);
      const attempt: ActionAttempt = { id: `${caseData.id}:${action.id}:${Date.now()}`, caseId: caseData.id, planId: boundPlanId, descriptorId: descriptor.id, startedAt: new Date().toISOString(), returnedAt: null, status: "requested" };
      await recordAttempt(attempt); // recorded before the launch: a crash or kill while in Settings still leaves a resumable attempt
      const iosPath = await openDescriptor(descriptor);
      await recordAttempt({ ...attempt, status: "opened" });
      return { kind: "opened", descriptor, attempt: { ...attempt, status: "opened" }, iosPath, planId: boundPlanId };
    }
    if (!action.capabilityId) return { kind: "unsupported", reason: "This action has no supported device capability." };
    if (!currentDeviceProfile().capabilityIds.includes(action.capabilityId)) return { kind: "unsupported", reason: "This device does not implement that observation." };
    if (action.kind === "request_permission" && action.capabilityId.startsWith("permission.")) {
      const id = action.capabilityId.slice("permission.".length) as ProtectionPermission["id"];
      const boundPlanId = planId ?? await bindPermissionPlan(action, caseData);
      const attempt: ActionAttempt = { id: `${caseData.id}:${action.id}:${Date.now()}`, caseId: caseData.id, planId: boundPlanId, descriptorId: action.capabilityId, startedAt: new Date().toISOString(), returnedAt: null, status: "requested" };
      await recordAttempt(attempt);
      await securityAdapter.requestProtectionPermission(id); // requested ≠ granted
      if (Platform.OS === "android" || Platform.OS === "ios") {
        // Native requests hand control to system UI/Settings; the fresh observation is taken when the person returns (recheck.ts).
        await recordAttempt({ ...attempt, status: "opened" });
        return { kind: "requested", attempt: { ...attempt, status: "opened" } };
      }
      // Browser/preview prompts resolve in-page: the app never leaves, so observe now and consume the attempt.
      const { completeAttempt } = await import("./recheck");
      const outcome = await completeAttempt({ ...attempt, status: "opened" });
      return outcome.observation && outcome.evidenceId ? { kind: "observed", result: outcome.observation, evidenceId: outcome.evidenceId } : { kind: "failed", reason: outcome.plan?.explanation ?? "The fresh check could not be completed." };
    }
    if (action.kind === "recheck") {
      const result = await observe({ id: `local-${Date.now()}`, caseId: caseData.id, caseRevision: caseData.revision, capabilityId: action.capabilityId, fields: [], reason: action.instruction, expiresAt: new Date(Date.now() + 60000).toISOString() });
      const fresh = await api.getCase(caseData.id);
      const { evidence } = await api.addObservationEvidence(fresh.case.revision, caseData.id, result);
      return { kind: "observed", result, evidenceId: evidence.id };
    }
    return { kind: "unsupported", reason: `Apollo cannot perform '${action.kind}' on this device.` };
  } catch (e: unknown) {
    return { kind: "failed", reason: e instanceof Error ? e.message : "The action could not be completed." };
  }
}

export const RECHECK_CAPABILITY = CAPABILITIES.protection;
