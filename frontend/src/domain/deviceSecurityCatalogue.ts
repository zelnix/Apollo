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
  PROTECTION_STATE_LABEL,
  type CapabilityAction, type CapabilityPlatform, type DeviceProtectionRow,
  type DeviceProtectionState, type ProtectionArea, type ProtectionGuidance,
} from "./deviceProtectionTypes.ts";

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
  /** The OS's own scanner, e.g. Google Play Protect or Microsoft Defender. */
  osThreatReport: { source: string; status: string; protectionOff?: boolean | null } | null;
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
  userCertificateCount: null, rootIndicators: null, privateDnsActive: null, osThreatReport: null,
  firewallEnabled: null, osUpdatesCurrent: null, antivirusEnabled: null, systemProtections: null,
  defaultDialerPackage: null, defaultSmsPackage: null,
};

interface Resolved {
  state: DeviceProtectionState;
  detail: string;
  /** Overrides the entry's owner when the read itself names who answered. */
  attributedTo?: string;
}

interface SecurityDef {
  id: string;
  title: string;
  subtitle: string;
  area: ProtectionArea;
  platforms: CapabilityPlatform[];
  /** Who owns this protection when no read names someone more specific. */
  owner: string | ((platform: CapabilityPlatform) => string);
  what: string;
  benefit: string;
  /** The configuration Higgins recommends. Never phrased as if Apollo knows the current one. */
  recommended: string;
  steps: (read: SecurityStateRead, platform: CapabilityPlatform) => string[];
  action: (platform: CapabilityPlatform) => CapabilityAction;
  /** Apollo's honest line when nothing could read this. */
  unverified: string;
  /** Returns a state only when a real read answered. `null` → "Apollo can't verify this". */
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
    what: "The code or fingerprint your device asks for before it will unlock, and how quickly it locks itself when you walk away.",
    benefit: "A lot of scams end with someone holding your device — a “courier” who collects it, a stranger who borrows it, a thief. A lock screen is the one setting that keeps your banking, email and codes out of their hands.",
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
    what: "A hidden menu for app developers. USB debugging inside it lets a connected computer read and control the phone.",
    benefit: "Scammers sometimes talk people through turning this on, because it hands a plugged-in computer far more control than any app would get. If you don’t build apps, it should be off.",
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
      return { state: "off", detail: `Developer options are on.${usb} If you did not turn this on yourself, turn it off.`, attributedTo: "Android" };
    },
  },
  {
    id: "user_certificates",
    title: "Certificates you have installed",
    subtitle: "Extra trust certificates added to this device",
    area: "access",
    platforms: ["android"],
    owner: "Android",
    what: "Security certificates added by hand rather than shipped with the device. They tell it to trust someone it otherwise wouldn’t.",
    benefit: "One of these can let somebody read traffic that should be private, including what you send your bank. They are occasionally installed for work — and occasionally talked onto a phone during a scam.",
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
        : { state: "off", detail: `${count} hand-installed certificate${count === 1 ? " is" : "s are"} on this device. If your employer set this up, that is expected. If not, remove it.`, attributedTo: "Android" };
    },
  },
  {
    id: "lockdown_mode",
    title: "Lockdown Mode",
    subtitle: "Apple’s extreme protection for people who are personally targeted",
    area: "access",
    platforms: ["ios", "macos"],
    owner: "Apple",
    what: "A mode that switches off many everyday features — most message attachments, some web technology, unknown FaceTime calls — to shrink what an attacker can reach.",
    benefit: "It is powerful, and it is not for everyday scam protection. Higgins only suggests it if you have reason to believe you are being targeted personally.",
    recommended: "Higgins recommends leaving this off unless you believe you are being personally targeted. Read what it switches off before you turn it on.",
    steps: (_r, platform) => platform === "macos"
      ? ["Open System Settings → Privacy & Security", "Scroll to ‘Lockdown Mode’", "Read what it switches off before deciding"]
      : ["Open Settings → Privacy & Security", "Scroll to ‘Lockdown Mode’", "Read what it switches off before deciding"],
    action: (platform) => ({ target: "security", path: platform === "macos" ? "System Settings → Privacy & Security → Lockdown Mode" : "Settings → Privacy & Security → Lockdown Mode", label: "Read about Lockdown Mode" }),
    unverified: "Apple does not let Apollo read this setting, so Apollo cannot tell whether it is on.",
  },

  // ── Apps on this device ───────────────────────────────────────────
  {
    id: "app_scanner",
    title: "App scanning",
    subtitle: "Your device’s own check of the apps you install",
    area: "apps",
    platforms: ["android"],
    owner: "Google Play Protect",
    what: "The scan your phone runs over an app before you install it and again afterwards — Play Protect on most Android phones.",
    benefit: "It covers ground Apollo cannot reach: the app’s code itself. If a scammer talks you into installing something, this is the check most likely to stop it before Apollo ever sees it.",
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
    what: "The scanner watching files and programs as they arrive and run — Microsoft Defender on Windows, or whichever security product you installed.",
    benefit: "Remote-access scams usually end with a file being downloaded and run. This is the layer that catches a known-bad one before it executes.",
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
    what: "The permission that lets an app install other apps, bypassing the app store’s checks.",
    benefit: "“Download this app so I can help you” is the backbone of remote-access scams. With side-loading off, that attempt stops at the first step.",
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
        ? { state: "off", detail: "Apollo itself is allowed to install apps on this phone. Android only lets Apollo read its own setting, so check the others in the list too.", attributedTo: "Android" }
        : { state: "as_recommended", detail: "Apollo is not allowed to install apps on this phone. Android only lets Apollo read its own setting, so check the others in the list too.", attributedTo: "Android" };
    },
  },
  {
    id: "device_admin_apps",
    title: "Apps with device-admin control",
    subtitle: "Apps allowed to lock, wipe or police this device",
    area: "apps",
    platforms: ["android", "ios"],
    owner: (platform) => osName(platform),
    what: "Apps you have given administrator rights to. Find My Device and work software use this legitimately.",
    benefit: "An administrator app can lock you out, wipe the device, or stop you uninstalling it. One you don’t recognise is one of the most serious things that can be on a device.",
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
      return { state: "off", detail: `${admins.length} app${admins.length === 1 ? "" : "s"} hold device-admin rights: ${admins.join(", ")}. Find My Device and work software are normal here. Anything else is worth removing.`, attributedTo: osName(platform) };
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
    what: "The red warning page your browser shows when a link leads somewhere known to be dangerous.",
    benefit: "Most scam texts and emails end in a link. Apollo checks links you give it, and this catches the ones you click without thinking — two different nets over the same risk.",
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
    what: "A setting that encrypts the “which address is this website?” lookups your phone makes, so they can’t be read or redirected on the network you are using.",
    benefit: "On a hotel or café network, an unencrypted lookup can be pointed at a fake banking site. Private DNS closes that door, and a filtering provider can block known scam domains outright.",
    recommended: "Higgins recommends setting Private DNS to ‘Automatic’ at minimum. Apollo’s own protection filters on this phone, so a strict Private DNS hostname can sit alongside it.",
    steps: () => [
      "Open Settings → Network & internet → ‘Private DNS’",
      "Choose ‘Automatic’, or ‘Private DNS provider hostname’ if you use a filtering service",
      "Save, then reopen the screen to confirm it stuck",
    ],
    action: () => ({ target: "security", path: "Settings → Network & internet → Private DNS", label: "Open network settings" }),
    unverified: "Apollo could not read this phone’s Private DNS setting.",
    resolve: (read) => {
      if (read.privateDnsActive === null) return null;
      return read.privateDnsActive
        ? { state: "active", detail: "Private DNS is active on this phone, so your website lookups are encrypted.", attributedTo: "Android" }
        : { state: "off", detail: "Private DNS is not active, so this phone’s website lookups can be read, and in some cases redirected, by the network you are on.", attributedTo: "Android" };
    },
  },
  {
    id: "firewall",
    title: "Firewall",
    subtitle: "Screening connections coming into this computer",
    area: "web",
    platforms: ["windows", "macos"],
    owner: (platform) => platform === "windows" ? "Windows" : "macOS",
    what: "The screen that decides which incoming connections from the network are allowed to reach this computer.",
    benefit: "On a shared or public network, a firewall is what stops another machine reaching services on yours. It is also commonly switched off during a “support” call.",
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
    what: "The security fixes your device’s maker publishes, and whether this device has them.",
    benefit: "Scam links and malicious files lean on holes that were fixed months ago. An up-to-date device simply isn’t vulnerable to most of them.",
    recommended: "Higgins recommends installing security updates as soon as they appear, and turning on automatic updates so you don’t have to remember.",
    steps: (_r, platform) => platform === "windows"
      ? ["Open Settings → Windows Update", "Click ‘Check for updates’ and install everything offered", "Open ‘Advanced options’ and turn on ‘Receive updates for other Microsoft products’", "Restart when it asks — the fix isn’t applied until you do"]
      : platform === "macos"
        ? ["Open System Settings → General → Software Update", "Install anything offered", "Click the ⓘ beside ‘Automatic updates’ and turn on security responses and system files", "Restart when it asks"]
        : platform === "ios"
          ? ["Open Settings → General → Software Update", "Install anything offered", "Tap ‘Automatic Updates’ and turn on ‘Security Responses & System Files’"]
          : ["Open Settings → Software update (on some phones: Settings → System → System update)", "Tap ‘Download and install’ or ‘Check for updates’", "Install anything offered, including Google Play system updates", "Turn on automatic updates if your phone offers it"],
    action: (platform) => ({ target: "security", path: platform === "windows" ? "Settings → Windows Update" : platform === "macos" ? "System Settings → General → Software Update" : platform === "ios" ? "Settings → General → Software Update" : "Settings → Software update", label: isDesktop(platform) ? "Where to find it" : "Open update settings" }),
    unverified: "Apollo cannot tell whether an update is waiting for this device.",
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
        return { state: "active", detail: `This device’s security patch is dated ${read.securityPatch} — about ${months <= 1 ? "a month" : `${months} months`} old, which is current. Apollo cannot tell whether a newer one is waiting, so it is still worth checking.` };
      }
      return { state: "out_of_date", detail: `This device’s security patch is dated ${read.securityPatch} — about ${months} months old. That is behind, and the fixes released since then are not on this device.` };
    },
  },
  {
    id: "system_integrity",
    title: "System protection",
    subtitle: "Whether this device’s built-in protections are intact",
    area: "updates",
    platforms: ["android", "ios", "windows", "macos"],
    owner: "your device",
    what: isDesktopDoc(),
    benefit: "On a device whose protections have been switched off or bypassed, every other protection on this list can be walked around. Knowing it is intact is the floor everything else stands on.",
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
        ? { state: "off", detail: `Apollo found ${indicators.length} sign${indicators.length === 1 ? "" : "s"} that this device may be rooted or jailbroken. These are indicators, not proof — but they are worth understanding.`, attributedTo: "Apollo" }
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
    what: "The “Suspected spam” label your phone app can put on a call as it comes in.",
    benefit: "It gives you the one thing a scam call needs to take from you: a moment to think before you pick up.",
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
    what: "Your messaging app’s own filter for suspected spam and dangerous links.",
    benefit: "It keeps a scam text from sitting in the same list as a real message from your bank, which is exactly the confusion these messages rely on.",
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
    what: "An iPhone setting that sends calls from numbers not in your contacts straight to voicemail.",
    benefit: "Nearly every scam call comes from a number you have never saved. This removes the ringing phone, and with it the pressure to answer.",
    recommended: "Higgins recommends turning this on if you rarely get calls from new numbers. If you are expecting a delivery or a clinic, turn it off for the day.",
    steps: () => ["Open Settings → Apps → Phone", "Tap ‘Silence Unknown Callers’", "Turn it on"],
    action: () => ({ target: "apps", path: "Settings → Apps → Phone → Silence Unknown Callers", label: "Check Silence Unknown Callers" }),
    unverified: "Apple does not let Apollo read this setting, so Apollo cannot tell whether it is on.",
  },
  {
    id: "filter_unknown_senders",
    title: "Filter Unknown Senders",
    subtitle: "Texts from people not in your contacts are sorted away",
    area: "calls_messages",
    platforms: ["ios"],
    owner: "Apple",
    what: "An iPhone setting that files messages from unknown senders into a separate list.",
    benefit: "A scam text stops appearing next to the real message from your bank, which is what makes these messages work in the first place.",
    recommended: "Higgins recommends turning this on, and checking the ‘Unknown Senders’ list now and then for anything genuine.",
    steps: () => ["Open Settings → Apps → Messages", "Tap ‘Unknown & Spam’", "Turn on ‘Filter Unknown Senders’"],
    action: () => ({ target: "apps", path: "Settings → Apps → Messages → Unknown & Spam", label: "Check message filtering" }),
    unverified: "Apple does not let Apollo read this setting, so Apollo cannot tell whether it is on.",
  },

  // ── If it is lost or stolen ───────────────────────────────────────
  {
    id: "find_my_device",
    title: "Find My Device",
    subtitle: "Locking or wiping this device if it is lost or taken",
    area: "recovery",
    platforms: ["android", "ios", "windows", "macos"],
    owner: "your device’s maker",
    what: "The service that lets you find this device on a map, lock it, or erase it from somewhere else.",
    benefit: "If it goes missing, this is the difference between losing a device and losing your accounts. It also lets you lock it the moment you realise something is wrong.",
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
    what: "Encryption of the whole drive — BitLocker on Windows, FileVault on a Mac — so the files can’t be read by taking the drive out.",
    benefit: "Without it, a password is only a locked front door on an unlocked safe: anyone with the machine can read your files. With it, a lost laptop is a lost laptop, not a data breach.",
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
];

