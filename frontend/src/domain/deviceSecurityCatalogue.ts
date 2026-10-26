/**
 * Device Security Catalogue — every OS/OEM protection Apollo can usefully talk about, on ANY device:
 * Android phones, iPhones, Windows PCs and Macs.
 *
 * This is deliberately not an OEM list. Each entry describes a protection in the terms the person
 * meets it in ("App scanning", "Screen lock", "Dangerous-site warnings"), and where a real read
 * exists it names whoever actually answered — Google Play Protect, Microsoft Defender, "Android",
 * "Apple", the carrier's app — so a Xiaomi, a Pixel, a Samsung, a Mac and a PC all get the same
 * honest treatment.
 *
 * Two hard rules, from the Device Capabilities objective:
 *   • Apollo NEVER infers an on/off state. Either a read answered, or the row says
 *     "Apollo can't verify this" and tells the person exactly how to check it themselves.
 *   • A protection that belongs to the device stays the device's. Apollo reports it, never claims it.
 *
 * Pure: no React, no native imports, no clock of its own (the caller passes `now`).
 * Reads come from the EXISTING reads (Android device-posture snapshot, device security signals, and
 * the desktop host's security audit); this module only interprets them.
 */

import {
  evidenceFor, healthFor, healthLabel,
  type CapabilityAction, type CapabilityPlatform, type DeviceProtectionRow,
  type DeviceProtectionState, type ProtectionArea, type ProtectionGuidance, type ProtectionHealth,
} from "./deviceProtectionTypes.ts";
import type { PrivateDnsMode } from "./types.ts";

/**
 * The subset of the existing reads this catalogue interprets. Every field is nullable and `null`
 * always means "no answer" — never "off".
 */
export interface SecurityStateRead {
  screenLockSecure: boolean | null;
  /** From the Android posture snapshot: "enrolled" | "none_enrolled" | "no_hardware" | "unavailable". */
  biometricStatus: string | null;
  developerOptions: boolean | null;
  usbDebugging: boolean | null;
  /** Android: whether THIS app may install other apps (per-app since Android 8). */
  unknownSources: boolean | null;
  /** Android: Build.VERSION.SECURITY_PATCH, e.g. "2026-04-01". */
  securityPatch: string | null;
  osVersion: string | null;
  /** Names/packages of the other apps holding device-admin rights. */
  deviceAdmins: string[] | null;
  /** -1 from the native read means "couldn't read", which stays unknown. */
  userCertificateCount: number | null;
  rootIndicators: string[] | null;
  privateDnsActive: boolean | null;
  /** How Private DNS is set (see PrivateDnsMode). Null when nothing could be read. */
  privateDnsMode: PrivateDnsMode | null;
  /** The provider hostname when Private DNS is set to one. */
  privateDnsHost: string | null;
  /** The OS's own scanner, e.g. Google Play Protect or Microsoft Defender. */
  osThreatReport: { source: string; status: string; protectionOff?: boolean | null } | null;
  /** Android posture: other apps' accessibility services, apps reading all notifications, another VPN. */
  accessibilityServices: string[] | null;
  notificationListeners: string[] | null;
  otherVpnActive: boolean | null;
  /** Desktop host reads. */
  firewallEnabled: boolean | null;
  osUpdatesCurrent: boolean | null;
  antivirusEnabled: boolean | null;
  /** OS integrity features the desktop host can name: SIP, Gatekeeper, Defender tamper protection… */
  systemProtections: { name: string; enabled: boolean | null }[] | null;
  /** Default handler packages, used only to name the right app in the instructions. */
  defaultDialerPackage: string | null;
  defaultSmsPackage: string | null;
}

export const EMPTY_SECURITY_READ: SecurityStateRead = {
  screenLockSecure: null, biometricStatus: null, developerOptions: null, usbDebugging: null,
  unknownSources: null, securityPatch: null, osVersion: null, deviceAdmins: null,
  userCertificateCount: null, rootIndicators: null, privateDnsActive: null, privateDnsMode: null, privateDnsHost: null, osThreatReport: null,
  accessibilityServices: null, notificationListeners: null, otherVpnActive: null,
  firewallEnabled: null, osUpdatesCurrent: null, antivirusEnabled: null, systemProtections: null,
  defaultDialerPackage: null, defaultSmsPackage: null,
};

interface Resolved {
  state: DeviceProtectionState;
  detail: string;
  /** Overrides the entry's owner when the read itself names who answered. */
  attributedTo?: string;
  /** How serious a verified deviation is: "review" for things that can be legitimate, "action" otherwise. */
  health?: ProtectionHealth;
}

/** What Apollo knows about the device itself — used to pick OEM/OS-specific protections and steps. */
export interface DeviceFacts {
  /** Lower-case maker, e.g. "samsung", "google", "apple". Null when unknown. */
  manufacturer: string | null;
  osVersion: string | null;
  model: string | null;
  /** Two-letter country from the phone's region setting, e.g. "AU". Absent or null when unknown. */
  country?: string | null;
}

export const UNKNOWN_DEVICE: DeviceFacts = { manufacturer: null, osVersion: null, model: null };

interface SecurityDef {
  id: string;
  title: string;
  subtitle: string;
  area: ProtectionArea;
  platforms: CapabilityPlatform[];
  /** Only on these makers (lower-case). Omitted = every maker. Unknown maker = not offered. */
  oems?: string[];
  /** Only from this OS major version. Unknown version = still offered. */
  minOsMajor?: number;
  /** Only where the phone's region setting is one of these countries. Unknown country = not offered. */
  countries?: string[];
  /** Worth it for some people only — never listed under "Needs checking". */
  optional?: boolean;
  /** Who owns this protection when no read names someone more specific. */
  owner: string | ((platform: CapabilityPlatform) => string);
  /** The configuration Higgins recommends. Never phrased as if Apollo knows the current one. */
  recommended: string;
  steps: (read: SecurityStateRead, platform: CapabilityPlatform, device: DeviceFacts) => string[];
  /** The closest settings screen. Omitted when there is nothing on the device to change. */
  action?: (platform: CapabilityPlatform) => CapabilityAction;
  /** Apollo's honest line when nothing could read this. */
  unverified: string;
  /** Returns a state only when a real read answered. `null` → "Check manually". */
  resolve?: (read: SecurityStateRead, now: number, platform: CapabilityPlatform) => Resolved | null;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

const SETTINGS_ALIAS = "(your phone may call this ‘Security & privacy’, ‘Lock screen & security’ or ‘Passwords & security’)";

const isDesktop = (p: CapabilityPlatform) => p === "windows" || p === "macos";
const osName = (p: CapabilityPlatform) => p === "windows" ? "Windows" : p === "macos" ? "macOS" : p === "ios" ? "iOS" : "Android";

/** The person's own phone app / messaging app, named from the real default handler where possible. */
function dialerName(read: SecurityStateRead): string {
  const pkg = read.defaultDialerPackage ?? "";
  if (pkg.includes("samsung")) return "Samsung Phone app";
  if (pkg.includes("google")) return "Google Phone app";
  return "Phone app";
}
function smsName(read: SecurityStateRead): string {
  const pkg = read.defaultSmsPackage ?? "";
  if (pkg.includes("samsung")) return "Samsung Messages";
  if (pkg.includes("google")) return "Google Messages";
  return "Messages app";
}

/** Days between a security-patch date string and now. `null` when the string isn't a date. */
export function patchAgeDays(patch: string | null, now: number): number | null {
  if (!patch) return null;
  const parsed = Date.parse(patch.length === 7 ? `${patch}-01` : patch);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 86_400_000));
}

