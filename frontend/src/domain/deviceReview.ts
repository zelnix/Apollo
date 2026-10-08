// Device Gate — cross-platform Security & Privacy Review engine (spec §1–§5).
//
// A shared, registry-driven assessment that applies the SAME nine security categories to Android,
// iOS, Windows and macOS, using checks appropriate to each OS. Every applicable setting gets an
// explicit OUTCOME (Checked / Review recommended / Action required / Manual review required /
// Unavailable / Not applicable) — never a blanket "Protected". Pure and unit-tested; it reuses the
// existing DeviceSignals the native collectors already provide and marks everything a build can't yet
// observe as "manual" or "unavailable" (honest coverage), never as safe.
import type { ApolloProtectionHealthInput, DeviceSignals, SelfReport } from "./deviceAnalysis";

export type ReviewPlatform = "android" | "ios" | "windows" | "macos";

export type CheckOutcome = "checked" | "review" | "action" | "manual" | "unavailable" | "not_applicable";
export const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  checked: "Checked",
  review: "Review recommended",
  action: "Action required",
  manual: "Manual review required",
  unavailable: "Unavailable",
  not_applicable: "Not applicable",
};
export const OUTCOME_TONE: Record<CheckOutcome, "resting" | "growling" | "barking" | "neutral" | "unknown"> = {
  checked: "resting", review: "growling", action: "barking", manual: "neutral", unavailable: "unknown", not_applicable: "unknown",
};

export type SecurityCategory = "access" | "system" | "malware" | "apps" | "personal_info" | "privacy" | "network" | "administration" | "data";
export const CATEGORY_LABEL: Record<SecurityCategory, string> = {
  access: "Device access & locking",
  system: "System security",
  malware: "Malware protection",
  apps: "Application security",
  personal_info: "Personal information access",
  privacy: "Privacy & sharing",
  network: "Internet & network security",
  administration: "Device administration",
  data: "Data protection",
};
export const CATEGORY_ORDER: SecurityCategory[] = ["access", "system", "malware", "apps", "personal_info", "privacy", "network", "administration", "data"];

export interface ReviewInput {
  platform: ReviewPlatform;
  signals: DeviceSignals;
  self: SelfReport;
  protection?: ApolloProtectionHealthInput | null;
  osLabel?: string;
}

export type VerifiedBy = "observation" | "user_confirmed" | "none";
export interface CheckResult {
  id: string;
  category: SecurityCategory;
  title: string;
  outcome: CheckOutcome;
  /** The risk identified, for review/action outcomes. Null when none. */
  risk: string | null;
  /** Where the outcome came from (the evidence source), in plain words. */
  evidence: string;
  /** One understandable next step. Null when nothing to do. */
  remediation: string | null;
  /** Exact Settings destination for this platform, when known. */
  settings: string | null;
  verifiedBy: VerifiedBy;
}

type Eval = Pick<CheckResult, "outcome" | "risk" | "evidence" | "remediation" | "verifiedBy">;
interface CheckDef {
  id: string;
  category: SecurityCategory;
  title: string;
  platforms: ReviewPlatform[];
  settings: Partial<Record<ReviewPlatform, string>>;
  evaluate: (i: ReviewInput) => Eval;
}

// Helper builders keep each evaluator a one-liner.
const checked = (evidence: string, verifiedBy: VerifiedBy = "observation"): Eval => ({ outcome: "checked", risk: null, evidence, remediation: null, verifiedBy });
const review = (risk: string, remediation: string, evidence: string, verifiedBy: VerifiedBy = "observation"): Eval => ({ outcome: "review", risk, remediation, evidence, verifiedBy });
const action = (risk: string, remediation: string, evidence: string, verifiedBy: VerifiedBy = "observation"): Eval => ({ outcome: "action", risk, remediation, evidence, verifiedBy });
const manual = (remediation: string): Eval => ({ outcome: "manual", risk: null, remediation, evidence: "Higgins will walk you through this in a few taps.", verifiedBy: "none" });
const unavailable = (_why?: string): Eval => ({ outcome: "unavailable", risk: null, evidence: "Apollo couldn't confirm this one automatically on this device — tap and Higgins will check it with you.", remediation: "Open the setting and Higgins will tell you exactly what to look for.", verifiedBy: "none" });

