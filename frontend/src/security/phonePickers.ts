// Call Gate / Text Gate on-demand pickers (Android only). READ_CALL_LOG / READ_SMS are Google Play
// restricted permissions, absent from every build unless the approved build switch declares them
// (plugins/withRestrictedPhonePermissions.js → expo extra.restrictedPhonePermissions). While a
// permission is absent its picker is hidden; when present the user still grants it explicitly and these
// helpers never auto-read. They degrade to empty lists off-Android, when undeclared, or when denied.
import Constants from "expo-constants";
import { Platform } from "react-native";
import { restrictedPickerDeclared, type RestrictedPicker } from "@/src/domain/restrictedPickers";
import { getNativeModule } from "./nativeBridge";

export type RuntimePermission = RestrictedPicker;
export interface RecentCall { number: string; name: string | null; date: number; type: string }
export interface RecentSms { address: string; body: string; date: number }

/** Build-time declaration of the restricted permission for this build. */
export function pickerDeclaredByBuild(name: RuntimePermission): boolean {
  return restrictedPickerDeclared(name, Constants.expoConfig?.extra);
}

async function parse<T>(fn: (() => Promise<string>) | undefined, fallback: T): Promise<T> {
  if (!fn) return fallback;
  try { return JSON.parse(await fn()) as T; } catch { return fallback; }
}

export const PhonePickers = {
  /** True only on a native Android build that declares this permission and exposes the picker methods. */
  isSupported: (name: RuntimePermission): boolean => {
    const m = getNativeModule();
    return Platform.OS === "android" && pickerDeclaredByBuild(name) && !!m && typeof m.listRecentCalls === "function";
  },
  hasPermission: (name: RuntimePermission) => { const m = getNativeModule(); return parse<{ granted: boolean; declared?: boolean }>(m?.hasRuntimePermission ? () => m.hasRuntimePermission(name) : undefined, { granted: false }); },
  requestPermission: (name: RuntimePermission) => { const m = getNativeModule(); return parse<{ requested: boolean; granted?: boolean; reason?: string }>(m?.requestRuntimePermission ? () => m.requestRuntimePermission(name) : undefined, { requested: false }); },
  listRecentCalls: () => { const m = getNativeModule(); return parse<RecentCall[]>(m?.listRecentCalls ? () => m.listRecentCalls() : undefined, []); },
  listRecentSms: () => { const m = getNativeModule(); return parse<RecentSms[]>(m?.listRecentSms ? () => m.listRecentSms() : undefined, []); },
};
