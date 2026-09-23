import type { FamilyAssistNativeState } from "@/modules/apollo-family-assist";
import { endFamilyHelpById, getFamilyHelpSession, publishNativeState } from "./api";
import type { AssistSession } from "./contracts";
import { nativeCaptureDecision } from "./stateMachine";

const terminal = new Set(["ended", "expired", "revoked", "failed"]);

async function publish(session: AssistSession, state: "connecting" | "active" | "failed", failureCode?: string) {
  try { return await publishNativeState(session, state, failureCode); }
  catch { return getFamilyHelpSession(session.sessionId); }
}

export async function reconcileNativeCapture(sessionId: string, native: FamilyAssistNativeState): Promise<AssistSession> {
  let session = await getFamilyHelpSession(sessionId);
  const decision = nativeCaptureDecision(session.state, native.captureState, native.sessionId === sessionId && native.generation === session.generation);
  if (decision === "ignore" || terminal.has(session.state)) return session;
  if (decision === "connecting") session = await publish(session, "connecting");
  if (decision === "active") {
    if (session.state === "awaiting_capture_consent") session = await publish(session, "connecting");
    if (session.state === "connecting") session = await publish(session, "active");
  }
  if (decision === "failed") session = await publish(session, "failed", native.failureCode ?? "native_failed");
  if (decision === "ended") {
    try { session = await endFamilyHelpById(sessionId); }
    catch { session = await getFamilyHelpSession(sessionId); }
  }
  return session;
}