/** `what` for System protection reads differently per platform, so it is resolved at row time. */
function isDesktopDoc(): string {
  return "Whether the protections your device shipped with are still intact — root/jailbreak on a phone, and System Integrity Protection, Gatekeeper or tamper protection on a computer.";
}

// ────────────────────────────────────────────────────────────────────
// Resolution
// ────────────────────────────────────────────────────────────────────

function ownerOf(def: SecurityDef, platform: CapabilityPlatform): string {
  return typeof def.owner === "function" ? def.owner(platform) : def.owner;
}

function guidance(def: SecurityDef, read: SecurityStateRead, platform: CapabilityPlatform, selfCheck: boolean): ProtectionGuidance {
  return { recommended: def.recommended, steps: def.steps(read, platform), action: def.action(platform), selfCheck };
}

function toRow(def: SecurityDef, read: SecurityStateRead, platform: CapabilityPlatform, state: DeviceProtectionState, detail: string, attributedTo: string): DeviceProtectionRow {
  return {
    id: def.id,
    title: def.title,
    subtitle: def.subtitle,
    kind: "device",
    area: def.area,
    state,
    stateLabel: PROTECTION_STATE_LABEL[state],
    detail,
    attributedTo,
    what: def.what,
    benefit: def.benefit,
    guidance: guidance(def, read, platform, state === "not_verifiable" || state === "not_readable_here"),
  };
}

