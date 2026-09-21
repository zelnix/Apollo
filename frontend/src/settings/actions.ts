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
import { recordAttempt, type ActionAttempt } from "./recheck";

export type ActionOutcome =
  | { kind: "opened"; descriptor: SettingsDescriptor; attempt: ActionAttempt; iosPath: string | null }
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
  throw new Error("This platform has no Settings destination Apollo can open.");
}

/** Runs a supported action after a user gesture and records the fresh observation as case evidence (never as user confirmation). */
export async function runAction(action: ActionProposal, caseData: InvestigationCase, planId: string | null = null): Promise<ActionOutcome> {
  try {
    if (action.kind === "open_settings") {
      const descriptor = boundDescriptor(action);
      if (!descriptor) return { kind: "unsupported", reason: "Apollo cannot open that Settings destination on this device; follow the written steps instead." };
      const attempt: ActionAttempt = { id: `${caseData.id}:${action.id}:${Date.now()}`, caseId: caseData.id, planId, descriptorId: descriptor.id, startedAt: new Date().toISOString(), returnedAt: null, status: "requested" };
      const iosPath = await openDescriptor(descriptor);
      await recordAttempt({ ...attempt, status: "opened" });
      return { kind: "opened", descriptor, attempt: { ...attempt, status: "opened" }, iosPath };
    }
    if (!action.capabilityId) return { kind: "unsupported", reason: "This action has no supported device capability." };
    if (!currentDeviceProfile().capabilityIds.includes(action.capabilityId)) return { kind: "unsupported", reason: "This device does not implement that observation." };
    if (action.kind === "request_permission" && action.capabilityId.startsWith("permission.")) {
      const id = action.capabilityId.slice("permission.".length) as ProtectionPermission["id"];
      await securityAdapter.requestProtectionPermission(id); // requested ≠ granted: the observation below reports the actual state
    }
    if (action.kind === "request_permission" || action.kind === "recheck") {
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