/** A named OS integrity feature from the desktop host's audit, e.g. "Gatekeeper". */
function namedProtection(read: SecurityStateRead, match: RegExp): { name: string; enabled: boolean | null } | null {
  return read.systemProtections?.find((p) => match.test(p.name)) ?? null;
}

const SECURITY_SETTINGS = (platform: CapabilityPlatform, path: string, label: string): CapabilityAction =>
  ({ target: "security", path: isDesktop(platform) ? path : path, label });

// ────────────────────────────────────────────────────────────────────
// The catalogue
// ────────────────────────────────────────────────────────────────────

const CATALOGUE: SecurityDef[] = [
  // ── Who can get in ────────────────────────────────────────────────
  {
    id: "screen_lock",
    title: "Screen lock",
    subtitle: "The code, fingerprint or password that unlocks this device",
    area: "access",
    platforms: ["android", "ios", "windows", "macos"],
    owner: "your device",
    recommended: "Higgins recommends a 6-digit PIN at the very least, or a password, with fingerprint or face unlock on top so it isn’t a chore — and a short auto-lock so it doesn’t sit unlocked on a table.",
    steps: (_r, platform) => platform === "ios"
      ? ["Open Settings → Face ID & Passcode (or Touch ID & Passcode)", "Turn Passcode On if it is off", "Tap ‘Change Passcode’ → ‘Passcode Options’ for 6 digits or longer", "Turn on Face ID or Touch ID for day-to-day unlocking", "Set Settings → Display & Brightness → Auto-Lock to 2 minutes or less"]
      : platform === "windows"
        ? ["Open Settings → Accounts → Sign-in options", "Set a PIN or password (Windows Hello face or fingerprint if your PC has it)", "Under ‘Additional settings’, set ‘If you’ve been away, when should Windows require you to sign in again?’", "Turn on the lock screen timeout in Settings → System → Power & battery → Screen and sleep"]
        : platform === "macos"
          ? ["Open System Settings → Touch ID & Password (or Login Password)", "Set a password if there isn’t one, and add Touch ID if your Mac has it", "Open System Settings → Lock Screen", "Set ‘Require password after screen saver begins’ to ‘Immediately’ or ‘After 1 minute’"]
          : [`Open Settings → Security ${SETTINGS_ALIAS}`, "Tap ‘Screen lock’ or ‘Screen lock type’", "Choose PIN, password or pattern — 6 digits or more", "Add fingerprint or face unlock if your device offers it", "Set the screen timeout to a minute or two"],
    action: (platform) => SECURITY_SETTINGS(platform,
      platform === "windows" ? "Settings → Accounts → Sign-in options"
        : platform === "macos" ? "System Settings → Touch ID & Password"
          : platform === "ios" ? "Settings → Face ID & Passcode" : "Settings → Security → Screen lock",
      isDesktop(platform) ? "Where to find it" : "Open security settings"),
    unverified: "Apollo cannot read whether a lock is set on this device.",
    resolve: (read) => {
      if (read.screenLockSecure === null) return null;
      const bio = read.biometricStatus;
      const bioLine = bio === "enrolled"
        ? " Fingerprint or face unlock is also set up."
        : bio === "none_enrolled"
          ? " This device supports fingerprint or face unlock, but none is set up yet."
          : "";
      return read.screenLockSecure
        ? { state: "active", detail: `A secure screen lock (PIN, pattern, password or biometric) is set on this device.${bioLine}` }
        : { state: "off", detail: "This device has no secure screen lock set, so anyone holding it can open your apps, messages and codes." };
    },
  },
  {
    id: "developer_options",
    title: "Developer options and USB debugging",
    subtitle: "The engineering switches that let a computer drive this phone",
    area: "access",
    platforms: ["android"],
    owner: "Android",
    recommended: "Higgins recommends keeping Developer options and USB debugging off unless you are developing apps yourself.",
    steps: () => [
      "Open Settings → System → ‘Developer options’",
      "Turn off ‘USB debugging’",
      "Turn off the Developer options switch at the top",
      "If the menu disappears afterwards, that is correct — it is hidden again",
    ],
    action: () => ({ target: "developer", path: "Settings → System → Developer options", label: "Open developer options" }),
    unverified: "Apollo could not read whether Developer options are on.",
    resolve: (read) => {
      if (read.developerOptions === null) return null;
      if (!read.developerOptions) return { state: "as_recommended", detail: "Developer options are off on this phone, which is what Higgins recommends.", attributedTo: "Android" };
      const usb = read.usbDebugging === true
        ? " USB debugging is on as well, which lets a connected computer read and control this phone."
        : read.usbDebugging === false ? " USB debugging itself is off." : "";
      return { state: "off", health: read.usbDebugging === true ? "action" : "review", detail: `Developer options are on.${usb} If you did not turn this on yourself, turn it off.`, attributedTo: "Android" };
    },
  },
  {
    id: "user_certificates",
    title: "Certificates you have installed",
    subtitle: "Extra trust certificates added to this device",
    area: "access",
    platforms: ["android"],
    owner: "Android",
    recommended: "Higgins recommends removing any certificate you did not install yourself for a reason you remember.",
    steps: () => [
      "Open Settings → Security → ‘Encryption & credentials’",
      "Tap ‘Trusted credentials’ → the ‘User’ tab",
      "Remove anything you do not recognise",
    ],
    action: () => ({ target: "security", path: "Settings → Security → Encryption & credentials → Trusted credentials", label: "Open credential settings" }),
    unverified: "Apollo could not read the certificates on this device.",
    resolve: (read) => {
      const count = read.userCertificateCount;
      if (count === null || count < 0) return null;
      return count === 0
        ? { state: "as_recommended", detail: "No hand-installed certificates are on this device.", attributedTo: "Android" }
        : { state: "off", health: "review", detail: `${count} hand-installed certificate${count === 1 ? " is" : "s are"} on this device. If your employer set this up, that is expected. If not, remove it.`, attributedTo: "Android" };
    },
  },
  {
    id: "lockdown_mode",
    optional: true,
    title: "Lockdown Mode",
    subtitle: "Apple’s extreme protection for people who are personally targeted",
    area: "access",
    platforms: ["ios", "macos"],
    owner: "Apple",
    recommended: "Higgins recommends leaving this off unless you believe you are being personally targeted. Read what it switches off before you turn it on.",
    steps: (_r, platform) => platform === "macos"
      ? ["Open System Settings → Privacy & Security", "Scroll to ‘Lockdown Mode’", "Read what it switches off before deciding"]
      : ["Open Settings → Privacy & Security", "Scroll to ‘Lockdown Mode’", "Read what it switches off before deciding"],
    action: (platform) => ({ target: "security", path: platform === "macos" ? "System Settings → Privacy & Security → Lockdown Mode" : "Settings → Privacy & Security → Lockdown Mode", label: "Read about Lockdown Mode" }),
    unverified: "Apple does not let Apollo read this setting, so ApolloSG cannot tell whether it is on.",
  },

  // ── Apps on this device ───────────────────────────────────────────
  {
    id: "app_scanner",
    title: "App scanning",
    subtitle: "Your device’s own check of the apps you install",
    area: "apps",
    platforms: ["android"],
    owner: "Google Play Protect",
    recommended: "Higgins recommends leaving app scanning switched on, and running a scan now if you have installed anything during or after a suspicious call.",
    steps: () => [
      "Open the Play Store (or your phone’s own app store)",
      "Tap your profile picture (top right)",
      "Tap ‘Play Protect’, then the settings cog",
      "Turn on ‘Scan apps with Play Protect’",
      "Tap ‘Scan’ to check the apps on your phone now",
    ],
    action: () => ({ target: "security", path: "Play Store → Profile → Play Protect → Settings", label: "Check app scanning" }),
    unverified: "Apollo cannot read whether app scanning is currently switched on.",
    resolve: (read) => {
      const report = read.osThreatReport;
      if (!report || report.status === "not_available" || report.status === "error") return null;
      if (report.protectionOff === true) {
        return { state: "off", detail: `${report.source} reports that its own scanning is switched off, so new apps are not being checked by it.`, attributedTo: report.source };
      }
      return { state: "active", detail: `${report.source} is scanning the apps on this device. Anything it finds stays its finding — Apollo reports it as theirs, never as its own.`, attributedTo: report.source };
    },
  },
  {
    id: "antivirus",
    title: "Antivirus protection",
    subtitle: "Real-time scanning of files and programs on this computer",
    area: "apps",
    platforms: ["windows", "macos"],
    owner: "your security software",
    recommended: "Higgins recommends keeping real-time protection on, and letting it update itself. One scanner is enough — two fight each other.",
    steps: (_r, platform) => platform === "windows"
      ? ["Open Settings → Privacy & security → Windows Security", "Tap ‘Virus & threat protection’", "Check ‘Real-time protection’ is on under ‘Manage settings’", "Run a quick scan if you have downloaded anything you were unsure about"]
      : ["Open System Settings → Privacy & Security", "Check that you know which security software is installed, if any", "macOS also screens downloads itself — keep Gatekeeper on (see System protection)", "Run a scan with your security software if you downloaded something you were unsure about"],
    action: (platform) => ({ target: "security", path: platform === "windows" ? "Settings → Privacy & security → Windows Security → Virus & threat protection" : "System Settings → Privacy & Security", label: "Where to find it" }),
    unverified: "Apollo could not read whether real-time antivirus protection is on.",
    resolve: (read) => {
      if (read.antivirusEnabled === null) return null;
      const source = read.osThreatReport?.source ?? "Your security software";
      return read.antivirusEnabled
        ? { state: "active", detail: `${source} reports that real-time protection is on. Anything it finds stays its finding — Apollo reports it as theirs.`, attributedTo: source }
        : { state: "off", detail: `${source} reports that real-time protection is off, so files and programs are not being scanned as they run.`, attributedTo: source };
    },
  },
  {
    id: "unknown_sources",
    title: "Installing apps from outside the store",
    subtitle: "Whether apps can be side-loaded onto this phone",
    area: "apps",
    platforms: ["android"],
    owner: "Android",
    recommended: "Higgins recommends keeping this off for every app except one you deliberately use to install software yourself.",
    steps: () => [
      "Open Settings → Apps → Special access → ‘Install unknown apps’",
      "Go through the list app by app",
      "Turn it off for anything you did not deliberately set up",
      "Browsers and messaging apps should normally be off",
    ],
    action: () => ({ target: "unknown_sources", path: "Settings → Apps → Special access → Install unknown apps", label: "Open install permissions" }),
    unverified: "Apollo cannot read which apps are allowed to install other apps.",
    resolve: (read) => {
      if (read.unknownSources === null) return null;
      return read.unknownSources
        ? { state: "off", health: "review", detail: "ApolloSG itself is allowed to install apps on this phone. Android only lets Apollo read its own setting, so check the others in the list too.", attributedTo: "Android" }
        : { state: "as_recommended", detail: "ApolloSG is not allowed to install apps on this phone. Android only lets Apollo read its own setting, so check the others in the list too.", attributedTo: "Android" };
    },
  },
  {
    id: "device_admin_apps",
    title: "Apps with device-admin control",
    subtitle: "Apps allowed to lock, wipe or police this device",
    area: "apps",
    platforms: ["android", "ios"],
    owner: (platform) => osName(platform),
    recommended: "Higgins recommends removing admin rights from anything you do not recognise, and keeping them only for Find My Device and software your employer installed.",
    steps: (_r, platform) => platform === "ios"
      ? ["Open Settings → General → VPN & Device Management", "Read the list and remove any profile you do not recognise", "A work profile you expect is fine — anything else is not"]
      : ["Open Settings → Security → ‘Device admin apps’", "Read the list and deactivate anything you do not recognise", "If an app refuses to deactivate, that is a serious sign — ask Higgins what to do next"],
    action: (platform) => ({ target: "security", path: platform === "ios" ? "Settings → General → VPN & Device Management" : "Settings → Security → Device admin apps", label: "Open device admin" }),
    unverified: "Apollo could not read which apps hold device-admin rights.",
    resolve: (read, _now, platform) => {
      const admins = read.deviceAdmins;
      if (!admins) return null;
      if (!admins.length) return { state: "as_recommended", detail: "No other app holds device-admin rights on this device.", attributedTo: osName(platform) };
      return { state: "off", health: "review", detail: `${admins.length} app${admins.length === 1 ? "" : "s"} hold device-admin rights: ${admins.join(", ")}. Find My Device and work software are normal here. Anything else is worth removing.`, attributedTo: osName(platform) };
    },
  },

  // ── Web and network ───────────────────────────────────────────────
  {
    id: "safe_browsing",
    title: "Dangerous-site warnings",
    subtitle: "Your browser’s warning before a scam website loads",
    area: "web",
    platforms: ["android", "ios", "windows", "macos"],
    owner: "your browser",
    recommended: "Higgins recommends leaving your browser’s dangerous-site warnings on, at the standard level or higher.",
    steps: (_r, platform) => isDesktop(platform)
      ? ["Open your browser (Chrome, Edge, Safari, Firefox…)", "Open its Settings → ‘Privacy and security’", "Find ‘Safe Browsing’, ‘Microsoft Defender SmartScreen’ or ‘Fraudulent Website Warning’", "Turn it on (choose ‘Standard’ or ‘Enhanced’ if offered)"]
      : ["Open your browser (Chrome, Samsung Internet, Safari, Firefox…)", "Open its Settings → ‘Privacy and security’", "Find ‘Safe Browsing’, ‘Warn about suspicious sites’ or ‘Fraudulent Website Warning’", "Turn it on (choose ‘Standard’ or ‘Enhanced’ if offered)"],
    action: () => ({ target: "apps", path: "Your browser → Settings → Privacy and security", label: "Where to find it" }),
    unverified: "Apollo cannot read your browser’s settings, so it cannot tell whether this is on.",
  },
  {
    id: "private_dns",
    title: "Private DNS",
    subtitle: "Encrypting the lookups your device makes for every website",
    area: "web",
    platforms: ["android"],
    owner: "Android",
    recommended: "Higgins recommends setting Private DNS to ‘Automatic’. Apollo’s website checks keep working alongside it. A provider hostname also encrypts lookups, but sends every one straight to that provider, past Apollo’s website checks.",
    steps: () => [
      "Open Settings → Network & internet → ‘Private DNS’ (Samsung: Settings → Connections → More connection settings → Private DNS)",
      "Choose ‘Automatic’",
      "Save, then reopen the screen to confirm it stuck",
    ],
    action: () => ({ target: "private_dns", path: "Settings → Network & internet → Private DNS", label: "Open Private DNS settings" }),
    unverified: "Apollo could not read this phone’s Private DNS setting.",
    resolve: (read) => {
      const mode = read.privateDnsMode ?? (read.privateDnsActive === null ? null : read.privateDnsActive ? "automatic" : "not_in_use");
      if (mode === "automatic") return { state: "as_recommended", detail: "Private DNS is set to Automatic, which is what Higgins recommends. Apollo’s website checks keep working alongside it.", attributedTo: "Android" };
      if (mode === "hostname") return { state: "off", health: "review", detail: `Private DNS is set to ${read.privateDnsHost ?? "a provider hostname"}. Your lookups are encrypted, but Android sends every one straight to that provider, so Apollo’s website checks never see them. Choose Automatic to let Apollo check websites again.`, attributedTo: "Android" };
      if (mode === "off") return { state: "off", detail: "Private DNS is Off, so this phone’s website lookups can be read, and in some cases redirected, by the network you are on. Choose Automatic.", attributedTo: "Android" };
      if (mode === "not_in_use") return { state: "off", health: "review", detail: "Android says Private DNS isn’t encrypting lookups on this network. It is either Off, or Automatic on a network that doesn’t support it — Android doesn’t tell ApolloSG which. If it isn’t Automatic, choose Automatic.", attributedTo: "Android" };
      return null;
    },
  },
  {
    id: "firewall",
    title: "Firewall",
    subtitle: "Screening connections coming into this computer",
    area: "web",
    platforms: ["windows", "macos"],
    owner: (platform) => platform === "windows" ? "Windows" : "macOS",
    recommended: "Higgins recommends keeping the firewall on for every network you join, especially public Wi-Fi.",
    steps: (_r, platform) => platform === "windows"
      ? ["Open Settings → Privacy & security → Windows Security", "Tap ‘Firewall & network protection’", "Check it says ‘Firewall is on’ for Domain, Private and Public networks", "Turn on any network showing as off"]
      : ["Open System Settings → Network → Firewall", "Turn it on", "Open ‘Options…’ and tick ‘Enable stealth mode’ if you use public Wi-Fi"],
    action: (platform) => ({ target: "security", path: platform === "windows" ? "Settings → Privacy & security → Windows Security → Firewall & network protection" : "System Settings → Network → Firewall", label: "Where to find it" }),
    unverified: "Apollo could not read this computer’s firewall state.",
    resolve: (read, _now, platform) => {
      if (read.firewallEnabled === null) return null;
      return read.firewallEnabled
        ? { state: "active", detail: `${osName(platform)} reports the firewall is on, so incoming connections are being screened.`, attributedTo: osName(platform) }
        : { state: "off", detail: `${osName(platform)} reports the firewall is off, so incoming connections are not being screened.`, attributedTo: osName(platform) };
    },
  },

  // ── Updates and system ────────────────────────────────────────────
  {
    id: "os_updates",
    title: "Security updates",
    subtitle: "The security fixes your device’s maker sends out",
    area: "updates",
    platforms: ["android", "ios", "windows", "macos"],
    owner: "your device’s maker",
    recommended: "Higgins recommends installing security updates as soon as they appear, and turning on automatic updates so you don’t have to remember.",
    steps: (_r, platform) => platform === "windows"
      ? ["Open Settings → Windows Update", "Click ‘Check for updates’ and install everything offered", "Open ‘Advanced options’ and turn on ‘Receive updates for other Microsoft products’", "Restart when it asks — the fix isn’t applied until you do"]
      : platform === "macos"
        ? ["Open System Settings → General → Software Update", "Install anything offered", "Click the ⓘ beside ‘Automatic updates’ and turn on security responses and system files", "Restart when it asks"]
        : platform === "ios"
          ? ["Open Settings → General → Software Update", "Install anything offered", "Tap ‘Automatic Updates’ and turn on ‘Security Responses & System Files’"]
          : ["Open Settings → Software update (on some phones: Settings → System → System update)", "Tap ‘Download and install’ or ‘Check for updates’", "Install anything offered, including Google Play system updates", "Turn on automatic updates if your phone offers it"],
    action: (platform) => ({ target: "security", path: platform === "windows" ? "Settings → Windows Update" : platform === "macos" ? "System Settings → General → Software Update" : platform === "ios" ? "Settings → General → Software Update" : "Settings → Software update", label: isDesktop(platform) ? "Where to find it" : "Open update settings" }),
    unverified: "ApolloSG cannot tell whether an update is waiting for this device.",
    resolve: (read, now, platform) => {
      if (isDesktop(platform)) {
        if (read.osUpdatesCurrent === null) return null;
        return read.osUpdatesCurrent
          ? { state: "active", detail: `${osName(platform)} reports this computer is up to date.`, attributedTo: osName(platform) }
          : { state: "out_of_date", detail: `${osName(platform)} reports updates are waiting to be installed. The fixes in them are not on this computer yet.`, attributedTo: osName(platform) };
      }
      const age = patchAgeDays(read.securityPatch, now);
      if (age === null) return null;
      const months = Math.round(age / 30);
      if (age <= 120) {
        return { state: "active", detail: `This device’s security patch is dated ${read.securityPatch} — about ${months <= 1 ? "a month" : `${months} months`} old, which is current. ApolloSG cannot tell whether a newer one is waiting, so it is still worth checking.` };
      }
      return { state: "out_of_date", health: age > 365 ? "action" : "review", detail: `This device’s security patch is dated ${read.securityPatch} — about ${months} months old. That is behind, and the fixes released since then are not on this device.` };
    },
  },
  {
    id: "system_integrity",
    title: "System protection",
    subtitle: "Whether this device’s built-in protections are intact",
    area: "updates",
    platforms: ["android", "ios", "windows", "macos"],
    owner: "your device",
    recommended: "Higgins recommends leaving your device’s built-in protections exactly as the maker shipped them. If they were deliberately turned off, treat banking and email on this device as less safe.",
    steps: (_r, platform) => platform === "windows"
      ? ["Open Settings → Privacy & security → Windows Security → ‘Virus & threat protection’", "Open ‘Manage settings’ and check ‘Tamper Protection’ is on", "Check ‘Device security’ shows Core isolation and Secure boot as on", "If anything is off and you did not turn it off, turn it back on"]
      : platform === "macos"
        ? ["Open System Settings → Privacy & Security → Security", "Check downloads are allowed from ‘App Store & known developers’ (Gatekeeper)", "Leave System Integrity Protection on — it is on by default and needs Recovery mode to change", "If either was turned off and you did not do it, put it back"]
        : ["If you did not unlock this device yourself, ask Higgins what the findings mean", "Avoid banking and email on a device you believe has been unlocked", "A factory reset is the usual way back — back up your photos first"],
    action: (platform) => ({ target: "security", path: platform === "windows" ? "Settings → Privacy & security → Windows Security" : platform === "macos" ? "System Settings → Privacy & Security" : "Settings → Security", label: isDesktop(platform) ? "Where to find it" : "Open security settings" }),
    unverified: "Apollo could not inspect this device’s system protections.",
    resolve: (read, _now, platform) => {
      if (isDesktop(platform)) {
        const named = read.systemProtections;
        if (!named || !named.length) return null;
        const off = named.filter((p) => p.enabled === false);
        const on = named.filter((p) => p.enabled === true);
        if (off.length) {
          return { state: "off", detail: `${osName(platform)} reports ${off.map((p) => p.name).join(", ")} ${off.length === 1 ? "is" : "are"} switched off. If you did not turn ${off.length === 1 ? "it" : "them"} off, that matters.`, attributedTo: osName(platform) };
        }
        if (on.length) {
          return { state: "as_recommended", detail: `${osName(platform)} reports ${on.map((p) => p.name).join(", ")} ${on.length === 1 ? "is" : "are"} on.`, attributedTo: osName(platform) };
        }
        return null;
      }
      const indicators = read.rootIndicators;
      if (!indicators) return null;
      return indicators.length
        ? { state: "off", health: "review", detail: `Apollo found ${indicators.length} sign${indicators.length === 1 ? "" : "s"} that this device may be rooted or jailbroken. These are indicators, not proof — but they are worth understanding.`, attributedTo: "Apollo" }
        : { state: "as_recommended", detail: "Apollo found no sign that this device has been rooted or jailbroken.", attributedTo: "Apollo" };
    },
  },

  // ── Calls and messages ────────────────────────────────────────────
  {
    id: "caller_id_spam",
    title: "Caller ID and spam protection",
    subtitle: "Your phone app labelling a suspected scam call before you answer",
    area: "calls_messages",
    platforms: ["android"],
    owner: "your phone app",
    recommended: "Higgins recommends turning on caller ID and spam protection, and letting your phone app filter suspected spam calls if you are happy for them to go straight to voicemail.",
    steps: (read) => [
      `Open the ${dialerName(read)}`,
      "Tap the three dots (top right) → Settings",
      "Tap ‘Caller ID and spam’ (some phones call this ‘Smart Call’)",
      "Turn it on",
      "Turn on spam filtering too if you want suspected spam silenced",
    ],
    action: () => ({ target: "apps", path: "Phone app → Settings → Caller ID & spam", label: "Check caller ID & spam" }),
    unverified: "Apollo cannot read your phone app’s settings, so it cannot tell whether this is on.",
  },
  {
    id: "message_spam",
    title: "Message spam protection",
    subtitle: "Your messaging app moving scam texts out of your inbox",
    area: "calls_messages",
    platforms: ["android"],
    owner: "your messaging app",
    recommended: "Higgins recommends turning spam protection on in your messaging app.",
    steps: (read) => [
      `Open ${smsName(read)}`,
      "Open its Settings (three dots or your profile picture)",
      "Tap ‘Spam protection’ or ‘Block numbers and spam’",
      "Turn it on",
    ],
    action: () => ({ target: "apps", path: "Messages app → Settings → Spam protection", label: "Check message spam protection" }),
    unverified: "Apollo cannot read your messaging app’s settings, so it cannot tell whether this is on.",
  },
  {
    id: "silence_unknown_callers",
    title: "Silence Unknown Callers",
    subtitle: "Calls from numbers you have never saved go to voicemail",
    area: "calls_messages",
    platforms: ["ios"],
    owner: "Apple",
    recommended: "Higgins recommends turning this on if you rarely get calls from new numbers. If you are expecting a delivery or a clinic, turn it off for the day.",
    steps: () => ["Open Settings → Apps → Phone", "Tap ‘Silence Unknown Callers’", "Turn it on"],
    action: () => ({ target: "apps", path: "Settings → Apps → Phone → Silence Unknown Callers", label: "Check Silence Unknown Callers" }),
    unverified: "Apple does not let Apollo read this setting, so ApolloSG cannot tell whether it is on.",
  },
  {
    id: "filter_unknown_senders",
    title: "Filter Unknown Senders",
    subtitle: "Texts from people not in your contacts are sorted away",
    area: "calls_messages",
    platforms: ["ios"],
    owner: "Apple",
    recommended: "Higgins recommends turning this on, and checking the ‘Unknown Senders’ list now and then for anything genuine.",
    steps: () => ["Open Settings → Apps → Messages", "Tap ‘Unknown & Spam’", "Turn on ‘Filter Unknown Senders’"],
    action: () => ({ target: "apps", path: "Settings → Apps → Messages → Unknown & Spam", label: "Check message filtering" }),
    unverified: "Apple does not let Apollo read this setting, so ApolloSG cannot tell whether it is on.",
  },
  {
    // Australia's carriers block inside their networks, so no app on the phone can see it — and ApolloSG doesn't
    // know which carrier this is. One row explains all three; nothing to switch on, so it never says "Needs checking".
    id: "au_carrier_scam_blocking",
    title: "Your mobile carrier’s scam blocking",
    subtitle: "Telstra, Optus and Vodafone stopping scam calls and texts on their networks",
    area: "calls_messages",
    platforms: ["android", "ios"],
    countries: ["AU"],
    optional: true,
    owner: "your mobile carrier",
    recommended: "There is nothing to switch on: Telstra, Optus and Vodafone apply their scam blocking automatically. Higgins recommends treating a carrier warning as a reason to hang up, and calling back only on a number you looked up yourself.",
    steps: () => [
      "Nothing to turn on — Telstra, Optus and Vodafone block known scam calls and texts on their networks automatically",
      "On Telstra (including Boost and Belong): if a call shows ‘Warning: Potential Fraud’, ‘Unverified: Overseas Call’ or ‘Warning: Suspicious Calling Pattern’, let it go to voicemail",
      "On Optus: if calling a number plays a message that it has been reported for scams, hang up and find the organisation’s real number yourself",
      "On Vodafone: scam calls are blocked in the background, so a scam that gets through looks like any other call — be just as careful",
      "Report scam calls and texts to your carrier and at scamwatch.gov.au",
    ],
    unverified: "Your carrier does this inside its network, so no app on the phone — ApolloSG included — can see it, and ApolloSG doesn’t know which carrier you’re with.",
  },

  // ── If it is lost or stolen ───────────────────────────────────────
  {
    id: "find_my_device",
    title: "Find My Device",
    subtitle: "Locking or wiping this device if it is lost or taken",
    area: "recovery",
    platforms: ["android", "ios", "windows", "macos"],
    owner: "your device’s maker",
    recommended: "Higgins recommends turning device tracking on and checking you know the account it reports to — that account’s password matters as much as the device’s.",
    steps: (_r, platform) => platform === "ios"
      ? ["Open Settings → your name → Find My", "Tap ‘Find My iPhone’ and turn it on", "Turn on ‘Find My network’ so it can be found while offline", "Turn on ‘Send Last Location’"]
      : platform === "macos"
        ? ["Open System Settings → your name → iCloud", "Turn on ‘Find My Mac’", "Allow Location Services for Find My when asked", "Check you know the Apple Account password it reports to"]
        : platform === "windows"
          ? ["Open Settings → Privacy & security → ‘Find my device’", "Turn it on (it needs a Microsoft account and Location Services)", "Check you know that Microsoft account’s password", "Note: it needs BitLocker or a password to be of real use — see Disk encryption"]
          : ["Open Settings and search for ‘Find My Device’", "Turn it on", "Turn on the ‘Find My Device network’ so it can be found while offline", "Check which account it is signed in to, and that you know that password"],
    action: (platform) => ({ target: "security", path: platform === "ios" ? "Settings → your name → Find My" : platform === "macos" ? "System Settings → your name → iCloud → Find My Mac" : platform === "windows" ? "Settings → Privacy & security → Find my device" : "Settings → Security → Find My Device", label: isDesktop(platform) ? "Where to find it" : "Open security settings" }),
    unverified: "Apollo cannot read whether device tracking is switched on.",
    resolve: (read, _now, platform) => {
      if (isDesktop(platform)) return null;
      const admins = read.deviceAdmins;
      if (!admins || !admins.length) return null;
      const google = admins.find((a) => a.includes("com.google.android.gms"));
      if (!google) return null;
      return { state: "active", detail: "Google Play services holds device-admin rights on this phone, which is how Find My Device locks or erases it. Apollo cannot read the switch itself — this is the nearest honest signal, so it is still worth checking.", attributedTo: "Google" };
    },
  },
  {
    id: "disk_encryption",
    title: "Disk encryption",
    subtitle: "Scrambling this computer’s drive so it can’t simply be read",
    area: "recovery",
    platforms: ["windows", "macos"],
    owner: (platform) => platform === "windows" ? "BitLocker" : "FileVault",
    recommended: "Higgins recommends turning encryption on and storing the recovery key somewhere you can actually get to — not only on the computer itself.",
    steps: (_r, platform) => platform === "windows"
      ? ["Open Settings → Privacy & security → ‘Device encryption’ (or search for BitLocker)", "Turn device encryption on", "Save the recovery key to your Microsoft account AND somewhere offline", "Home editions may show ‘Device encryption’ rather than full BitLocker — that is fine"]
      : ["Open System Settings → Privacy & Security → FileVault", "Turn FileVault on", "Choose how to unlock: iCloud account or a recovery key", "If you choose a recovery key, write it down and keep it somewhere safe"],
    action: (platform) => ({ target: "security", path: platform === "windows" ? "Settings → Privacy & security → Device encryption" : "System Settings → Privacy & Security → FileVault", label: "Where to find it" }),
    unverified: "Apollo could not read whether this computer’s drive is encrypted.",
    resolve: (read, _now, platform) => {
      const named = namedProtection(read, /bitlocker|filevault|encrypt/i);
      if (!named || named.enabled === null) return null;
      return named.enabled
        ? { state: "active", detail: `${osName(platform)} reports ${named.name} is on, so this drive is encrypted.`, attributedTo: osName(platform) }
        : { state: "off", detail: `${osName(platform)} reports ${named.name} is off, so the files on this drive can be read by anyone who takes it.`, attributedTo: osName(platform) };
    },
  },

  // ── Device and account security (manual checks — no OS lets an app read these) ──
  {
    id: "account_two_step",
    title: "Two-step verification on your device account",
    subtitle: "A second step beyond the password for the account this device signs in with",
    area: "access",
    platforms: ["android", "ios", "windows", "macos"],
    owner: (platform) => platform === "android" ? "Google" : platform === "windows" ? "Microsoft" : "Apple",
    recommended: "Higgins recommends turning on two-step verification for the account your device signs in with, using an authenticator app, passkey or trusted device rather than SMS where you can.",
    steps: (_r, platform, device) => platform === "android"
      ? ["Open Settings → Google → ‘Manage your Google Account’", "Tap ‘Security’", "Tap ‘2-Step Verification’ and follow the steps", ...(device.manufacturer === "samsung" ? ["Samsung account too: Settings → your name → Security and privacy → Two-step verification"] : [])]
      : platform === "windows"
        ? ["Open account.microsoft.com → Security", "Choose ‘Advanced security options’", "Turn on ‘Two-step verification’"]
        : ["Open Settings → your name → ‘Sign-In & Security’", "Check ‘Two-Factor Authentication’ is On", "Add a trusted phone number you will keep"],
    action: (platform) => ({ target: "security", path: platform === "android" ? "Settings → Google → Manage your Google Account → Security" : platform === "windows" ? "account.microsoft.com → Security" : "Settings → your name → Sign-In & Security", label: "Where to find it" }),
    unverified: "No app is allowed to read your account's sign-in settings, so Apollo can't check this.",
  },
  {
    id: "sim_pin",
    title: "SIM PIN",
    subtitle: "A PIN on the SIM card so a thief can't use your number elsewhere",
    area: "access",
    platforms: ["android", "ios"],
    owner: "your mobile carrier",
    optional: true,
    recommended: "Higgins recommends a SIM PIN if your banking codes come by text. Use your carrier's default PIN to set your own — three wrong tries locks the SIM.",
    steps: (_r, platform, device) => platform === "ios"
      ? ["Open Settings → Mobile Service (or Cellular) → SIM PIN", "Turn on SIM PIN and enter your carrier's default PIN", "Tap ‘Change PIN’ and choose your own"]
      : device.manufacturer === "samsung"
        ? ["Open Settings → Security and privacy → More security settings → Set up SIM card lock", "Turn on ‘Lock SIM card’ with your carrier's default PIN", "Change it to your own PIN"]
        : ["Open Settings and search for ‘SIM lock’ or ‘SIM card lock’", "Turn on ‘Lock SIM card’ with your carrier's default PIN", "Change it to your own PIN"],
    action: () => ({ target: "security", path: "Settings → Security → SIM card lock", label: "Open security settings" }),
    unverified: "Apps can't read whether a SIM PIN is set.",
  },
  {
    id: "usb_restricted_mode",
    title: "USB accessories when locked",
    subtitle: "Blocking accessories plugged into a locked iPhone",
    area: "access",
    platforms: ["ios"],
    owner: "Apple",
    recommended: "Higgins recommends leaving ‘Accessories’ off under ‘Allow access when locked’, so a locked iPhone only charges from a cable.",
    steps: () => ["Open Settings → Face ID & Passcode", "Scroll to ‘Allow Access When Locked’", "Turn ‘Accessories’ off"],
    action: () => ({ target: "security", path: "Settings → Face ID & Passcode → Allow Access When Locked", label: "Open passcode settings" }),
    unverified: "Apple does not let Apollo read this setting.",
  },
  {
    id: "ios_developer_mode",
    title: "Developer Mode",
    subtitle: "Letting apps from outside the App Store run on this iPhone",
    area: "access",
    platforms: ["ios"],
    minOsMajor: 16,
    owner: "Apple",
    recommended: "Higgins recommends keeping Developer Mode off unless you build apps yourself.",
    steps: () => ["Open Settings → Privacy & Security", "Scroll to the bottom and tap ‘Developer Mode’ (if it isn't listed, it is off)", "Turn it off and restart when asked"],
    action: () => ({ target: "security", path: "Settings → Privacy & Security → Developer Mode", label: "Open privacy settings" }),
    unverified: "Apple does not let Apollo read whether Developer Mode is on.",
  },
  {
    id: "uac",
    title: "User Account Control",
    subtitle: "Windows asking before a program makes system-wide changes",
    area: "access",
    platforms: ["windows"],
    owner: "Windows",
    recommended: "Higgins recommends keeping User Account Control at the default level or higher — never ‘Never notify’.",
    steps: () => ["Open the Start menu and search for ‘User Account Control’", "Open ‘Change User Account Control settings’", "Set the slider to the default (second from the top) or higher"],
    action: () => ({ target: "security", path: "Control Panel → User Accounts → Change User Account Control settings", label: "Where to find it" }),
    unverified: "Apollo could not read the User Account Control level.",
  },
  {
    id: "remote_access",
    title: "Remote access to this computer",
    subtitle: "Remote Desktop, Screen Sharing and Remote Login",
    area: "access",
    platforms: ["windows", "macos"],
    owner: (platform) => osName(platform),
    recommended: "Higgins recommends keeping remote access off unless you use it yourself — and never turning it on because a caller asked you to.",
    steps: (_r, platform) => platform === "windows"
      ? ["Open Settings → System → Remote Desktop", "Turn Remote Desktop off unless you use it", "Open Settings → System → ‘Remote Assistance’ (search for it) and untick ‘Allow Remote Assistance connections’"]
      : ["Open System Settings → General → Sharing", "Turn off ‘Screen Sharing’, ‘Remote Login’ and ‘Remote Management’ unless you use them"],
    action: (platform) => ({ target: "security", path: platform === "windows" ? "Settings → System → Remote Desktop" : "System Settings → General → Sharing", label: "Where to find it" }),
    unverified: "Apollo could not read whether remote access is switched on.",
  },
  {
    id: "auto_login",
    title: "Automatic login",
    subtitle: "Starting straight into your account without a password",
    area: "access",
    platforms: ["macos"],
    owner: "macOS",
    recommended: "Higgins recommends keeping automatic login off so the Mac always asks for your password at startup.",
    steps: () => ["Open System Settings → Users & Groups", "Set ‘Automatically log in as’ to ‘Off’"],
    action: () => ({ target: "security", path: "System Settings → Users & Groups → Automatically log in as", label: "Where to find it" }),
    unverified: "Apollo could not read whether automatic login is on.",
  },

  // ── Apps and elevated privileges ──
  {
    id: "accessibility_apps",
    title: "Apps that can control your screen",
    subtitle: "Accessibility access held by other apps",
    area: "apps",
    platforms: ["android"],
    owner: "Android",
    recommended: "Higgins recommends Accessibility access only for apps you set up yourself for a reason you remember — remove it from anything else.",
    steps: () => ["Open Settings → Accessibility", "Look under ‘Downloaded apps’ or ‘Installed apps’", "Turn off any app you don't recognise or no longer need"],
    action: () => ({ target: "accessibility", path: "Settings → Accessibility → Installed apps", label: "Open Accessibility" }),
    unverified: "Apollo could not read which apps hold Accessibility access.",
    resolve: (read) => {
      const apps = read.accessibilityServices;
      if (!apps) return null;
      return apps.length
        ? { state: "off", health: "review", detail: `${apps.length} other app${apps.length === 1 ? " has" : "s have"} Accessibility access: ${apps.join(", ")}. That's fine for apps you set up yourself.`, attributedTo: "Android" }
        : { state: "as_recommended", detail: "No other app has Accessibility access on this phone.", attributedTo: "Android" };
    },
  },
  {
    id: "notification_readers",
    title: "Apps that can read your notifications",
    subtitle: "Notification access, including message previews and codes",
    area: "privacy",
    platforms: ["android"],
    owner: "Android",
    recommended: "Higgins recommends notification access only for apps that need it — your watch, for example — and removing it from anything you don't recognise.",
    steps: () => ["Open Settings → Apps → Special app access → ‘Notification access’ (Samsung: Settings → Notifications → Advanced settings)", "Turn off any app you don't recognise"],
    action: () => ({ target: "notification_access", path: "Settings → Apps → Special access → Notification access", label: "Open notification access" }),
    unverified: "Apollo could not read which apps can read your notifications.",
    resolve: (read) => {
      const apps = read.notificationListeners?.filter((name) => !/apollo/i.test(name)) ?? null;
      if (!apps) return null;
      return apps.length
        ? { state: "off", health: "review", detail: `${apps.length} other app${apps.length === 1 ? " can" : "s can"} read your notifications: ${apps.join(", ")}.`, attributedTo: "Android" }
        : { state: "as_recommended", detail: "No other app can read your notifications.", attributedTo: "Android" };
    },
  },
  {
    id: "samsung_auto_blocker",
    title: "Auto Blocker",
    subtitle: "Samsung's block on unauthorised installs and USB commands",
    area: "apps",
    platforms: ["android"],
    oems: ["samsung"],
    minOsMajor: 14,
    owner: "Samsung",
    recommended: "Higgins recommends turning Auto Blocker on. You can still install apps from the Play Store and Galaxy Store.",
    steps: () => ["Open Settings → Security and privacy", "Tap ‘Auto Blocker’", "Turn it on"],
    action: () => ({ target: "security", path: "Settings → Security and privacy → Auto Blocker", label: "Open security settings" }),
    unverified: "Samsung does not let Apollo read whether Auto Blocker is on.",
  },
  {
    id: "ransomware_protection",
    title: "Ransomware protection",
    subtitle: "Controlled folder access for your documents and photos",
    area: "apps",
    platforms: ["windows"],
    owner: "Microsoft Defender",
    optional: true,
    recommended: "Higgins suggests Controlled folder access if you keep important files only on this PC. Some older programs may need allowing.",
    steps: () => ["Open Windows Security → Virus & threat protection", "Under ‘Ransomware protection’, tap ‘Manage ransomware protection’", "Turn on ‘Controlled folder access’"],
    action: () => ({ target: "security", path: "Windows Security → Virus & threat protection → Ransomware protection", label: "Where to find it" }),
    unverified: "Apollo could not read whether Controlled folder access is on.",
  },

  // ── Permissions and privacy ──
  {
    id: "permission_review",
    title: "App permissions",
    subtitle: "Which apps can use your camera, microphone, location and contacts",
    area: "privacy",
    platforms: ["android", "ios"],
    owner: (platform) => osName(platform),
    recommended: "Higgins recommends reviewing app permissions every few months and setting location to ‘While using the app’ or less.",
    steps: (_r, platform) => platform === "ios"
      ? ["Open Settings → Privacy & Security", "Go through Location Services, Camera, Microphone, Contacts and Photos", "Turn off anything an app doesn't need"]
      : ["Open Settings → Security and privacy → Privacy → ‘Permission manager’ (or Settings → Apps → Permissions)", "Check Location, Camera, Microphone, Contacts and SMS", "Change anything an app doesn't need to ‘Don't allow’ or ‘Only while using’"],
    action: (platform) => ({ target: platform === "ios" ? "security" : "apps", path: platform === "ios" ? "Settings → Privacy & Security" : "Settings → Privacy → Permission manager", label: "Open permissions" }),
    unverified: "Your device doesn't let Apollo read every app's permissions, so please review them yourself.",
  },
  {
    id: "lock_screen_privacy",
    title: "Notification previews on the lock screen",
    subtitle: "Whether codes and messages show before the device is unlocked",
    area: "privacy",
    platforms: ["android", "ios"],
    owner: (platform) => osName(platform),
    recommended: "Higgins recommends hiding notification content on the lock screen, so one-time codes only show once the device is unlocked.",
    steps: (_r, platform) => platform === "ios"
      ? ["Open Settings → Notifications", "Tap ‘Show Previews’", "Choose ‘When Unlocked’"]
      : ["Open Settings → Notifications → ‘Notifications on lock screen’ (Samsung: Settings → Lock screen and AOD → Notifications)", "Choose ‘Hide sensitive content’ or ‘Icons only’"],
    action: () => ({ target: "security", path: "Settings → Notifications → Lock screen", label: "Open notification settings" }),
    unverified: "Apollo can't read your lock screen notification setting.",
  },
  {
    id: "app_tracking",
    title: "App tracking requests",
    subtitle: "Apps asking to follow you across other apps and websites",
    area: "privacy",
    platforms: ["ios"],
    owner: "Apple",
    recommended: "Higgins recommends turning off ‘Allow Apps to Request to Track’ unless you want personalised ads.",
    steps: () => ["Open Settings → Privacy & Security → Tracking", "Turn off ‘Allow Apps to Request to Track’"],
    action: () => ({ target: "security", path: "Settings → Privacy & Security → Tracking", label: "Open privacy settings" }),
    unverified: "Apple does not let Apollo read this setting.",
  },
  {
    id: "safety_check",
    title: "Safety Check",
    subtitle: "Reviewing who you share your location and data with",
    area: "privacy",
    platforms: ["ios"],
    minOsMajor: 16,
    owner: "Apple",
    optional: true,
    recommended: "Higgins suggests running Safety Check if you're worried someone you know can see your location or data.",
    steps: () => ["Open Settings → Privacy & Security → Safety Check", "Choose ‘Manage Sharing & Access’ to review, or ‘Emergency Reset’ to stop all sharing at once"],
    action: () => ({ target: "security", path: "Settings → Privacy & Security → Safety Check", label: "Open Safety Check" }),
    unverified: "This is a review only you can do.",
  },
  {
    id: "advanced_data_protection",
    title: "Advanced Data Protection",
    subtitle: "End-to-end encryption for most of your iCloud data",
    area: "privacy",
    platforms: ["ios", "macos"],
    owner: "Apple",
    optional: true,
    recommended: "Higgins suggests it if you want the strongest protection for iCloud — set up a recovery contact or key first, because Apple can't help you recover.",
    steps: (_r, platform) => [platform === "macos" ? "Open System Settings → your name → iCloud" : "Open Settings → your name → iCloud", "Tap ‘Advanced Data Protection’", "Set up account recovery, then turn it on"],
    action: (platform) => ({ target: "security", path: platform === "macos" ? "System Settings → your name → iCloud → Advanced Data Protection" : "Settings → your name → iCloud → Advanced Data Protection", label: "Where to find it" }),
    unverified: "Apple does not let Apollo read this setting.",
  },

  // ── Browser, web and network ──
  {
    id: "other_vpn",
    title: "Another VPN on this phone",
    subtitle: "Whether a different VPN app is routing your traffic",
    area: "web",
    platforms: ["android"],
    owner: "Android",
    recommended: "Higgins recommends only running a VPN you chose yourself and recognise.",
    steps: () => ["Open Settings → Network & internet → VPN (Samsung: Settings → Connections → More connection settings → VPN)", "Check which VPN is connected", "Remove any you didn't set up"],
    action: () => ({ target: "vpn", path: "Settings → Network & internet → VPN", label: "Open VPN settings" }),
    unverified: "Apollo could not read whether another VPN is running.",
    resolve: (read) => {
      if (read.otherVpnActive === null) return null;
      return read.otherVpnActive
        ? { state: "off", health: "review", detail: "Another VPN app is routing this phone's traffic. That's fine if you set it up yourself.", attributedTo: "Android" }
        : { state: "as_recommended", detail: "No other VPN app is running on this phone.", attributedTo: "Android" };
    },
  },
  {
    id: "smartscreen",
    title: "Reputation-based protection",
    subtitle: "SmartScreen warnings before unrecognised apps and sites",
    area: "web",
    platforms: ["windows"],
    owner: "Microsoft Defender",
    recommended: "Higgins recommends keeping every reputation-based protection switch on, including ‘Check apps and files’ and ‘SmartScreen for Microsoft Edge’.",
    steps: () => ["Open Windows Security → App & browser control", "Tap ‘Reputation-based protection settings’", "Turn on every switch on the page"],
    action: () => ({ target: "security", path: "Windows Security → App & browser control → Reputation-based protection", label: "Where to find it" }),
    unverified: "Apollo could not read your SmartScreen settings.",
  },

  // ── Anti-theft ──
  {
    id: "theft_protection",
    title: "Theft protection",
    subtitle: "Locking the screen if the phone is snatched or kept offline",
    area: "recovery",
    platforms: ["android"],
    minOsMajor: 10,
    owner: "Google",
    recommended: "Higgins recommends turning on Theft Detection Lock and Offline Device Lock where your phone offers them.",
    steps: (_r, _p, device) => device.manufacturer === "samsung"
      ? ["Open Settings → Security and privacy → ‘Lost device protection’", "Tap ‘Theft protection’", "Turn on ‘Theft Detection Lock’ and ‘Offline Device Lock’"]
      : ["Open Settings → Google → All services → ‘Theft protection’ (or search Settings for ‘Theft’)", "Turn on ‘Theft Detection Lock’", "Turn on ‘Offline Device Lock’"],
    action: () => ({ target: "security", path: "Settings → Google → Theft protection", label: "Open security settings" }),
    unverified: "Android does not let Apollo read the theft protection switches.",
  },
  {
    id: "stolen_device_protection",
    title: "Stolen Device Protection",
    subtitle: "Face ID needed for sensitive changes away from familiar places",
    area: "recovery",
    platforms: ["ios"],
    minOsMajor: 17,
    owner: "Apple",
    recommended: "Higgins recommends turning Stolen Device Protection on, set to ‘Always’ for the strongest cover.",
    steps: () => ["Open Settings → Face ID & Passcode", "Tap ‘Stolen Device Protection’", "Turn it on and set ‘Require Security Delay’ to ‘Always’"],
    action: () => ({ target: "security", path: "Settings → Face ID & Passcode → Stolen Device Protection", label: "Open passcode settings" }),
    unverified: "Apple does not let Apollo read whether this is on.",
  },
];

