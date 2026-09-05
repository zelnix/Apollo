// Gate 7 — Security SDK contract for apps & device protection. Android (Kotlin) can see package installs,
// permissions, accessibility/overlay/notification access and VPN state; iOS (Swift) can only report profiles,
// VPN and its own state. Every method degrades to "not visible" — the UI never invents signals.
import type { AppNetwork } from "@/src/domain/appAnalysis";
import { EMPTY_SIGNALS, type DevicePlatform, type DeviceSignals } from "@/src/domain/deviceAnalysis";
import { getNativeModule } from "./nativeBridge";

export type AppDeviceCapabilityStatus = "supported" | "permission_required" | "unsupported";
export interface AppDeviceCapabilities { installEvents: AppDeviceCapabilityStatus; appPermissions: AppDeviceCapabilityStatus; accessibilityServices: AppDeviceCapabilityStatus; overlayApps: AppDeviceCapabilityStatus; notificationAccess: AppDeviceCapabilityStatus; vpnState: AppDeviceCapabilityStatus; profileState: AppDeviceCapabilityStatus; appNetworkCorrelation: AppDeviceCapabilityStatus }
export interface SdkAppAssessment { packageId: string; appName: string; developer: string | null; installSource: "app_store" | "play_store" | "browser" | "message" | "other_store" | "not_sure"; installedAt: string | null; permissions: string[]; remoteAccessCapability: boolean; network: AppNetwork | null }
export interface SdkAppSecurityEvent { eventType: "app_install" | "permission_change" | "service_enabled" | "vpn_change" | "profile_change" | "app_network"; status: "low_risk" | "suspicious" | "high_risk"; riskScore: number; confidence: "low" | "medium" | "high"; appName: string | null; packageId: string | null; installSource: string | null; remoteAccessCapability: boolean; relatedThreatScent: string | null; recommendedDogState: "resting" | "ears_up" | "growling" | "barking" | "biting"; recommendedAction: string; occurredAt: string }

const UNSUPPORTED: AppDeviceCapabilities = { installEvents: "unsupported", appPermissions: "unsupported", accessibilityServices: "unsupported", overlayApps: "unsupported", notificationAccess: "unsupported", vpnState: "unsupported", profileState: "unsupported", appNetworkCorrelation: "unsupported" };
async function call<T>(fn: (() => Promise<string>) | undefined, fallback: T): Promise<T> { if (!fn) return fallback; try { return JSON.parse(await fn()) as T; } catch { return fallback; } }

export const AppDeviceSdk = {
  getAppDeviceCapabilities: () => { const m = getNativeModule(); return call<AppDeviceCapabilities>(m ? () => m.getAppDeviceCapabilities() : undefined, UNSUPPORTED); },
  getInstalledAppAssessment: (packageId: string) => { const m = getNativeModule(); return call<SdkAppAssessment | null>(m ? () => m.getInstalledAppAssessment(packageId) : undefined, null); },
  getRecentInstallEvents: () => { const m = getNativeModule(); return call<SdkAppAssessment[]>(m ? () => m.getRecentInstallEvents() : undefined, []); },
  /** Everything the platform can truthfully report about device configuration. Fields the SDK can't see stay null. */
  getDeviceSecuritySignals: (platform: DevicePlatform) => { const m = getNativeModule(); return call<DeviceSignals>(m ? () => m.getDeviceSecuritySignals() : undefined, EMPTY_SIGNALS(platform)); },
  getRecentAppSecurityEvents: () => { const m = getNativeModule(); return call<SdkAppSecurityEvent[]>(m ? () => m.getRecentAppSecurityEvents() : undefined, []); },
};
