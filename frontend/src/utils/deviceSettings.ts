// Gate 7 — jump the user to the relevant OS settings page. Android exposes specific settings intents;
// iOS only lets an app open its own settings page, so we open Settings and show the path to follow.
import { Linking, Platform } from "react-native";

export type SettingsTarget = "apps" | "accessibility" | "vpn" | "security" | "unknown_sources" | "overlay" | "notification_access" | "developer";

const ANDROID_INTENT: Record<SettingsTarget, string> = {
  apps: "android.settings.MANAGE_APPLICATIONS_SETTINGS",
  accessibility: "android.settings.ACCESSIBILITY_SETTINGS",
  vpn: "android.settings.VPN_SETTINGS",
  security: "android.settings.SECURITY_SETTINGS",
  unknown_sources: "android.settings.MANAGE_UNKNOWN_APP_SOURCES",
  overlay: "android.settings.action.MANAGE_OVERLAY_PERMISSION",
  notification_access: "android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS",
  developer: "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
};

export async function openDeviceSettings(target: SettingsTarget, path: string, toast: (m: string) => void) {
  try {
    if (Platform.OS === "android") { await Linking.sendIntent(ANDROID_INTENT[target]); return; }
    if (Platform.OS === "ios") { toast(`In Settings go to: ${path}`); await Linking.openSettings(); return; }
    toast(`On your phone: ${path}`);
  } catch { toast(`Open Settings on your phone: ${path}`); }
}
