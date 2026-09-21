// Settings execution descriptors (spec §10A / S03). A descriptor names ONE supported destination on ONE platform.
// The device broker advertises only the descriptors this host can actually execute, the backend binds a SettingsPlan
// to one of them, and `actions.ts` executes exactly that descriptor — never a generic "open settings" for everything.
// Applicability is decided by the running platform, not by an OEM name appearing in a search result.
import { Platform } from "react-native";

import type { ProtectionPermission } from "@/src/security/SecurityPlatformAdapter";

export type SettingsPlatform = "android" | "ios" | "web";

export interface SettingsDescriptor {
  /** Capability id advertised to the case engine, e.g. "open_settings.vpn". */
  id: string;
  label: string;
  platforms: SettingsPlatform[];
  /** Android: the Settings intent action Linking.sendIntent can launch. */
  androidIntent?: string;
  /** iOS: Apple only lets an app open its own Settings page; this is the path the person follows from there. */
  iosPath?: string;
  /** Observation that can confirm the outcome after returning (null = only the person can confirm). */
  observes: ProtectionPermission["id"] | "protection" | null;
  /** Keywords used to match a plan target such as "enable notifications" to this descriptor. */
  keywords: string[];
}

export const SETTINGS_DESCRIPTORS: readonly SettingsDescriptor[] = [
  { id: "open_settings.app", label: "Open Apollo's settings", platforms: ["android", "ios"], iosPath: "Apollo", observes: null, keywords: ["apollo", "app settings", "this app"] },
  { id: "open_settings.notifications", label: "Open notification settings", platforms: ["android", "ios"], androidIntent: "android.settings.APP_NOTIFICATION_SETTINGS", iosPath: "Apollo › Notifications", observes: "notifications", keywords: ["notification", "alert"] },
  { id: "open_settings.vpn", label: "Open VPN settings", platforms: ["android"], androidIntent: "android.settings.VPN_SETTINGS", observes: "vpn_config", keywords: ["vpn", "dns filter", "site gate"] },
  { id: "open_settings.accessibility", label: "Open accessibility settings", platforms: ["android"], androidIntent: "android.settings.ACCESSIBILITY_SETTINGS", observes: null, keywords: ["accessibility"] },
  { id: "open_settings.notification_access", label: "Open notification access", platforms: ["android"], androidIntent: "android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS", observes: null, keywords: ["notification access", "notification listener", "text gate"] },
  { id: "open_settings.security", label: "Open security settings", platforms: ["android"], androidIntent: "android.settings.SECURITY_SETTINGS", observes: null, keywords: ["security", "lock screen", "screen lock", "play protect"] },
  { id: "open_settings.unknown_sources", label: "Open unknown-sources settings", platforms: ["android"], androidIntent: "android.settings.MANAGE_UNKNOWN_APP_SOURCES", observes: null, keywords: ["unknown source", "install unknown", "sideload"] },
  { id: "open_settings.overlay", label: "Open display-over-apps settings", platforms: ["android"], androidIntent: "android.settings.action.MANAGE_OVERLAY_PERMISSION", observes: null, keywords: ["overlay", "display over", "draw over"] },
  { id: "open_settings.developer", label: "Open developer options", platforms: ["android"], androidIntent: "android.settings.APPLICATION_DEVELOPMENT_SETTINGS", observes: null, keywords: ["developer", "usb debugging"] },
  { id: "open_settings.apps", label: "Open app list", platforms: ["android"], androidIntent: "android.settings.MANAGE_APPLICATIONS_SETTINGS", observes: null, keywords: ["uninstall", "installed app", "app list", "app info"] },
  { id: "open_settings.safari_extensions", label: "Open Safari extension settings", platforms: ["ios"], iosPath: "Safari › Extensions › Apollo", observes: "network_filter", keywords: ["safari", "content blocker", "extension", "site gate"] },
];

export function currentSettingsPlatform(): SettingsPlatform {
  return Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web";
}

/** Descriptors this host can execute right now (web can execute none — the browser has no Settings destinations). */
export function supportedSettingsDescriptors(platform: SettingsPlatform = currentSettingsPlatform()): SettingsDescriptor[] {
  return SETTINGS_DESCRIPTORS.filter((d) => d.platforms.includes(platform));
}

export function descriptorById(id: string | null | undefined): SettingsDescriptor | null {
  return id ? SETTINGS_DESCRIPTORS.find((d) => d.id === id) ?? null : null;
}

/** Best supported descriptor for a plan target on this host; null when only instructions can be offered. */
export function descriptorForTarget(target: string, platform: SettingsPlatform = currentSettingsPlatform()): SettingsDescriptor | null {
  const t = target.toLowerCase();
  const candidates = supportedSettingsDescriptors(platform);
  return candidates.find((d) => d.id !== "open_settings.app" && d.keywords.some((k) => t.includes(k))) ?? candidates.find((d) => d.id === "open_settings.app") ?? null;
}
