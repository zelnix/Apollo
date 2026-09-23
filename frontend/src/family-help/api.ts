import { API_BASE, apiDelete, apiGet, apiPost } from "@/src/api/client";
import type { AssistSession, Capabilities, CaptureScope, SignalingTicket } from "./contracts";

export const getFamilyHelpCapabilities = () => apiGet<Capabilities>("/family/assist/capabilities");
export const getFamilyHelpSession = (id: string) => apiGet<AssistSession>(`/family/assist/sessions/${id}`);
export const getFamilyHelpInvitations = () => apiGet<AssistSession[]>("/family/assist/invitations");
export const createFamilyHelpSession = (relationshipId: string, sharerDeviceId: string, captureScope: CaptureScope, clientRequestId: string) =>
  apiPost<AssistSession>("/family/assist/sessions", "family", { relationshipId, sharerDeviceId, captureScope, microphoneRequested: false, clientRequestId });
export const respondFamilyHelpSession = (session: AssistSession, helperDeviceId: string, decision: "accept" | "decline") =>
  apiPost<AssistSession>(`/family/assist/sessions/${session.sessionId}/respond`, "family", { helperDeviceId, decision, expectedRevision: session.revision });
export const issueSignalingTicket = (id: string) => apiPost<SignalingTicket>(`/family/assist/sessions/${id}/signaling-ticket`, "family", {});
export const commandFamilyHelp = (session: AssistSession, action: "pause" | "resume" | "extend") => apiPost<AssistSession>(`/family/assist/sessions/${session.sessionId}/${action}`, "family", { expectedRevision: session.revision });
export const publishNativeState = (session: AssistSession, nativeState: "connecting" | "active" | "failed", failureCode?: string) => apiPost<AssistSession>(`/family/assist/sessions/${session.sessionId}/native-state`, "family", { expectedRevision: session.revision, generation: session.generation, nativeState, failureCode });
export const endFamilyHelp = (session: AssistSession) => apiDelete<AssistSession>(`/family/assist/sessions/${session.sessionId}?expectedRevision=${session.revision}`);
export const signalingBaseUrl = API_BASE;