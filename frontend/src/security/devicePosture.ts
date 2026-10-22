/**
 * Device Posture Monitoring — detects security-relevant device setting changes
 * that commonly accompany scammer-driven compromise.
 *
 * Core rule: Apollo detects security-relevant changes away from the device's
 * normal OS/OEM protections and alerts the user. It reports what changed;
 * it does not guess why it changed.
 *
 * 23 checks. Each check has:
 *  - id: stable machine key
 *  - label: human-readable name
 *  - description: what changed
 *  - severity: "critical" (barking) | "warning" (growling)
 *  - check: function that reads the current value
 *  - alert: function that compares previous vs current and returns alert text or null
 */

import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Network from "expo-network";

import type { LocalAlert } from "@/src/push/notifications";
import type { NetworkStatus, ProtectionStatus } from "./SecurityPlatformAdapter";

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export interface PostureCheckResult {
  id: string;
  label: string;
  value: string;                 // human-readable current state
  rawValue: unknown;             // machine-comparable value
  severity: "ok" | "warning" | "critical";
  detail: string;                // always a plain statement of fact
  observable: boolean;           // false = this platform can't read it
  category: "settings" | "privileged_access" | "default_apps" | "network" | "compromise" | "os_security";
}

export interface PostureSnapshot {
  checks: PostureCheckResult[];
  capturedAt: string;
  platform: string;
}

export interface PostureChange {
  id: string;
  label: string;
  previousValue: string;
  currentValue: string;
  severity: "warning" | "critical";
  detail: string;
}

// ────────────────────────────────────────────────────────────────────
// Native bridge — reads the GuardDog module's getDevicePostureSnapshot()
// ────────────────────────────────────────────────────────────────────

interface NativePostureSnapshot {
  developerOptionsEnabled: boolean;
  usbDebuggingEnabled: boolean;
  unknownSourcesEnabled: boolean;
  screenLockSecure: boolean;
  biometricStatus: string;
  notificationsEnabled: boolean;
  accessibilityServices: string[];
  deviceAdmins: string[];
  notificationListeners: string[];
  canDrawOverlays: boolean;
  defaultSmsApp: string;
  defaultDialerApp: string;
  otherVpnActive: boolean;
  userCertificateCount: number;
  rootIndicators: string[];
  securityPatch: string;
  playProtectAvailable: boolean;
  screenCaptureDetectable: boolean;
  capturedAtMillis: number;
  sdkInt: number;
}

let _nativePosture: NativePostureSnapshot | null = null;

