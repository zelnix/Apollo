// Gate 7 — Device Security Check. Combines what the Security SDK can truthfully see on this platform
// (null = not visible here) with what the user tells Apollo. Never claims a forensic scan.

import type { ApolloState } from "./types";

export type DevicePlatform = "ios" | "android" | "web";
/** SDK-observed signals. `null` means the platform/build cannot see it — the UI says so instead of pretending. */
export interface DeviceSignals {
  platform: DevicePlatform;
  unknownSourcesEnabled: boolean | null;
  thirdPartyAccessibilityServices: string[] | null;
  overlayApps: string[] | null;
  notificationAccessApps: string[] | null;
  vpnActive: boolean | null;
  vpnProviderKnown: boolean | null;
  managementProfile: "none" | "present" | "unknown";
  userTrustedCertificates: number | null;
  remoteAccessApps: string[] | null;
  developerOptions: boolean | null;
}
export const EMPTY_SIGNALS = (platform: DevicePlatform): DeviceSignals => ({ platform, unknownSourcesEnabled: null, thirdPartyAccessibilityServices: null, overlayApps: null, notificationAccessApps: null, vpnActive: null, vpnProviderKnown: null, managementProfile: "unknown", userTrustedCertificates: null, remoteAccessApps: null, developerOptions: null });

export type SelfReportKey = "gaveRemoteAccess" | "usedBankingDuringAccess" | "unexpectedProfile" | "managementExpected" | "newCertificate" | "unexpectedVpn" | "grantedAccessibility" | "unknownSourcesOn" | "newAppUnexpected";
export const SELF_REPORT: { id: SelfReportKey; label: string }[] = [
  { id: "gaveRemoteAccess", label: "Someone had remote access to my phone" }, { id: "usedBankingDuringAccess", label: "I used banking or email while they had access" },
  { id: "unexpectedProfile", label: "A profile or 'device management' appeared that I didn't set up" }, { id: "managementExpected", label: "My phone is managed by my work or school (expected)" },
  { id: "newCertificate", label: "I installed a certificate someone sent me" }, { id: "unexpectedVpn", label: "A VPN turned on that I didn't set up" },
  { id: "grantedAccessibility", label: "I gave an app accessibility access recently" }, { id: "unknownSourcesOn", label: "I allowed installs from unknown sources (Android)" },
  { id: "newAppUnexpected", label: "An app appeared that I don't remember installing" },
];
export type SelfReport = Partial<Record<SelfReportKey, boolean>>;

export interface ApolloProtectionHealthInput {
  requested: boolean;
  operational: boolean;
  degradedReason: string | null;
  permissionIssues: string[];
  checkedAt: string | null;
}
export interface DeviceSecurityChange {
  eventType: "app_install" | "permission_change" | "service_enabled" | "vpn_change" | "profile_change" | "app_network";
  status: "low_risk" | "suspicious" | "high_risk";
  confidence: "low" | "medium" | "high";
  appName: string | null;
  recommendedAction: string;
  occurredAt: string;
}
export interface DeviceAssessmentContext {
  protection?: ApolloProtectionHealthInput | null;
  recentChanges?: DeviceSecurityChange[];
}
export interface DeviceProtectionHealth {
  status: "active" | "needs_attention" | "off" | "unavailable";
  title: string;
  detail: string;
}

const sameList = (a: string[] | null, b: string[] | null) => a === null || b === null || JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Compare two user-triggered snapshots. A difference is evidence of a change, never evidence of who caused it. */
export function deriveDeviceSecurityChanges(previous: DeviceSignals | null, current: DeviceSignals, observedAt = new Date().toISOString()): DeviceSecurityChange[] {
  if (!previous || previous.platform !== current.platform) return [];
  const changes: DeviceSecurityChange[] = [];
  const add = (eventType: DeviceSecurityChange["eventType"], recommendedAction: string, appName: string | null = null) => changes.push({ eventType, status: "suspicious", confidence: "high", appName, recommendedAction, occurredAt: observedAt });
  if (previous.vpnActive !== null && current.vpnActive !== null && previous.vpnActive !== current.vpnActive) add("vpn_change", "Open VPN settings and confirm whether you made this change.");
  if (previous.managementProfile !== "unknown" && current.managementProfile !== "unknown" && previous.managementProfile !== current.managementProfile) add("profile_change", "Open device-management settings and confirm whether you added or removed this profile.");
  if (!sameList(previous.thirdPartyAccessibilityServices, current.thirdPartyAccessibilityServices)) {
    const added = (current.thirdPartyAccessibilityServices ?? []).filter((item) => !(previous.thirdPartyAccessibilityServices ?? []).includes(item));
    add("service_enabled", "Review Accessibility settings and keep access only for services you recognise.", added[0] ?? null);
  }
  if (!sameList(previous.notificationAccessApps, current.notificationAccessApps)) {
    const added = (current.notificationAccessApps ?? []).filter((item) => !(previous.notificationAccessApps ?? []).includes(item));
    add("permission_change", "Review Notification access and revoke it for apps that do not need it.", added[0] ?? null);
  }
  if (previous.unknownSourcesEnabled !== null && current.unknownSourcesEnabled !== null && previous.unknownSourcesEnabled !== current.unknownSourcesEnabled) add("permission_change", "Review which apps may install unknown apps and turn off access you do not need.");
  if (previous.developerOptions !== null && current.developerOptions !== null && previous.developerOptions !== current.developerOptions) add("permission_change", "Review Developer options and turn them off unless you deliberately use them.");
  return changes;
}

