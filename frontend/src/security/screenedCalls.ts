// Bridge for "Calls Apollo screened" (Android). Reads only what ApolloCallScreeningService recorded
// from calls Android handed it — no permission, no call-log access. Unsupported elsewhere.
import { Platform } from "react-native";

import { parseScreenedCalls, type ScreenedCall } from "@/src/domain/screenedCalls";
import { getNativeModule } from "./nativeBridge";

export const ScreenedCalls = {
  isSupported: (): boolean => Platform.OS === "android" && typeof getNativeModule()?.getScreenedCalls === "function",
  list: async (): Promise<ScreenedCall[]> => {
    const m = getNativeModule();
    if (!m?.getScreenedCalls) return [];
    try { return parseScreenedCalls(await m.getScreenedCalls()); } catch { return []; }
  },
  clear: async (): Promise<void> => {
    const m = getNativeModule();
    if (m?.clearScreenedCalls) await m.clearScreenedCalls();
  },
};
