import { Platform } from "react-native";
import { ApolloFamilyAssist } from "@/modules/apollo-family-assist";
import type { FamilyAssistNativeEventPayload, FamilyAssistNativeState } from "@/modules/apollo-family-assist";
import type { AssistSession, SignalingTicket } from "./contracts";
import { signalingBaseUrl } from "./api";

export async function startNativeCapture(session: AssistSession, ticket: SignalingTicket) {
  if (Platform.OS !== "android" && Platform.OS !== "ios") throw new Error("Screen sharing is only available in the Apollo mobile app.");
  await ApolloFamilyAssist.startCapture({ sessionId: session.sessionId, generation: session.generation, captureScope: session.captureScope,
    microphoneEnabled: false, ephemeralSignalingTicket: ticket.ticket, signalingBaseUrl, helperDisplayName: session.helperDisplayName, expiresAt: ticket.expiresAt });
}
export async function startNativeViewer(session: AssistSession, ticket: SignalingTicket) {
  await ApolloFamilyAssist.startViewer({ sessionId: session.sessionId, generation: session.generation, ephemeralSignalingTicket: ticket.ticket, signalingBaseUrl });
}
export const observeNativeFamilyHelp = (listener: (event: FamilyAssistNativeEventPayload) => void) => ApolloFamilyAssist.addListener("onFamilyAssistEvent", listener);
export const getNativeFamilyHelpState = (): Promise<FamilyAssistNativeState> => ApolloFamilyAssist.getState();
export const pauseNative = (session: AssistSession) => ApolloFamilyAssist.pauseCapture(session.sessionId, session.generation);
export const resumeNative = (session: AssistSession) => ApolloFamilyAssist.resumeCapture(session.sessionId, session.generation);
export const stopNative = (session: AssistSession) => ApolloFamilyAssist.stopCapture(session.sessionId, session.generation);
export const stopNativeByIdentity = (sessionId: string, generation: string) => ApolloFamilyAssist.stopCapture(sessionId, generation);
export const stopNativeViewer = (session: AssistSession) => ApolloFamilyAssist.stopViewer(session.sessionId, session.generation);
export const stopNativeViewerByIdentity = (sessionId: string, generation: string) => ApolloFamilyAssist.stopViewer(sessionId, generation);