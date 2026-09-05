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

export type DeviceStatus = "protected" | "review" | "action" | "recovery";
export const DEVICE_STATUS: Record<DeviceStatus, { title: string; state: ApolloState; meaning: string }> = {
  protected: { title: "Protected", state: "resting", meaning: "No meaningful issues detected within what Apollo can see here." },
  review: { title: "Review recommended", state: "growling", meaning: "Some permissions or settings deserve attention." },
  action: { title: "Action required", state: "barking", meaning: "A high-risk configuration or app was detected." },
  recovery: { title: "Recovery", state: "barking", meaning: "Risky access was already granted. Follow the steps — Apollo stays with you." },
};

export interface DeviceFinding { id: string; title: string; severity: "info" | "review" | "high"; plain: string; action: string; settings: string; handoff?: "network" | "identity" | "app" }
export interface DeviceAssessment { status: DeviceStatus; state: ApolloState; summary: string; findings: DeviceFinding[]; cannotSee: string[]; recoverySteps: string[] }

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

export function assessDevice(sig: DeviceSignals, self: SelfReport = {}): DeviceAssessment {
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
  const a11y = sig.thirdPartyAccessibilityServices ?? [];
  if (self.grantedAccessibility || a11y.length) f.push({ id: "D05", title: a11y.length ? `Accessibility access: ${a11y.join(", ")}` : "Accessibility access granted recently", severity: "review", plain: "Accessibility access can allow an app to read parts of your screen and interact with other apps.", action: "Keep it only for genuine accessibility helpers you chose. Revoke it for anything else.", settings: path("accessibility", p), handoff: "app" });
  const remote = sig.remoteAccessApps ?? [];
  if (remote.length) f.push({ id: "D06", title: `Remote-access apps installed: ${remote.join(", ")}`, severity: "review", plain: "These let someone else see or control your screen while a session is open.", action: "Remove them unless you use them deliberately with people you trust.", settings: path("apps", p), handoff: "app" });
  if (self.newAppUnexpected) f.push({ id: "D07", title: "App you don't remember installing", severity: "review", plain: "Apps that appear after a call, message or download deserve a check.", action: "Use Check This App to look at what it can access, then remove it if it doesn't belong.", settings: path("apps", p), handoff: "app" });
  if (sig.unknownSourcesEnabled || self.unknownSourcesOn) f.push({ id: "D08", title: "Installs from unknown sources allowed", severity: "review", plain: "Apps from outside Google Play skip its safety checks.", action: "Turn it off for every app except one you deliberately use for sideloading.", settings: path("unknown", p) });
  if ((sig.overlayApps ?? []).length) f.push({ id: "D09", title: `Can draw over other apps: ${sig.overlayApps!.join(", ")}`, severity: "info", plain: "This can allow an app to display content over other apps.", action: "Fine for genuine tools. Revoke it for anything you don't recognise.", settings: path("overlay", p) });
  if ((sig.notificationAccessApps ?? []).length) f.push({ id: "D10", title: `Can read notifications: ${sig.notificationAccessApps!.join(", ")}`, severity: "info", plain: "This may allow an app to read notifications, including security codes.", action: "Keep it only for apps whose purpose needs it (e.g. a watch companion).", settings: path("notif", p) });
  if (sig.developerOptions) f.push({ id: "D11", title: "Developer options on", severity: "info", plain: "USB debugging can let a connected computer control the phone.", action: "Turn it off unless you're developing apps.", settings: path("dev", p) });

  const cannotSee: string[] = [];
  if (p === "ios" || p === "web") cannotSee.push("The list of installed apps and their permissions (iOS doesn't expose this to any app).");
  if (sig.thirdPartyAccessibilityServices === null && p !== "ios") cannotSee.push("Accessibility services (needs the native Security SDK).");
  if (sig.managementProfile === "unknown") cannotSee.push("Device-management / configuration profiles on this build.");
  if (sig.vpnActive === null) cannotSee.push("VPN state on this build.");
  if (sig.userTrustedCertificates === null) cannotSee.push("User-installed certificates on this build.");
  if (sig.remoteAccessApps === null) cannotSee.push("Which remote-access apps are installed.");

  const status: DeviceStatus = self.gaveRemoteAccess ? "recovery" : f.some((x) => x.severity === "high") ? "action" : f.some((x) => x.severity === "review") ? "review" : "protected";
  const state = DEVICE_STATUS[status].state === "resting" && f.length ? "ears_up" : DEVICE_STATUS[status].state;
  const summary = status === "protected" ? (f.length ? "Nothing risky — a couple of settings are worth knowing about." : `No meaningful issues within what Apollo can see on this ${p === "ios" ? "iPhone" : p === "android" ? "Android device" : "device"}.`)
    : status === "recovery" ? "Someone had access to this device. Work through the steps below — one at a time." : status === "action" ? `${f.filter((x) => x.severity === "high").length} high-risk item${f.filter((x) => x.severity === "high").length > 1 ? "s" : ""} need${f.filter((x) => x.severity === "high").length > 1 ? "" : "s"} your attention.` : `${f.length} item${f.length > 1 ? "s" : ""} worth reviewing. Nothing confirmed dangerous.`;
  return { status, state, summary, findings: f, cannotSee, recoverySteps };
}