// ────────────────────────────────────────────────────────────────────
// Resolution
// ────────────────────────────────────────────────────────────────────

function ownerOf(def: SecurityDef, platform: CapabilityPlatform): string {
  return typeof def.owner === "function" ? def.owner(platform) : def.owner;
}

function guidance(def: SecurityDef, read: SecurityStateRead, platform: CapabilityPlatform, device: DeviceFacts, selfCheck: boolean): ProtectionGuidance {
  return { recommended: def.recommended, steps: def.steps(read, platform, device), action: def.action?.(platform), selfCheck };
}

function toRow(def: SecurityDef, read: SecurityStateRead, platform: CapabilityPlatform, device: DeviceFacts, resolved: Resolved, attributedTo: string): DeviceProtectionRow {
  const health = healthFor(resolved.state, resolved.health);
  return {
    id: def.id,
    title: def.title,
    subtitle: def.subtitle,
    kind: "device",
    area: def.area,
    state: resolved.state,
    health,
    evidence: evidenceFor(resolved.state),
    stateLabel: healthLabel(resolved.state, health),
    detail: resolved.detail,
    attributedTo,
    optional: def.optional,
    guidance: guidance(def, read, platform, device, resolved.state === "not_verifiable" || resolved.state === "not_readable_here"),
  };
}

