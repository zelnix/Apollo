import { requireOptionalNativeModule, requireNativeViewManager } from "expo-modules-core";
import { createElement } from "react";
import { View, type ViewProps } from "react-native";

import type { FamilyAssistCapabilities, FamilyAssistNativeState, StartFamilyAssistCaptureInput, StartFamilyAssistViewerInput } from "./src/ApolloFamilyAssist.types";

interface NativeModule {
  getCapabilities(): Promise<FamilyAssistCapabilities>;
  getState(): Promise<FamilyAssistNativeState>;
  startCapture(input: StartFamilyAssistCaptureInput): Promise<void>;
  pauseCapture(sessionId: string, generation: string): Promise<void>;
  resumeCapture(sessionId: string, generation: string): Promise<void>;
  stopCapture(sessionId: string, generation: string): Promise<void>;
  startViewer(input: StartFamilyAssistViewerInput): Promise<void>;
  stopViewer(sessionId: string, generation: string): Promise<void>;
}

const unavailable = async () => { throw new Error("Family Help requires an installed Apollo mobile build."); };
const fallback: NativeModule = {
  getCapabilities: async () => ({ platform: "android", screenShare: "unavailable", supportedScopes: [], helperViewing: "unavailable", liveMicrophone: "unavailable", systemAudio: "not_supported", remoteControl: "not_supported", unavailableReason: "not_implemented", observedAt: new Date().toISOString() }),
  getState: async () => ({ sessionId: null, generation: null, captureState: "idle", helperConnected: false, captureScope: null, microphoneEnabled: false, startedAt: null, lastTransitionAt: new Date().toISOString(), failureCode: null }),
  startCapture: unavailable, pauseCapture: unavailable, resumeCapture: unavailable, stopCapture: unavailable,
  startViewer: unavailable, stopViewer: unavailable,
};
const nativeModule = requireOptionalNativeModule<NativeModule>("ApolloFamilyAssist");
export const ApolloFamilyAssist = nativeModule ?? fallback;
const NativeViewer = nativeModule ? requireNativeViewManager("ApolloFamilyAssist") : View;
export function FamilyAssistViewer(props: ViewProps) { return createElement(NativeViewer, props); }
export type * from "./src/ApolloFamilyAssist.types";