// Action dispatcher for Higgins' recommended actions. Only kinds with a real handler render as buttons; `instruction` is text.
import { Linking } from "react-native";

import * as api from "@/src/investigation/client";
import { CAPABILITIES, observe } from "@/src/investigation/deviceBroker";
import type { ActionProposal, DeviceResult, InvestigationCase } from "@/src/investigation/types";
import { securityAdapter } from "@/src/security/securityAdapter";
import type { ProtectionPermission } from "@/src/security/SecurityPlatformAdapter";

export type ActionOutcome = { kind: "opened" } | { kind: "observed"; result: DeviceResult; evidenceId: string } | { kind: "unsupported"; reason: string } | { kind: "failed"; reason: string };

export function isExecutable(action: ActionProposal): boolean {
  if (action.kind === "instruction") return false;
  if (action.kind === "open_verified_source") return action.sourceIds.length > 0;
  return !!action.capabilityId;
}

/** Runs a supported action after a user gesture and records the fresh observation as case evidence (never as user confirmation). */
export async function runAction(action: ActionProposal, caseData: InvestigationCase): Promise<ActionOutcome> {
  try {
    if (action.kind === "open_settings") { await Linking.openSettings(); return { kind: "opened" }; }
    if (!action.capabilityId) return { kind: "unsupported", reason: "This action has no supported device capability." };
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