/**
 * Every protection this platform has, resolved against the real reads.
 *
 * A read that answered produces a state. Everything else produces `not_verifiable` with the honest
 * sentence and full instructions — guidance is never withheld just because Apollo cannot see.
 */
export function securityProtectionRows(
  platform: CapabilityPlatform,
  read: SecurityStateRead,
  now: number,
): DeviceProtectionRow[] {
  return CATALOGUE.filter((def) => def.platforms.includes(platform)).map((def) => {
    const resolved = def.resolve?.(read, now, platform) ?? null;
    const state: DeviceProtectionState = resolved?.state ?? "not_verifiable";
    const detail = resolved?.detail ?? `${def.unverified} It is still worth checking — Higgins has the steps.`;
    return toRow(def, read, platform, state, detail, resolved?.attributedTo ?? ownerOf(def, platform));
  });
}

/**
 * The whole catalogue, for a host that is not the device itself (a browser preview).
 *
 * Nothing here was read, so every row says exactly that. The wording, the recommended configuration
 * and the steps are all still readable — the person simply cannot be told a state Apollo never read.
 */
export function previewProtectionRows(read: SecurityStateRead = EMPTY_SECURITY_READ): DeviceProtectionRow[] {
  return CATALOGUE.map((def) => {
    const platform: CapabilityPlatform = def.platforms[0];
    const where = def.platforms.map((p) => osName(p)).join(", ");
    return toRow(
      def, read, platform, "not_readable_here",
      `Apollo is not running on the device itself here, so it could not read this. On ${where}, open Apollo on the device to see the real state.`,
      ownerOf(def, platform),
    );
  });
}

/** Ids in catalogue order — used by tests and by the report to keep a stable order. */
export function securityCatalogueIds(platform: CapabilityPlatform): string[] {
  return CATALOGUE.filter((def) => def.platforms.includes(platform)).map((def) => def.id);
}