const osMajor = (version: string | null): number | null => {
  const match = /^\s*(\d{1,3})/.exec(version ?? "");
  return match ? Number(match[1]) : null;
};

/** Whether this protection exists on this device: its OS, its maker (when maker-specific) and its OS version. */
function appliesTo(def: SecurityDef, platform: CapabilityPlatform, device: DeviceFacts): boolean {
  if (!def.platforms.includes(platform)) return false;
  if (def.oems && !(device.manufacturer && def.oems.includes(device.manufacturer.toLowerCase()))) return false;
  if (def.countries && !(device.country && def.countries.includes(device.country.toUpperCase()))) return false;
  const major = osMajor(device.osVersion);
  return !(def.minOsMajor && major !== null && major < def.minOsMajor);
}

/**
 * Every protection this device has — its OS, maker and OS version — resolved against the real reads.
 *
 * A read that answered produces a state. Everything else produces `not_verifiable` ("Check manually")
 * with the honest sentence and full instructions — guidance is never withheld because Apollo can't see.
 */
export function securityProtectionRows(
  platform: CapabilityPlatform,
  read: SecurityStateRead,
  now: number,
  device: DeviceFacts = UNKNOWN_DEVICE,
): DeviceProtectionRow[] {
  return CATALOGUE.filter((def) => appliesTo(def, platform, device)).map((def) => {
    const resolved = def.resolve?.(read, now, platform) ?? { state: "not_verifiable" as const, detail: `${def.unverified} Please check it yourself — Higgins has the steps.` };
    return toRow(def, read, platform, device, resolved, resolved.attributedTo ?? ownerOf(def, platform));
  });
}

/**
 * The whole catalogue, for a host that is not the device itself (a browser preview).
 *
 * Nothing here was read, so every row says exactly that ("Unable to check"). The wording, the
 * recommended configuration and the steps are all still readable — never a state Apollo didn't read.
 */
export function previewProtectionRows(read: SecurityStateRead = EMPTY_SECURITY_READ): DeviceProtectionRow[] {
  return CATALOGUE.map((def) => {
    const platform: CapabilityPlatform = def.platforms[0];
    const where = def.platforms.map((p) => osName(p)).join(", ");
    return toRow(
      def, read, platform, UNKNOWN_DEVICE,
      { state: "not_readable_here", detail: `ApolloSG is not running on the device itself here, so it could not read this. On ${where}, open ApolloSG on the device to see the real state.` },
      ownerOf(def, platform),
    );
  });
}

/** Ids in catalogue order — used by tests and by the report to keep a stable order. */
export function securityCatalogueIds(platform: CapabilityPlatform): string[] {
  return CATALOGUE.filter((def) => def.platforms.includes(platform)).map((def) => def.id);
}
