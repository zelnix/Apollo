import { Platform } from "react-native";

import { getNativeModule } from "@/src/security/nativeBridge";
import type { SharedPayload } from "./classifyShare";

type NativeResult = { status: "ready" | "missing" | "expired" | "invalid"; handoffId: string; payload?: SharedPayload; detail?: string };

function nativeModule() {
  if (Platform.OS !== "ios") return null;
  return getNativeModule();
}

export async function loadNativeShareHandoff(id: string): Promise<SharedPayload> {
  const module = nativeModule();
  if (!module?.getShareHandoff) throw new Error("This Apollo build cannot open the protected share handoff.");
  const result = JSON.parse(await module.getShareHandoff(id)) as NativeResult;
  if (result.status !== "ready" || !result.payload) throw new Error(result.detail || "The shared items are no longer available. Share them with Apollo again.");
  return result.payload;
}

export async function acknowledgeNativeShareHandoff(id: string | undefined) {
  const module = nativeModule();
  if (id && module?.acknowledgeShareHandoff) await module.acknowledgeShareHandoff(id);
}

export async function discardNativeShareHandoff(id: string | undefined) {
  const module = nativeModule();
  if (id && module?.discardShareHandoff) await module.discardShareHandoff(id);
}