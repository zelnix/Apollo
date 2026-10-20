// Gate 7 — Security SDK contract for apps & device protection. Android (Kotlin) can see package installs,
// permissions, accessibility/overlay/notification access and VPN state; iOS (Swift) can only report profiles,
// VPN and its own state. Every method degrades to "not visible" — the UI never invents signals.
import type { AppNetwork, AppPermission } from "@/src/domain/appAnalysis";
import { EMPTY_SIGNALS, type DevicePlatform, type DeviceSignals } from "@/src/domain/deviceAnalysis";
import { getNativeModule } from "./nativeBridge";
import { nativeJson } from "./nativeDiagnostics";

export type AppDeviceCapabilityStatus = "supported" | "permission_required" | "unsupported";
export interface AppDeviceCapabilities { installEvents: AppDeviceCapabilityStatus; appPermissions: AppDeviceCapabilityStatus; accessibilityServices: AppDeviceCapabilityStatus; overlayApps: AppDeviceCapabilityStatus; notificationAccess: AppDeviceCapabilityStatus; vpnState: AppDeviceCapabilityStatus; profileState: AppDeviceCapabilityStatus; appNetworkCorrelation: AppDeviceCapabilityStatus }
export interface SdkAppAssessment { packageId: string; appName: string; developer: string | null; installSource: "app_store" | "play_store" | "browser" | "message" | "other_store" | "not_sure"; installedAt: string | null; permissions: string[]; requestedPermissions: string[]; grantedPermissions: string[]; permissionStates: { permission: string; requested: true; granted: boolean | null; basis: "package_manager" }[]; specialAccessStates: { access: "display_over_other_apps" | "accessibility_service" | "notification_listener"; granted: boolean | null; basis: "app_ops" | "settings_secure" }[]; remoteAccessCapability: boolean; network: AppNetwork | null }
export interface SdkAppSecurityEvent { eventType: "app_install" | "permission_change" | "service_enabled" | "vpn_change" | "profile_change" | "app_network"; status: "low_risk" | "suspicious" | "high_risk"; riskScore: number; confidence: "low" | "medium" | "high"; appName: string | null; packageId: string | null; installSource: string | null; remoteAccessCapability: boolean; relatedThreatScent: string | null; recommendedDogState: "resting" | "ears_up" | "growling" | "barking" | "biting"; recommendedAction: string; occurredAt: string }
export interface InstalledAppRef { packageId: string; appName: string }

const UNSUPPORTED: AppDeviceCapabilities = { installEvents: "unsupported", appPermissions: "unsupported", accessibilityServices: "unsupported", overlayApps: "unsupported", notificationAccess: "unsupported", vpnState: "unsupported", profileState: "unsupported", appNetworkCorrelation: "unsupported" };
// Absent module → the declared "no such capability on this host" value. Present but failing →
// throws NativeCallFailed and is recorded in diagnostics, never read as "nothing found".
async function call<T>(operation: string, fn: (() => Promise<string>) | undefined, whenAbsent: T): Promise<T> {
  return nativeJson<T>(operation, fn, whenAbsent);
}

/** Plain permission names reported by the native SDK (AppDeviceCatalog.PERMISSION_LABELS) → App engine permission ids. */
const SDK_PERMISSION_MAP: Record<string, AppPermission> = {
  "Read SMS": "sms", "Receive SMS": "sms", "Send SMS": "sms", "Contacts": "contacts", "Camera": "camera", "Microphone": "microphone",
  "Precise location": "location", "Location": "location", "Call log": "calls", "Make calls": "calls", "Phone state": "calls",
  "Display over other apps": "overlay", "Accessibility service": "accessibility", "Install other apps": "install_apps", "Photos": "files", "Files": "files",
  "Notifications": "notifications", "Read notifications": "notifications", "Device admin": "device_admin",
};
export function sdkPermissionsToApp(labels: string[]): AppPermission[] { return Array.from(new Set(labels.map((l) => SDK_PERMISSION_MAP[l]).filter((p): p is AppPermission => !!p))); }

export const AppDeviceSdk = {
  getAppDeviceCapabilities: () => { const m = getNativeModule(); return call<AppDeviceCapabilities>("getAppDeviceCapabilities", m ? () => m.getAppDeviceCapabilities() : undefined, UNSUPPORTED); },
  getInstalledAppAssessment: (packageId: string) => { const m = getNativeModule(); return call<SdkAppAssessment | null>("getInstalledAppAssessment", m ? () => m.getInstalledAppAssessment(packageId) : undefined, null); },
  /** Launchable user apps so the App Gate can offer a pick-from-list (Android only; [] elsewhere). */
  listInstalledApps: () => { const m = getNativeModule(); return call<InstalledAppRef[]>("listInstalledApps", m && m.listInstalledApps ? () => m.listInstalledApps() : undefined, []); },
  getRecentInstallEvents: () => { const m = getNativeModule(); return call<SdkAppAssessment[]>("getRecentInstallEvents", m ? () => m.getRecentInstallEvents() : undefined, []); },
  /** Everything the platform can truthfully report about device configuration. Fields the SDK can't see stay null. */
  getDeviceSecuritySignals: (platform: DevicePlatform) => { const m = getNativeModule(); return call<DeviceSignals>("getDeviceSecuritySignals", m ? () => m.getDeviceSecuritySignals() : undefined, EMPTY_SIGNALS(platform)); },
  getRecentAppSecurityEvents: () => { const m = getNativeModule(); return call<SdkAppSecurityEvent[]>("getRecentAppSecurityEvents", m ? () => m.getRecentAppSecurityEvents() : undefined, []); },
};
