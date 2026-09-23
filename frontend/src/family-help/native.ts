import { Platform } from "react-native";
import { ApolloFamilyAssist } from "@/modules/apollo-family-assist";
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
export const stopNative = (session: AssistSession) => ApolloFamilyAssist.stopCapture(session.sessionId, session.generation);