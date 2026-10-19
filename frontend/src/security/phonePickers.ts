// Call Gate / Text Gate on-demand pickers (Android only). The user grants READ_CALL_LOG / READ_SMS
// explicitly; these helpers never auto-read and degrade to empty lists off-Android or when denied.
import { Platform } from "react-native";
import { getNativeModule } from "./nativeBridge";

export type RuntimePermission = "call_log" | "sms";
export interface RecentCall { number: string; name: string | null; date: number; type: string }
export interface RecentSms { address: string; body: string; date: number }

async function parse<T>(fn: (() => Promise<string>) | undefined, fallback: T): Promise<T> {
  if (!fn) return fallback;
  try { return JSON.parse(await fn()) as T; } catch { return fallback; }
}

export const PhonePickers = {
  /** True only on a native Android build that exposes the picker methods. */
  isSupported: (): boolean => { const m = getNativeModule(); return Platform.OS === "android" && !!m && typeof m.listRecentCalls === "function"; },
  hasPermission: (name: RuntimePermission) => { const m = getNativeModule(); return parse<{ granted: boolean }>(m?.hasRuntimePermission ? () => m.hasRuntimePermission(name) : undefined, { granted: false }); },
  requestPermission: (name: RuntimePermission) => { const m = getNativeModule(); return parse<{ requested: boolean; granted?: boolean; reason?: string }>(m?.requestRuntimePermission ? () => m.requestRuntimePermission(name) : undefined, { requested: false }); },
  listRecentCalls: () => { const m = getNativeModule(); return parse<RecentCall[]>(m?.listRecentCalls ? () => m.listRecentCalls() : undefined, []); },
  listRecentSms: () => { const m = getNativeModule(); return parse<RecentSms[]>(m?.listRecentSms ? () => m.listRecentSms() : undefined, []); },
};