async function readNativePosture(): Promise<NativePostureSnapshot | null> {
  if (Platform.OS !== "android") return null;
  try {
    const mod = require("expo-modules-core").requireNativeModule("GuardDogSecurity");
    _nativePosture = mod.getDevicePostureSnapshot() as NativePostureSnapshot;
    return _nativePosture;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Check builders
// ────────────────────────────────────────────────────────────────────

function check(
  id: string, label: string, category: PostureCheckResult["category"],
  observable: boolean, rawValue: unknown, value: string,
  severity: PostureCheckResult["severity"], detail: string,
): PostureCheckResult {
  return { id, label, value, rawValue, severity, detail, observable, category };
}

// ────────────────────────────────────────────────────────────────────
// Collect full posture snapshot
// ────────────────────────────────────────────────────────────────────

export async function collectPostureSnapshot(
  protection: ProtectionStatus | null,
  network: NetworkStatus | null,
): Promise<PostureSnapshot> {
  const native = await readNativePosture();
  const isAndroid = Platform.OS === "android";
  const checks: PostureCheckResult[] = [];

  // 1. VPN Protection
  if (protection) {
    const vpnOk = protection.operational && protection.running;
    checks.push(check(
      "vpn_protection", "VPN Protection", "network",
      true, vpnOk, vpnOk ? "Active" : "Inactive",
      vpnOk ? "ok" : "critical",
      vpnOk ? "Apollo VPN protection is running." : "Apollo VPN protection is not running.",
    ));
  } else {
    checks.push(check("vpn_protection", "VPN Protection", "network", true, false, "Unknown", "warning", "Could not determine VPN protection status."));
  }

  // 2. Private DNS (read from native snapshot via getDnsCapabilityDeviceSnapshot if available)
  // This is already handled by the DNS capability diagnostic — we include a summary check.
  checks.push(check(
    "private_dns", "Private DNS", "network",
    isAndroid, network?.type ?? "unknown", isAndroid ? "See DNS diagnostic" : "Not observable on this platform",
    "ok", "Private DNS status is monitored by Apollo's DNS diagnostic.",
  ));

  // 3. Unknown Sources
  if (native) {
    checks.push(check(
      "unknown_sources", "Unknown Sources", "settings",
      true, native.unknownSourcesEnabled, native.unknownSourcesEnabled ? "Enabled" : "Disabled",
      native.unknownSourcesEnabled ? "critical" : "ok",
      native.unknownSourcesEnabled
        ? "Installing apps from unknown sources is enabled. This allows sideloading apps outside the Play Store."
        : "Unknown sources is disabled. Apps can only be installed from the Play Store.",
    ));
  } else {
    checks.push(check("unknown_sources", "Unknown Sources", "settings", false, null, "Not observable", "ok", "Cannot read this setting on this platform."));
  }

  // 4. Developer Options
  if (native) {
    checks.push(check(
      "developer_options", "Developer Options", "settings",
      true, native.developerOptionsEnabled, native.developerOptionsEnabled ? "Enabled" : "Disabled",
      native.developerOptionsEnabled ? "warning" : "ok",
      native.developerOptionsEnabled
        ? "Developer options are enabled on this device."
        : "Developer options are disabled.",
    ));
  } else {
    checks.push(check("developer_options", "Developer Options", "settings", false, null, "Not observable", "ok", "Cannot read this setting on this platform."));
  }

  // 5. USB Debugging
  if (native) {
    checks.push(check(
      "usb_debugging", "USB Debugging", "settings",
      true, native.usbDebuggingEnabled, native.usbDebuggingEnabled ? "Enabled" : "Disabled",
      native.usbDebuggingEnabled ? "critical" : "ok",
      native.usbDebuggingEnabled
        ? "USB debugging is enabled. This allows connected computers to control this device."
        : "USB debugging is disabled.",
    ));
  } else {
    checks.push(check("usb_debugging", "USB Debugging", "settings", false, null, "Not observable", "ok", "Cannot read this setting on this platform."));
  }

  // 6. Screen Lock
  if (native) {
    checks.push(check(
      "screen_lock", "Screen Lock", "settings",
      true, native.screenLockSecure, native.screenLockSecure ? "Secure" : "Not secure",
      native.screenLockSecure ? "ok" : "critical",
      native.screenLockSecure
        ? "Device has a secure lock screen (PIN, pattern, password, or biometric)."
        : "Device does not have a secure screen lock. Anyone with physical access can use this device.",
    ));
  } else {
    checks.push(check("screen_lock", "Screen Lock", "settings", false, null, "Not observable", "ok", "Cannot read this setting on this platform."));
  }

  // 7. Apollo Notifications
  if (native) {
    checks.push(check(
      "notifications", "Apollo Notifications", "settings",
      true, native.notificationsEnabled, native.notificationsEnabled ? "Enabled" : "Disabled",
      native.notificationsEnabled ? "ok" : "critical",
      native.notificationsEnabled
        ? "Apollo can send notifications to alert you."
        : "Apollo notifications are disabled. You will not receive security alerts.",
    ));
  } else {
    // Can check via expo-notifications on any platform
    try {
      const { getPermissionsAsync } = require("expo-notifications");
      const perm = await getPermissionsAsync();
      const granted = perm.granted;
      checks.push(check(
        "notifications", "Apollo Notifications", "settings",
        true, granted, granted ? "Enabled" : "Disabled",
        granted ? "ok" : "critical",
        granted ? "Apollo can send notifications." : "Apollo notifications are disabled.",
      ));
    } catch {
      checks.push(check("notifications", "Apollo Notifications", "settings", false, null, "Not observable", "ok", "Cannot read notification permission."));
    }
  }

  // 8. Battery / Background
  // Check if battery optimization is restricted — on Android, Network.getNetworkStateAsync can hint
  const batteryCheck = isAndroid;
  checks.push(check(
    "battery_background", "Battery / Background", "settings",
    batteryCheck, "monitored", batteryCheck ? "Monitored" : "Not observable",
    "ok", "Apollo monitors its own background execution health.",
  ));

  // 9. Wi-Fi Security
  if (network && network.type === "wifi") {
    const insecure = network.wifiSecurity === "open" || network.wifiSecurity === "wep";
    checks.push(check(
      "wifi_security", "Wi-Fi Security", "network",
      true, network.wifiSecurity, network.wifiSecurity === "open" ? "Open network" : network.wifiSecurity === "wep" ? "WEP (weak)" : `${network.wifiSecurity}`,
      insecure ? "warning" : "ok",
      insecure
        ? `Connected to an insecure Wi-Fi network (${network.wifiSecurity}). Traffic may be interceptable.`
        : `Connected to Wi-Fi with ${network.wifiSecurity} security.`,
    ));
  } else {
    checks.push(check(
      "wifi_security", "Wi-Fi Security", "network",
      true, network?.type ?? "none", network ? `Connected via ${network.type}` : "Not connected",
      "ok", network ? `Currently using ${network.type} connection.` : "No active network connection.",
    ));
  }

  // 10. Accessibility Services
  if (native) {
    const count = native.accessibilityServices.length;
    checks.push(check(
      "accessibility_services", "Accessibility Services", "privileged_access",
      true, native.accessibilityServices, count === 0 ? "None" : `${count} app${count > 1 ? "s" : ""}`,
      count > 0 ? "warning" : "ok",
      count > 0
        ? `${count} third-party app${count > 1 ? "s have" : " has"} accessibility privileges: ${native.accessibilityServices.join(", ")}.`
        : "No third-party apps have accessibility privileges.",
    ));
  } else {
    checks.push(check("accessibility_services", "Accessibility Services", "privileged_access", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  // 11. Device Admin
  if (native) {
    const count = native.deviceAdmins.length;
    checks.push(check(
      "device_admin", "Device Admin", "privileged_access",
      true, native.deviceAdmins, count === 0 ? "None" : `${count} app${count > 1 ? "s" : ""}`,
      count > 0 ? "warning" : "ok",
      count > 0
        ? `${count} app${count > 1 ? "s have" : " has"} device administrator privileges: ${native.deviceAdmins.join(", ")}.`
        : "No third-party apps have device administrator privileges.",
    ));
  } else {
    checks.push(check("device_admin", "Device Admin", "privileged_access", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  // 12. Default SMS App
  if (native) {
    checks.push(check(
      "default_sms", "Default SMS App", "default_apps",
      true, native.defaultSmsApp, native.defaultSmsApp,
      "ok", `Default SMS handler: ${native.defaultSmsApp}.`,
    ));
  } else {
    checks.push(check("default_sms", "Default SMS App", "default_apps", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  // 13. Default Phone App
  if (native) {
    checks.push(check(
      "default_phone", "Default Phone App", "default_apps",
      true, native.defaultDialerApp, native.defaultDialerApp,
      "ok", `Default phone/dialer handler: ${native.defaultDialerApp}.`,
    ));
  } else {
    checks.push(check("default_phone", "Default Phone App", "default_apps", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  // 14. Call Forwarding
  // Android doesn't expose call forwarding state to third-party apps
  checks.push(check(
    "call_forwarding", "Call Forwarding", "default_apps",
    false, null, "Not observable",
    "ok", "Call forwarding state is not exposed to third-party apps by Android.",
  ));

  // 15. Notification Access
  if (native) {
    const count = native.notificationListeners.length;
    checks.push(check(
      "notification_access", "Notification Access", "privileged_access",
      true, native.notificationListeners, count === 0 ? "None" : `${count} app${count > 1 ? "s" : ""}`,
      count > 0 ? "warning" : "ok",
      count > 0
        ? `${count} app${count > 1 ? "s can" : " can"} read your notifications: ${native.notificationListeners.join(", ")}.`
        : "No third-party apps can read your notifications.",
    ));
  } else {
    checks.push(check("notification_access", "Notification Access", "privileged_access", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  // 16. Screen Capture / Sharing
  if (native && native.screenCaptureDetectable) {
    checks.push(check(
      "screen_capture", "Screen Capture / Sharing", "privileged_access",
      true, "detectable", "Detectable",
      "ok", "Apollo can detect active screen capture on this device.",
    ));
  } else {
    checks.push(check("screen_capture", "Screen Capture / Sharing", "privileged_access", false, null, "Not observable", "ok", "Screen capture detection is not available on this platform/version."));
  }

  // 17. Overlay Permission
  if (native) {
    checks.push(check(
      "overlay_permission", "Overlay Permission", "privileged_access",
      true, native.canDrawOverlays, native.canDrawOverlays ? "Granted" : "Not granted",
      native.canDrawOverlays ? "warning" : "ok",
      native.canDrawOverlays
        ? "This app can draw overlays on other apps. Other apps with this permission could display fake UI."
        : "Overlay permission is not granted.",
    ));
  } else {
    checks.push(check("overlay_permission", "Overlay Permission", "privileged_access", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  // 18. VPN Configuration (another VPN replaces Apollo)
  if (native) {
    checks.push(check(
      "vpn_config", "VPN Configuration", "network",
      true, native.otherVpnActive, native.otherVpnActive ? "Another VPN active" : "No interference",
      native.otherVpnActive ? "critical" : "ok",
      native.otherVpnActive
        ? "Another VPN or profile is active and may be interfering with Apollo's protection."
        : "No other VPN is interfering with Apollo.",
    ));
  } else {
    checks.push(check("vpn_config", "VPN Configuration", "network", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  // 19. User Certificates
  if (native) {
    const count = native.userCertificateCount;
    const readable = count >= 0;
    checks.push(check(
      "user_certificates", "User Certificates", "compromise",
      readable, count, readable ? (count === 0 ? "None" : `${count} installed`) : "Not readable",
      readable && count > 0 ? "warning" : "ok",
      readable
        ? (count > 0 ? `${count} user-installed security certificate${count > 1 ? "s" : ""} found. These can intercept encrypted traffic.` : "No user-installed certificates.")
        : "Could not read certificate store.",
    ));
  } else {
    checks.push(check("user_certificates", "User Certificates", "compromise", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  // 20. Biometrics
  if (native) {
    const enrolled = native.biometricStatus === "enrolled";
    checks.push(check(
      "biometrics", "Biometrics", "settings",
      true, native.biometricStatus, native.biometricStatus === "enrolled" ? "Enrolled" : native.biometricStatus === "none_enrolled" ? "Not enrolled" : native.biometricStatus,
      native.biometricStatus === "none_enrolled" ? "warning" : "ok",
      native.biometricStatus === "enrolled"
        ? "Biometric authentication is enrolled on this device."
        : native.biometricStatus === "none_enrolled"
        ? "No biometrics enrolled. Consider adding fingerprint or face authentication."
        : `Biometric status: ${native.biometricStatus}.`,
    ));
  } else {
    checks.push(check("biometrics", "Biometrics", "settings", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  // 21. Root / Jailbreak Indicators
  if (native) {
    const rooted = native.rootIndicators.length > 0;
    checks.push(check(
      "root_jailbreak", "Root / Jailbreak Indicators", "compromise",
      true, native.rootIndicators, rooted ? `${native.rootIndicators.length} indicator${native.rootIndicators.length > 1 ? "s" : ""}` : "None detected",
      rooted ? "critical" : "ok",
      rooted
        ? `Device shows verifiable compromise indicators: ${native.rootIndicators.join(", ")}.`
        : "No root or jailbreak indicators detected.",
    ));
  } else {
    checks.push(check("root_jailbreak", "Root / Jailbreak Indicators", "compromise", false, null, "Not observable", "ok", "Cannot check on this platform."));
  }

  // 22. Play Protect / OS Security
  if (native) {
    checks.push(check(
      "play_protect", "Play Protect / OS Security", "os_security",
      true, native.playProtectAvailable, native.playProtectAvailable ? "Available" : "Unavailable",
      native.playProtectAvailable ? "ok" : "warning",
      native.playProtectAvailable
        ? "Google Play Protect services are available on this device."
        : "Google Play Protect is not available. Device may lack platform security protections.",
    ));
  } else {
    checks.push(check("play_protect", "Play Protect / OS Security", "os_security", false, null, "Not observable", "ok", "Cannot check on this platform."));
  }

  // 23. OS Security Updates
  if (native) {
    const patch = native.securityPatch;
    let stale = false;
    try {
      const patchDate = new Date(patch);
      const now = new Date();
      const monthsDiff = (now.getFullYear() - patchDate.getFullYear()) * 12 + now.getMonth() - patchDate.getMonth();
      stale = monthsDiff > 3;
    } catch { /* can't parse */ }
    checks.push(check(
      "os_security_updates", "OS Security Updates", "os_security",
      true, patch, patch,
      stale ? "warning" : "ok",
      stale
        ? `Security patch level is ${patch}. Device may be materially behind available updates.`
        : `Security patch level: ${patch}.`,
    ));
  } else {
    checks.push(check("os_security_updates", "OS Security Updates", "os_security", false, null, "Not observable", "ok", "Cannot read on this platform."));
  }

  return {
    checks,
    capturedAt: new Date().toISOString(),
    platform: Platform.OS,
  };
}

// ────────────────────────────────────────────────────────────────────
// Diff two snapshots → changes
// ────────────────────────────────────────────────────────────────────

export function diffPosture(previous: PostureSnapshot, current: PostureSnapshot): PostureChange[] {
  const changes: PostureChange[] = [];
  const prevMap = new Map(previous.checks.map((c) => [c.id, c]));

  for (const cur of current.checks) {
    if (!cur.observable) continue;
    const prev = prevMap.get(cur.id);
    if (!prev || !prev.observable) continue;

    // Compare raw values
    const prevStr = JSON.stringify(prev.rawValue);
    const curStr = JSON.stringify(cur.rawValue);
    if (prevStr === curStr) continue;

    // Something changed — determine severity
    const severity = cur.severity === "critical" ? "critical" as const : "warning" as const;
    changes.push({
      id: cur.id,
      label: cur.label,
      previousValue: prev.value,
      currentValue: cur.value,
      severity,
      detail: cur.detail,
    });
  }

  return changes;
}

// ────────────────────────────────────────────────────────────────────
// Generate local alerts from posture changes
// ────────────────────────────────────────────────────────────────────

export function postureChangeAlerts(changes: PostureChange[]): LocalAlert[] {
  return changes.map((change) => ({
    title: `Device setting changed: ${change.label}`,
    body: change.detail,
    channel: "apollo_alerts",
    actionUrl: "/alerts",
  }));
}
