export type CaptureDecision = "ignore" | "connecting" | "active" | "failed" | "ended";

export function nativeCaptureDecision(serverState: string, nativeState: string, sameGeneration: boolean): CaptureDecision {
  if (!sameGeneration || ["ended", "expired", "revoked", "failed"].includes(serverState)) return "ignore";
  if (nativeState === "failed") return "failed";
  if (nativeState === "stopped") return "ended";
  if (nativeState === "starting" && serverState === "awaiting_capture_consent") return "connecting";
  if (nativeState === "active" && ["awaiting_capture_consent", "connecting"].includes(serverState)) return "active";
  return "ignore";
}

export const captureControlFor = (serverState: string): "pause" | "resume" | null => serverState === "active" ? "pause" : serverState === "paused" ? "resume" : null;
export const helperCanView = (role: string, serverState: string) => role === "helper" && ["awaiting_capture_consent", "connecting", "active", "paused"].includes(serverState);