const DESKTOP_SET = (win: string, mac: string): Partial<Record<ReviewPlatform, string>> => ({ windows: win, macos: mac });

// ------------------------------------------------------------------------------------------------
// The registry. Each check declares the platforms it applies to; a platform not listed → Not applicable.
// Android/iOS evaluators read the DeviceSignals the native collectors already provide. Windows/macOS
// evaluators return Manual review (guided) until their native collectors land — never a false "Checked".
// ------------------------------------------------------------------------------------------------
const CHECKS: CheckDef[] = [
  // --- Device access & locking ---
  { id: "lock", category: "access", title: "Screen lock & auto-lock", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Security → Screen lock", ios: "Settings → Face ID & Passcode", windows: "Settings → Accounts → Sign-in options", macos: "System Settings → Lock Screen" },
    evaluate: (i) => i.signals.screenLockSecure === true ? checked("The device reported a secure screen lock is set.")
      : i.signals.screenLockSecure === false ? action("Anyone who picks up the device can open it without a passcode.", "Set a PIN, password or biometric, and make the screen lock automatically when idle.", "The device reported no secure screen lock is set.")
        : manual("Confirm a passcode/password and biometrics are set, and the device locks automatically when idle.") },

  // --- System security ---
  { id: "os_updates", category: "system", title: "Operating-system updates", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → System → System update", ios: "Settings → General → Software Update", windows: "Settings → Windows Update", macos: "System Settings → General → Software Update" },
    evaluate: (i) => (i.platform === "windows" || i.platform === "macos")
      ? (i.signals.osUpdatesCurrent === true ? checked("The desktop host confirmed the operating system is up to date.")
        : i.signals.osUpdatesCurrent === false ? review("Updates are waiting to install — they usually contain security fixes.", "Open Software Update and install the pending updates.", "The desktop host found pending operating-system updates.")
          : manual("Install any pending updates — they usually contain security patches."))
      : manual("Install any pending updates — they usually contain security patches.") },
  { id: "developer_mode", category: "system", title: "Developer / debugging mode", platforms: ["android", "windows", "macos"],
    settings: { android: "Settings → System → Developer options", windows: "Settings → Privacy & security → For developers", macos: "System Settings → Privacy & Security" },
    evaluate: (i) => i.platform !== "android" ? manual("Confirm developer/debugging mode is off unless you deliberately use it.")
      : i.signals.developerOptions === null ? unavailable("This build couldn't read Developer options.")
        : i.signals.developerOptions ? review("USB debugging can let a connected computer control the device.", "Turn Developer options off unless you're developing apps.", "The device reported Developer options are on.")
          : checked("The device reported Developer options are off.") },

  // --- Malware protection ---
  { id: "apollo_protection", category: "malware", title: "Apollo background protection", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Network & internet → VPN", ios: "Settings → Apollo", windows: "Apollo → Protection", macos: "Apollo → Protection" },
    evaluate: (i) => !i.protection ? unavailable("Apollo couldn't obtain a current protection reading. This does not mean protection is running.")
      : i.protection.operational ? checked(`The device confirmed Apollo protection operational${i.protection.checkedAt ? ` at ${new Date(i.protection.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.`)
        : !i.protection.requested ? review("No automatic background protection is running.", "Open Apollo's protection settings and turn protection on.", "Protection is currently turned off.")
          : action("Protection was requested but the device did not confirm it running.", i.protection.permissionIssues.length ? `Restore: ${i.protection.permissionIssues.join(", ")}, then re-check.` : "Restore the protection service, then re-check.", i.protection.permissionIssues.length ? `Missing permission: ${i.protection.permissionIssues.join(", ")}.` : i.protection.degradedReason ?? "Protection did not confirm running.") },
  { id: "antivirus", category: "malware", title: "Antivirus / malware protection", platforms: ["windows", "macos", "android"],
    settings: DESKTOP_SET("Settings → Privacy & security → Windows Security → Virus & threat protection", "Open your antivirus app"),
    evaluate: (i) => i.platform === "android" ? manual("Open Play Store → Play Protect and confirm scanning is on.")
      : manual(i.platform === "windows" ? "Confirm Microsoft Defender (or your antivirus) real-time protection is on and up to date." : "Confirm your antivirus (or Apple's built-in protection) is active and updated.") },

  // --- Application security ---
  { id: "unknown_sources", category: "apps", title: "Installs from unknown sources", platforms: ["android", "windows", "macos"],
    settings: { android: "Settings → Apps → Special app access → Install unknown apps", windows: "Settings → Apps → Advanced app settings", macos: "System Settings → Privacy & Security → Security" },
    evaluate: (i) => i.platform !== "android" ? manual(i.platform === "macos" ? "Confirm Gatekeeper only allows apps from the App Store / identified developers." : "Confirm you only install apps from trusted sources.")
      : (i.signals.unknownSourcesEnabled || i.self.unknownSourcesOn) ? review("Apps installed from outside Google Play skip its safety checks.", "Turn this off for every app except one you deliberately use for sideloading.", i.self.unknownSourcesOn ? "You reported allowing installs from unknown sources." : "The device reported unknown-source installs are allowed.", i.signals.unknownSourcesEnabled ? "observation" : "user_confirmed")
        : i.signals.unknownSourcesEnabled === null ? unavailable("This build couldn't read the unknown-sources setting.") : checked("The device reported unknown-source installs are off.") },
  { id: "remote_access", category: "apps", title: "Remote-control software", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Apps", ios: "Review installed apps", windows: "Settings → Apps → Installed apps", macos: "System Settings → General → Login Items" },
    evaluate: (i) => {
      if (i.self.gaveRemoteAccess) return action("Someone had remote access — they could see your screen, read codes and open apps.", "End the session, remove the remote-access app, then review the accounts used.", "You reported giving someone remote access.", "user_confirmed");
      const remote = i.signals.remoteAccessApps;
      if (remote === null) return i.platform === "android" ? unavailable("This build couldn't read installed remote-access apps.") : manual("Check for remote-control apps (AnyDesk, TeamViewer, screen-sharing) you don't recognise and remove them.");
      return remote.length ? review(`Remote-control apps are installed: ${remote.join(", ")}.`, "Remove any you don't deliberately use with people you trust.", "The device reported these remote-access apps.") : checked("No known remote-access apps were found.");
    } },
  { id: "accessibility", category: "apps", title: "Accessibility access", platforms: ["android", "macos"],
    settings: { android: "Settings → Accessibility → Downloaded apps", macos: "System Settings → Privacy & Security → Accessibility" },
    evaluate: (i) => {
      if (i.platform === "macos") return manual("Review which apps have Accessibility control and remove any you don't recognise.");
      const a11y = i.signals.thirdPartyAccessibilityServices;
      if (i.self.grantedAccessibility) return review("Accessibility access can let an app read your screen and act in other apps.", "Keep it only for genuine accessibility helpers; revoke it for anything else.", "You reported granting accessibility access recently.", "user_confirmed");
      if (a11y === null) return unavailable("This build couldn't read which apps have Accessibility access.");
      return a11y.length ? review(`Apps with Accessibility access: ${a11y.join(", ")}.`, "Keep it only for helpers you chose; revoke it for anything else.", "The device reported these accessibility services.") : checked("No third-party apps have Accessibility access.");
    } },
  { id: "unexpected_app", category: "apps", title: "Unrecognised apps", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Apps", ios: "Review your Home Screen & App Library", windows: "Settings → Apps → Installed apps", macos: "Finder → Applications" },
    evaluate: (i) => i.self.newAppUnexpected ? review("Apps that appear after a call, message or download deserve a check.", "Review the app's access and remove it if it doesn't belong.", "You reported an app you don't remember installing.", "user_confirmed") : manual("Scan your installed apps for anything you don't recognise.") },

  // --- Personal information access ---
  { id: "sensitive_permissions", category: "personal_info", title: "App access to camera, mic, location, contacts & files", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Privacy → Permission manager", ios: "Settings → Privacy & Security", windows: "Settings → Privacy & security", macos: "System Settings → Privacy & Security" },
    evaluate: (i) => manual(i.platform === "ios" ? "Open the App Privacy Report to see what each app accessed, and revoke anything that doesn't need it." : "Review which apps can use your camera, microphone, location, contacts and files; revoke access that isn't needed.") },

  // --- Privacy & sharing ---
  { id: "notification_access", category: "privacy", title: "Apps that can read notifications", platforms: ["android"],
    settings: { android: "Settings → Apps → Special app access → Notification access" },
    evaluate: (i) => {
      const n = i.signals.notificationAccessApps;
      if (n === null) return unavailable("This build couldn't read notification access.");
      return n.length ? review(`Apps that can read your notifications (incl. security codes): ${n.join(", ")}.`, "Keep it only for apps that need it (e.g. a watch companion).", "The device reported these notification listeners.") : checked("No apps have notification access.");
    } },
  { id: "sharing_services", category: "privacy", title: "Location & device sharing", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Location", ios: "Settings → Privacy & Security → Location Services", windows: "Settings → Privacy & security → Location", macos: "System Settings → Privacy & Security → Location Services" },
    evaluate: () => manual("Review who and what you share your location and screen with, and turn off sharing you don't need.") },

  // --- Internet & network security ---
  { id: "vpn", category: "network", title: "VPN & network redirection", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Network → VPN", ios: "Settings → VPN", windows: "Settings → Network & internet → VPN", macos: "System Settings → VPN" },
    evaluate: (i) => {
      if (i.self.unexpectedVpn || (i.signals.vpnActive && i.signals.vpnProviderKnown === false)) return action("A VPN you didn't choose can watch or redirect everything you do online.", "Turn it off and remove the app or profile that created it.", i.self.unexpectedVpn ? "You reported an unexpected VPN." : "A VPN is active from an unrecognised provider.", i.self.unexpectedVpn && i.signals.vpnProviderKnown !== false ? "user_confirmed" : "observation");
      if (i.signals.vpnActive && i.signals.vpnProviderKnown === null) return review("A VPN is on. Apollo can see it's active but not who runs it.", "If you turned it on, that's fine. If not, find what created it and turn it off.", "The device reported an active VPN of unknown provider.");
      if (i.signals.vpnActive === null) return unavailable("This build couldn't read VPN state.");
      return checked("No unexpected VPN is active.");
    } },
  { id: "firewall", category: "network", title: "Firewall", platforms: ["windows", "macos"],
    settings: DESKTOP_SET("Settings → Privacy & security → Windows Security → Firewall & network protection", "System Settings → Network → Firewall"),
    evaluate: (i) => i.signals.firewallEnabled === true ? checked(`The desktop host confirmed the ${i.platform === "windows" ? "Windows" : "macOS"} firewall is on.`)
      : i.signals.firewallEnabled === false ? action("The firewall is off, so incoming connections aren't being screened.", i.platform === "windows" ? "Turn Windows Defender Firewall on for your active network." : "Turn the macOS firewall on.", "The desktop host reported the firewall is off.")
        : manual(i.platform === "windows" ? "Confirm the Windows firewall is on for your active network profile." : "Confirm the macOS firewall is on.") },

  // --- Device administration ---
  { id: "management_profile", category: "administration", title: "Device-management profile", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Security → Device admin apps", ios: "Settings → General → VPN & Device Management", windows: "Settings → Accounts → Access work or school", macos: "System Settings → General → Device Management" },
    evaluate: (i) => {
      const mp = i.signals.managementProfile;
      const managed = mp === "managed" || mp === "present" || i.self.unexpectedProfile;
      if (managed && !i.self.managementExpected) return action("A management profile can install apps, change network settings and read some activity.", "If your work or school didn't set this up, remove it.", i.self.unexpectedProfile ? "You reported an unexpected profile." : "The device reported an active management profile.", i.self.unexpectedProfile && mp !== "managed" && mp !== "present" ? "user_confirmed" : "observation");
      if (managed) return checked("Managed by your work or school (expected).");
      if (mp === "device_admin") return checked("A device-admin app is active — normal for Find My Device / anti-theft apps.");
      if (mp === "unknown") return i.platform === "ios" ? review("iOS only tells an app when it is managed itself, so Apollo can confirm management but can't rule it out.", "Open VPN & Device Management and confirm no profile you didn't add is present.", "iOS does not expose profile state to apps.") : unavailable("This build couldn't read management-profile state.");
      return checked("No device-management profile is active.");
    } },
  { id: "certificates", category: "administration", title: "Trusted certificates", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Security → Encryption & credentials → User credentials", ios: "Settings → General → VPN & Device Management", windows: "certmgr.msc → Trusted Root Certification Authorities", macos: "Keychain Access → System Roots" },
    evaluate: (i) => {
      if ((i.signals.userTrustedCertificates ?? 0) > 0 || i.self.newCertificate) return action("An extra trusted certificate can let someone read traffic that looks encrypted.", "Remove any certificate you didn't deliberately install for work or a VPN you chose.", i.self.newCertificate ? "You reported installing a certificate someone sent you." : "The device reported extra user-trusted certificates.", i.self.newCertificate && !(i.signals.userTrustedCertificates ?? 0) ? "user_confirmed" : "observation");
      if (i.signals.userTrustedCertificates === null) return i.platform === "android" ? unavailable("This build couldn't read user certificates.") : manual("Check for trusted certificates you don't recognise and remove them.");
      return checked("No extra user-trusted certificates were found.");
    } },

  // --- Data protection ---
  { id: "encryption", category: "data", title: "Device encryption", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → Security → Encryption", ios: "Enabled automatically with a passcode", windows: "Settings → Privacy & security → Device encryption / BitLocker", macos: "System Settings → Privacy & Security → FileVault" },
    evaluate: (i) => i.platform === "ios"
      ? (i.signals.screenLockSecure === true ? checked("iOS encrypts the device automatically because a passcode is set.")
        : i.signals.screenLockSecure === false ? action("Without a passcode, iOS isn't encrypting your device's data.", "Set a passcode — iOS then encrypts the device automatically.", "The device reported no passcode is set.")
          : manual("Set a passcode — iOS encrypts the device automatically once you do."))
      : manual(i.platform === "windows" ? "Confirm BitLocker / Device encryption is on so your files are protected if the PC is lost." : i.platform === "macos" ? "Confirm FileVault is on so your disk is encrypted." : "Confirm device encryption is on.") },
  { id: "backup", category: "data", title: "Backup & recovery", platforms: ["android", "ios", "windows", "macos"],
    settings: { android: "Settings → System → Backup", ios: "Settings → [your name] → iCloud → iCloud Backup", windows: "Settings → Accounts → Windows backup", macos: "System Settings → General → Time Machine" },
    evaluate: () => manual("Confirm you have a recent, protected backup so you can recover if the device is lost or compromised.") },
];

/** Run the full review for this platform/inputs. Returns every applicable check with an explicit outcome
 *  and an HONEST overall that never reports "clear"/Protected while significant checks were skipped. */
export function runDeviceReview(input: ReviewInput, now: string = new Date().toISOString()): DeviceReview {
  const results: CheckResult[] = CHECKS.map((def) => {
    if (!def.platforms.includes(input.platform)) {
      return { id: def.id, category: def.category, title: def.title, outcome: "not_applicable" as const, risk: null, evidence: `Not applicable on ${PLATFORM_LABEL[input.platform]}.`, remediation: null, settings: null, verifiedBy: "none" as const };
    }
    const e = def.evaluate(input);
    return { id: def.id, category: def.category, title: def.title, ...e, settings: def.settings[input.platform] ?? null };
  });

  const counts = results.reduce((acc, r) => { acc[r.outcome] += 1; return acc; }, { checked: 0, review: 0, action: 0, manual: 0, unavailable: 0, not_applicable: 0 } as Record<CheckOutcome, number>);
  const applicable = results.filter((r) => r.outcome !== "not_applicable");
  const needsManual = counts.manual + counts.unavailable;

  // Honest overall. "clear" requires at least one verified Checked AND zero action/review AND zero
  // skipped checks — otherwise we never claim Protected.
  const overall: ReviewOverall = applicable.length === 0 ? "unknown"
    : counts.action > 0 ? "action"
      : counts.review > 0 ? "review"
        : needsManual > 0 ? "manual"
          : counts.checked > 0 ? "clear" : "unknown";
  const overallLabel = OVERALL_LABEL[overall];
  const osLabel = input.osLabel ?? PLATFORM_LABEL[input.platform];
  const summary = overall === "action" ? `${counts.action} item${counts.action > 1 ? "s" : ""} need${counts.action > 1 ? "" : "s"} action, and other settings still need a manual review.`
    : overall === "review" ? `${counts.review} item${counts.review > 1 ? "s" : ""} worth reviewing. Nothing confirmed dangerous.`
      : overall === "manual" ? `${counts.checked} setting${counts.checked === 1 ? "" : "s"} verified automatically; ${needsManual} still need a manual review on this ${osLabel}.`
        : overall === "clear" ? `Every applicable setting Apollo could check on this ${osLabel} looks protected.`
          : "Apollo couldn't assess this device.";

  return { platform: input.platform, osLabel, checkedAt: now, results, counts, overall, overallLabel, summary, coverage: { total: applicable.length, automated: counts.checked + counts.review + counts.action, needsManual } };
}

export type ReviewOverall = "action" | "review" | "manual" | "clear" | "unknown";
export interface DeviceReview {
  platform: ReviewPlatform;
  osLabel: string;
  checkedAt: string;
  results: CheckResult[];
  counts: Record<CheckOutcome, number>;
  overall: ReviewOverall;
  overallLabel: string;
  summary: string;
  coverage: { total: number; automated: number; needsManual: number };
}

const PLATFORM_LABEL: Record<ReviewPlatform, string> = { android: "Android device", ios: "iPhone or iPad", windows: "Windows PC", macos: "Mac" };
const OVERALL_LABEL: Record<ReviewOverall, string> = { action: "Action required", review: "Review recommended", manual: "Partially checked", clear: "Looks protected", unknown: "Not assessed" };
const OVERALL_STATE: Record<ReviewOverall, "barking" | "growling" | "ears_up" | "resting"> = { action: "barking", review: "growling", manual: "ears_up", clear: "resting", unknown: "ears_up" };
export const overallState = (o: ReviewOverall) => OVERALL_STATE[o];

/** Group results by category, preserving category order and dropping categories with only N/A. */
export function groupByCategory(review: DeviceReview): { category: SecurityCategory; label: string; results: CheckResult[] }[] {
  return CATEGORY_ORDER
    .map((category) => ({ category, label: CATEGORY_LABEL[category], results: review.results.filter((r) => r.category === category && r.outcome !== "not_applicable") }))
    .filter((g) => g.results.length > 0);
}