export type DeviceStatus = "protected" | "review" | "action" | "recovery";
export const DEVICE_STATUS: Record<DeviceStatus, { title: string; state: ApolloState; meaning: string }> = {
  protected: { title: "Protected", state: "resting", meaning: "No meaningful issues detected within what Apollo can see here." },
  review: { title: "Review recommended", state: "growling", meaning: "Some permissions or settings deserve attention." },
  action: { title: "Action required", state: "barking", meaning: "A high-risk configuration or app was detected." },
  recovery: { title: "Recovery", state: "barking", meaning: "Risky access was already granted. Follow the steps — Apollo stays with you." },
};

export interface DeviceFinding { id: string; title: string; severity: "info" | "review" | "high"; plain: string; action: string; settings: string; handoff?: "network" | "identity" | "app" }
export interface DeviceAssessment { status: DeviceStatus; state: ApolloState; summary: string; findings: DeviceFinding[]; cannotSee: string[]; recoverySteps: string[]; protectionHealth: DeviceProtectionHealth }

const SETTINGS = {
  profile: { ios: "Settings → General → VPN & Device Management", android: "Settings → Security → Device admin apps / Work profile" },
  cert: { ios: "Settings → General → VPN & Device Management → Certificate", android: "Settings → Security → Encryption & credentials → User credentials" },
  vpn: { ios: "Settings → VPN", android: "Settings → Network → VPN" },
  accessibility: { ios: "Settings → Accessibility", android: "Settings → Accessibility → Downloaded apps" },
  unknown: { ios: "Not applicable on iPhone", android: "Settings → Apps → Special app access → Install unknown apps" },
  apps: { ios: "Hold the app icon → Remove App", android: "Settings → Apps → the app → Uninstall" },
  overlay: { ios: "Not applicable on iPhone", android: "Settings → Apps → Special app access → Display over other apps" },
  notif: { ios: "Not applicable on iPhone", android: "Settings → Apps → Special app access → Notification access" },
  dev: { ios: "Not applicable on iPhone", android: "Settings → System → Developer options" },
};
const path = (k: keyof typeof SETTINGS, p: DevicePlatform) => (p === "ios" ? SETTINGS[k].ios : SETTINGS[k].android);

