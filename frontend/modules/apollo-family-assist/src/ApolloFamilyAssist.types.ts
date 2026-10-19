export type CaptureScope = "apollo_app" | "selected_app" | "full_display";
export type CaptureState = "idle" | "requesting_consent" | "starting" | "active" | "paused" | "stopping" | "stopped" | "failed";
export type FamilyAssistNativeEvent = "consent_shown" | "consent_denied" | "capture_started" | "capture_paused" | "capture_stopped" | "helper_connected" | "helper_disconnected" | "transport_degraded" | "capture_failed";

export interface FamilyAssistCapabilities {
  platform: "android" | "ios" | "windows" | "macos";
  screenShare: "available" | "permission_required" | "unavailable";
  supportedScopes: CaptureScope[];
  helperViewing: "available" | "unavailable";
  liveMicrophone: "unavailable";
  systemAudio: "not_supported";
  remoteControl: "not_supported";
  unavailableReason: "os_restricted" | "not_implemented" | "configuration_missing" | "observation_failed" | null;
  observedAt: string;
}

export interface FamilyAssistNativeState {
  sessionId: string | null; generation: string | null; captureState: CaptureState;
  helperConnected: boolean; captureScope: CaptureScope | null; microphoneEnabled: false;
  startedAt: string | null; lastTransitionAt: string; failureCode: string | null;
  endReason?: string | null;
}

export interface FamilyAssistNativeEventPayload extends FamilyAssistNativeState {
  type: FamilyAssistNativeEvent | "capture_starting";
  observedAt: string;
}

export interface StartFamilyAssistCaptureInput {
  sessionId: string; generation: string; captureScope: CaptureScope; microphoneEnabled: false;
  ephemeralSignalingTicket: string; signalingBaseUrl: string; helperDisplayName: string; expiresAt: string;
}

export interface StartFamilyAssistViewerInput {
  sessionId: string; generation: string; ephemeralSignalingTicket: string; signalingBaseUrl: string;
}