export function assessDevice(sig: DeviceSignals, self: SelfReport = {}, context: DeviceAssessmentContext = {}): DeviceAssessment {
  const p = sig.platform;
  const f: DeviceFinding[] = [];
  const recoverySteps: string[] = [];

  if (self.gaveRemoteAccess) {
    f.push({ id: "D01", title: "Remote access was granted", severity: "high", plain: "Whoever connected could see your screen and may have controlled your phone, read codes or opened your apps.", action: "End the session, remove the remote-access app, then review the accounts used while they were connected.", settings: path("apps", p), handoff: "identity" });
    recoverySteps.push("End the remote-access session now: turn off Wi‑Fi and mobile data, or restart the phone.", "Hang up and don't call the number back.", "Remove or disable the remote-access app and any permissions it was given.", "Review the accounts you used during the session — change passwords from a device they didn't touch.", "Reject any login or MFA prompts you didn't start.");
    if (self.usedBankingDuringAccess) { f.push({ id: "D01b", title: "Banking or email used during remote access", severity: "high", plain: "Credentials and codes typed while someone watched should be treated as exposed.", action: "Call your bank on the number on your card now. Change your email password from another device.", settings: path("apps", p), handoff: "identity" }); recoverySteps.push("Contact your bank immediately using the number on the back of your card — ask them to check for unauthorised activity."); }
  }
  const mgmtPresent = sig.managementProfile === "present" || !!self.unexpectedProfile;
  if (mgmtPresent && !self.managementExpected) f.push({ id: "D02", title: "Device management profile", severity: "high", plain: "This can change how your device is managed — install apps, alter network settings or read some activity.", action: "If your work or school didn't set this up, remove it.", settings: path("profile", p), handoff: "network" });
  else if (mgmtPresent) f.push({ id: "D02", title: "Managed by work or school", severity: "info", plain: "Expected management lowers the risk. Your organisation can still see and control parts of this device.", action: "Verify with your IT team if anything looks unfamiliar.", settings: path("profile", p) });
  if ((sig.userTrustedCertificates ?? 0) > 0 || self.newCertificate) f.push({ id: "D03", title: "Extra trusted certificate", severity: "high", plain: "This can affect which secure connections your device trusts — someone could read traffic that looks encrypted.", action: "Remove any certificate you didn't deliberately install for work or a VPN you chose.", settings: path("cert", p), handoff: "network" });
  if (self.unexpectedVpn || (sig.vpnActive && sig.vpnProviderKnown === false)) f.push({ id: "D04", title: "Unexpected VPN", severity: "review", plain: "A VPN you didn't choose can watch or redirect everything your phone does online.", action: "Turn it off and remove the app or profile that created it.", settings: path("vpn", p), handoff: "network" });
  // Observed VPN whose provider the platform won't name (iOS always; Android when it isn't Apollo's own filter): report the fact, don't judge it.
  else if (sig.vpnActive && sig.vpnProviderKnown === null) f.push({ id: "D04b", title: "A VPN is on right now", severity: "info", plain: "Your phone's connection is going through a VPN. Apollo can see that it's on but not who runs it.", action: "If you turned it on, that's fine. If you didn't, look at what created it and turn it off.", settings: path("vpn", p), handoff: "network" });
  const a11y = sig.thirdPartyAccessibilityServices ?? [];
  if (self.grantedAccessibility || a11y.length) f.push({ id: "D05", title: a11y.length ? `Accessibility access: ${a11y.join(", ")}` : "Accessibility access granted recently", severity: "review", plain: "Accessibility access can allow an app to read parts of your screen and interact with other apps.", action: "Keep it only for genuine accessibility helpers you chose. Revoke it for anything else.", settings: path("accessibility", p), handoff: "app" });
  const remote = sig.remoteAccessApps ?? [];
  if (remote.length) f.push({ id: "D06", title: `Remote-access apps installed: ${remote.join(", ")}`, severity: "review", plain: "These apps have the capability to let someone else see or control your screen. Their presence does not prove a session is active or malicious, but being dormant does not remove that capability.", action: "Review each app. Remove it unless you deliberately use it with people you trust, and revoke powerful access when it is not needed.", settings: path("apps", p), handoff: "app" });
  if (self.newAppUnexpected) f.push({ id: "D07", title: "App you don't remember installing", severity: "review", plain: "Apps that appear after a call, message or download deserve a check.", action: "Use Check This App to look at what it can access, then remove it if it doesn't belong.", settings: path("apps", p), handoff: "app" });
  if (sig.unknownSourcesEnabled || self.unknownSourcesOn) f.push({ id: "D08", title: "Installs from unknown sources allowed", severity: "review", plain: "Apps from outside Google Play skip its safety checks.", action: "Turn it off for every app except one you deliberately use for sideloading.", settings: path("unknown", p) });
  if ((sig.overlayApps ?? []).length) f.push({ id: "D09", title: `Can draw over other apps: ${sig.overlayApps!.join(", ")}`, severity: "info", plain: "This can allow an app to display content over other apps.", action: "Fine for genuine tools. Revoke it for anything you don't recognise.", settings: path("overlay", p) });
  if ((sig.notificationAccessApps ?? []).length) f.push({ id: "D10", title: `Can read notifications: ${sig.notificationAccessApps!.join(", ")}`, severity: "info", plain: "This may allow an app to read notifications, including security codes.", action: "Keep it only for apps whose purpose needs it (e.g. a watch companion).", settings: path("notif", p) });
  if (sig.developerOptions) f.push({ id: "D11", title: "Developer options on", severity: "info", plain: "USB debugging can let a connected computer control the phone.", action: "Turn it off unless you're developing apps.", settings: path("dev", p) });

  const protection = context.protection;
  const protectionHealth: DeviceProtectionHealth = !protection
    ? { status: "unavailable", title: "Protection health unavailable", detail: "Apollo could not obtain a current protection observation. This does not mean protection is running." }
    : protection.operational
      ? { status: "active", title: "Apollo protection is confirmed running", detail: `The device reported protection operational${protection.checkedAt ? ` at ${new Date(protection.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.` }
      : !protection.requested
        ? { status: "off", title: "Apollo protection is turned off", detail: "Manual Gates still work, but Apollo has no confirmed automatic protection running." }
        : { status: "needs_attention", title: protection.permissionIssues.length ? "Apollo protection permission is missing" : "Apollo protection is not running", detail: protection.permissionIssues.length ? `${protection.permissionIssues.join(", ")} must be restored before Apollo can confirm protection.` : protection.degradedReason ?? "Protection was requested, but the device did not confirm it running." };
  if (protectionHealth.status === "off") f.push({ id: "D12", title: "Apollo protection is off", severity: "review", plain: protectionHealth.detail, action: "Open Apollo's protection settings, turn protection on, then re-check the device.", settings: p === "ios" ? "Settings → Apollo and Settings → Safari → Extensions" : "Settings → Network & internet → VPN", handoff: "network" });
  if (protectionHealth.status === "needs_attention") f.push({ id: "D13", title: protection?.permissionIssues.length ? "Apollo protection permission lost" : "Apollo protection stopped", severity: "review", plain: `${protectionHealth.detail} This is an observed protection gap, not proof that somebody tampered with the device.`, action: "Restore the permission or protection service, then return to Device Gate and re-check.", settings: p === "ios" ? "Settings → Apollo and Settings → Safari → Extensions" : "Settings → Network & internet → VPN", handoff: "network" });

  const changed = (context.recentChanges ?? []).filter((event) => ["permission_change", "service_enabled", "vpn_change", "profile_change"].includes(event.eventType) && event.status !== "low_risk" && event.confidence !== "low").slice(0, 3);
  for (const event of changed) {
    const supportedTamperingConcern = event.status === "high_risk" && event.confidence === "high";
    const subject = event.appName ? ` for ${event.appName}` : "";
    const kind = event.eventType === "permission_change" ? "permission change" : event.eventType === "service_enabled" ? "sensitive service enabled" : event.eventType === "vpn_change" ? "VPN change" : "management-profile change";
    const settings = event.eventType === "vpn_change" ? path("vpn", p) : event.eventType === "profile_change" ? path("profile", p) : event.eventType === "service_enabled" ? path("accessibility", p) : path("apps", p);
    f.push({ id: `D15-${event.eventType}-${event.occurredAt}`, title: supportedTamperingConcern ? `Possible tampering evidence: ${kind}` : `Recent ${kind}`, severity: supportedTamperingConcern ? "high" : "review",
      plain: supportedTamperingConcern ? `Apollo observed a high-confidence ${kind}${subject}. That supports concern about tampering, but does not identify who made the change.` : `Apollo observed a ${kind}${subject}. Review it, but do not treat the change alone as proof of malicious behaviour.`,
      action: event.recommendedAction || "Open the relevant settings, confirm whether you made this change, then re-check.", settings, handoff: event.eventType === "vpn_change" || event.eventType === "profile_change" ? "network" : "app" });
  }

  const cannotSee: string[] = [];
  if (p === "ios" || p === "web") cannotSee.push("The list of installed apps and their permissions (iOS doesn't expose this to any app).");
  if (sig.thirdPartyAccessibilityServices === null && p !== "ios") cannotSee.push("Accessibility services (needs the native Security SDK).");
  if (sig.managementProfile === "unknown") cannotSee.push(p === "ios" ? "Whether a management profile is installed — iOS only tells an app when it is managed itself, so Apollo can confirm management but never rule it out." : "Device-management / configuration profiles on this build.");
  if (sig.vpnActive === null) cannotSee.push("VPN state on this build.");
  if (sig.userTrustedCertificates === null) cannotSee.push("User-installed certificates on this build.");
  if (sig.remoteAccessApps === null) cannotSee.push("Which remote-access apps are installed.");

  const status: DeviceStatus = self.gaveRemoteAccess ? "recovery" : f.some((x) => x.severity === "high") ? "action" : f.some((x) => x.severity === "review") ? "review" : "protected";
  const state = DEVICE_STATUS[status].state === "resting" && f.length ? "ears_up" : DEVICE_STATUS[status].state;
  const summary = status === "protected" ? (f.length ? "Nothing risky — a couple of settings are worth knowing about." : `No meaningful issues within what Apollo can see on this ${p === "ios" ? "iPhone" : p === "android" ? "Android device" : "device"}.`)
    : status === "recovery" ? "Someone had access to this device. Work through the steps below — one at a time." : status === "action" ? `${f.filter((x) => x.severity === "high").length} high-risk item${f.filter((x) => x.severity === "high").length > 1 ? "s" : ""} need${f.filter((x) => x.severity === "high").length > 1 ? "" : "s"} your attention.` : `${f.length} item${f.length > 1 ? "s" : ""} worth reviewing. Nothing confirmed dangerous.`;
  return { status, state, summary, findings: f, cannotSee, recoverySteps, protectionHealth };
}
