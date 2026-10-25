// Higgins First Check — Apollo's onboarding malware/virus/compromise BASELINE assessment, plus the
// manual "Device Re-check". This is NOT an antivirus engine and NOT a background scanner: it is a
// point-in-time, capability-based reading of the security signals each platform legitimately exposes
// (Android, iPhone/iPad, Windows, macOS, web preview). Pure and unit-tested; the collector
// (firstCheckSignals.ts) gathers the inputs, the UI reports the result — neither invents a finding.
//
// Evidence rules:
//  • Trusted deterministic OS threat evidence (Play Protect / Defender) → may be CONFIRMED_THREAT.
//  • Heuristics (root files, powerful access, odd VPN) → CAUTION or SUSPICIOUS, never confirmed malware.
//  • Unsupported → NOT_AVAILABLE, never PASS.  Failed execution → ERROR.
//  • CLEAR only when enough meaningful checks actually executed.

import type { DevicePlatform, DeviceSignals, OsThreatReportSignal } from "./deviceAnalysis";
import type { NetworkStatus, RuleBundleStatus } from "@/src/security/SecurityPlatformAdapter";

export type FirstCheckResultState =
  | "PASS" | "INFORMATION" | "CAUTION" | "SUSPICIOUS" | "CONFIRMED_THREAT" | "NOT_AVAILABLE" | "ERROR";

export type FirstCheckOverall = "CLEAR" | "ATTENTION" | "HIGH_RISK" | "CONFIRMED_THREAT" | "LIMITED_CHECK" | "ERROR";

export type FirstCheckCategory = "os_threat" | "device_integrity" | "application_risk" | "network_config" | "apollo_integrity" | "os_security" | "connection";
export type FirstCheckConfidence = "low" | "medium" | "high";
export type FirstCheckSeverity = "none" | "info" | "low" | "medium" | "high";

export interface FirstCheckCapabilityResult {
  id: string;
  category: FirstCheckCategory;
  title: string;
  /** Can the platform legitimately perform this check at all? */
  supported: boolean;
  /** Did the check actually run (false when unsupported or it errored)? */
  executed: boolean;
  result: FirstCheckResultState;
  confidence: FirstCheckConfidence;
  severity: FirstCheckSeverity;
  /** Local, non-sensitive reference backing the finding (e.g. a signal name). */
  evidenceRef: string | null;
  /** Plain-English summary of what was actually observed (null when nothing was observed). */
  evidence?: string | null;
  /** Plain-English explanation, Higgins' voice. */
  explanation: string;
  /** Why a signal could not be inspected on this platform/build (null when it was). */
  platformLimitation: string | null;
  /** The one thing to do when the result needs action (null otherwise). */
  action?: string | null;
}

export interface FirstCheckInputs {
  platform: DevicePlatform;
  nativeHost: boolean;
  signals: DeviceSignals;
  deviceFacts: { osVersion: string | null; manufacturer: string | null; model: string | null } | null;
  protection: { requested: boolean; operational: boolean; enforcementMethod: string; adapterLabel: string } | null;
  /** Always supplied by the platform adapter — an explicit NOT_AVAILABLE when the OS offers no trusted report. */
  osReportedThreat: OsThreatReportSignal;
  /** Live connection reading, or null when Apollo could not read it. */
  connection?: NetworkStatus | null;
  /** Security-rule state, or null when this platform cannot report it. */
  ruleBundle?: RuleBundleStatus | null;
}

export interface FirstCheckReport {
  overall: FirstCheckOverall;
  platform: DevicePlatform;
  checkedAt: string;
  checks: FirstCheckCapabilityResult[];
  concerns: string[];
  unavailable: string[];
  /** Higgins' explanation of what this platform lets Apollo check, compared with other platforms. */
  capabilityNote?: string;
  signals: DeviceSignals;
}

const CONCERN_STATES: FirstCheckResultState[] = ["CAUTION", "SUSPICIOUS", "CONFIRMED_THREAT"];
const MEANINGFUL_CATEGORIES: FirstCheckCategory[] = ["os_threat", "device_integrity", "application_risk", "network_config"];

export const platformName = (p: DevicePlatform) => (p === "ios" ? "iPhone or iPad" : p === "android" ? "Android device" : p === "windows" ? "Windows PC" : p === "macos" ? "Mac" : "device");

type Row = FirstCheckCapabilityResult;
const notAvailable = (base: Pick<Row, "id" | "category" | "title">, explanation: string, platformLimitation: string): Row =>
  ({ ...base, supported: false, executed: false, result: "NOT_AVAILABLE", confidence: "low", severity: "none", evidenceRef: null, evidence: null, explanation, platformLimitation, action: null });
const PREVIEW_LIMIT = "This preview (Expo Go or web) can't reach the device's security system. Install the ApolloSG app on the device for this check.";

/** Platform default when the adapter has no trusted OS threat report to offer — explicit, never null. */
export function osThreatNotAvailable(platform: DevicePlatform, nativeHost: boolean): OsThreatReportSignal {
  const detail = !nativeHost ? PREVIEW_LIMIT
    : platform === "ios" ? "Apple doesn't let apps read malware or threat reports from iOS or iPadOS."
    : platform === "macos" ? "macOS doesn't share XProtect malware detections with apps."
    : platform === "android" ? "Google Play Protect's scan results couldn't be read on this device (Google Play services may be missing)."
    : platform === "windows" ? "Microsoft Defender's threat report couldn't be read — another antivirus may be in charge."
    : "This platform has no operating-system threat report Apollo can read.";
  return { status: "not_available", source: "Operating system", detail, threats: [], protectionOff: null };
}

// --- Individual checks -------------------------------------------------------------------------------

function osThreatCheck(i: FirstCheckInputs): Row {
  const t = i.osReportedThreat;
  const base = { id: "os_reported_threat", category: "os_threat" as const, title: "Operating-system malware report" };
  if (t.status === "reported") {
    const list = t.threats.length ? t.threats.join(", ") : t.detail;
    return { ...base, supported: true, executed: true, result: "CONFIRMED_THREAT", confidence: "high", severity: "high", evidenceRef: "os:threat_report",
      evidence: `${t.source} reported: ${list}`,
      explanation: `${t.source} — the operating system's own malware protection — is reporting ${t.threats.length > 1 ? `${t.threats.length} threats` : "a threat"} on this device.`,
      platformLimitation: null,
      action: i.platform === "windows" ? "Open Windows Security → Virus & threat protection and remove or quarantine the threat." : "Open Google Play Protect and uninstall the flagged app." };
  }
  if (t.status === "error") {
    return { ...base, supported: true, executed: false, result: "ERROR", confidence: "low", severity: "low", evidenceRef: null, evidence: null,
      explanation: `Higgins asked ${t.source} for its threat report but it didn't answer. ${t.detail}`, platformLimitation: null, action: "Run the Re-check again in a moment." };
  }
  if (t.status === "not_available") {
    if (t.protectionOff) {
      return { ...base, supported: true, executed: true, result: "CAUTION", confidence: "high", severity: "medium", evidenceRef: "os:scanner_off",
        evidence: `${t.source} is switched off.`, explanation: `${t.source} is turned off, so the device's built-in malware scanning isn't running and there's no threat report to read.`,
        platformLimitation: null, action: i.platform === "windows" ? "Turn on Real-time protection in Windows Security → Virus & threat protection." : "Turn on 'Scan apps with Play Protect' in Google Play → Play Protect." };
    }
    return notAvailable(base, `Higgins couldn't read a malware report from the operating system on this ${platformName(i.platform)}.`, t.detail);
  }
  return { ...base, supported: true, executed: true, result: "PASS", confidence: "high", severity: "none", evidenceRef: "os:threat_report",
    evidence: `${t.source}: ${t.detail}`, explanation: `${t.source} reports no active threats on this device.`, platformLimitation: null, action: null };
}

function deviceIntegrityCheck(i: FirstCheckInputs): Row {
  const base = { id: "device_integrity", category: "device_integrity" as const, title: i.platform === "ios" ? "Jailbreak and system modification" : i.platform === "android" ? "Root and system modification" : "System integrity protections" };
  const s = i.signals.systemIntegrity;
  if (!i.nativeHost || !s) {
    return notAvailable(base, `Higgins couldn't read system-integrity signals on this ${platformName(i.platform)}, so it can't confirm or rule out system modification.`,
      !i.nativeHost ? PREVIEW_LIMIT : "This build doesn't expose system-integrity signals.");
  }
  const off = s.protections.filter((p) => p.enabled === false).map((p) => p.name);
  const on = s.protections.filter((p) => p.enabled === true).map((p) => p.name);
  const checkedText = [...s.checked, ...s.protections.map((p) => p.name)].join(", ");
  if (s.indicators.length) {
    return { ...base, supported: true, executed: true, result: "SUSPICIOUS", confidence: "medium", severity: "medium", evidenceRef: "signals:integrity",
      evidence: `Found: ${s.indicators.join("; ")}`,
      explanation: `Higgins found signs this ${platformName(i.platform)} has been ${i.platform === "ios" ? "jailbroken" : i.platform === "android" ? "rooted" : "modified"}. That isn't proof of malware, but it removes protections the operating system normally guarantees.`,
      platformLimitation: null, action: "If you didn't modify this device yourself, back up your data and restore the official system software." };
  }
  if (off.length) {
    return { ...base, supported: true, executed: true, result: "CAUTION", confidence: "high", severity: "medium", evidenceRef: "signals:integrity",
      evidence: `Turned off: ${off.join(", ")}${on.length ? `. On: ${on.join(", ")}` : ""}`,
      explanation: `${off.join(" and ")} ${off.length > 1 ? "are" : "is"} turned off. This weakens the system's built-in protection against malware — it isn't a sign of infection by itself.`,
      platformLimitation: null, action: `Turn ${off.join(" and ")} back on unless you deliberately turned ${off.length > 1 ? "them" : "it"} off.` };
  }
  return { ...base, supported: true, executed: true, result: "PASS", confidence: "medium", severity: "none", evidenceRef: "signals:integrity",
    evidence: `Checked: ${checkedText}`, explanation: "Higgins found no signs of system modification, and the system protections it could read are on.",
    platformLimitation: i.platform === "ios" ? "iOS only allows basic jailbreak checks; a well-hidden jailbreak may not be visible." : i.platform === "android" ? "Root checks are heuristic; a well-hidden root may not be visible." : null, action: null };
}

function applicationRiskCheck(i: FirstCheckInputs): Row {
  const base = { id: "application_risk", category: "application_risk" as const, title: "Installed apps and powerful access" };
  if (i.platform !== "android" || !i.nativeHost) {
    return notAvailable(base, "Higgins checked the security information this device lets apps inspect. Looking through other installed apps isn't possible here.",
      !i.nativeHost ? PREVIEW_LIMIT : i.platform === "ios" ? "Apple prevents any app from listing or scanning other apps." : i.platform === "macos" ? "macOS doesn't let ApolloSG list other apps' permissions." : "Installed-app inspection isn't available on Windows yet.");
  }
  const s = i.signals;
  const remote = s.remoteAccessApps ?? [];
  const a11y = s.thirdPartyAccessibilityServices ?? [];
  const found: string[] = [];
  let result: FirstCheckResultState = "PASS";
  let severity: FirstCheckSeverity = "none";
  if (remote.length) { result = "SUSPICIOUS"; severity = "medium"; found.push(`remote-access app${remote.length > 1 ? "s" : ""} installed (${remote.join(", ")})`); }
  if (a11y.length) { if (result === "PASS") { result = "CAUTION"; severity = "low"; } found.push(`accessibility access held by ${a11y.join(", ")}`); }
  return { ...base, supported: true, executed: true, result, confidence: "medium", severity,
    evidenceRef: found.length ? "signals:app_access" : null,
    evidence: found.length ? found.join("; ") : "Checked remote-access apps and accessibility services.",
    explanation: result === "PASS" ? "Higgins found no apps with the kind of powerful access that usually accompanies malware, within what Android lets Apollo read."
      : "Higgins found app access worth a look. Powerful access is not proof of malware, but it's worth confirming you set it up.",
    platformLimitation: null, action: result === "PASS" ? null : "If you don't recognise these apps or didn't give them this access, remove the access or uninstall them." };
}

function installSourcesCheck(i: FirstCheckInputs): Row {
  const base = { id: "install_sources", category: "application_risk" as const, title: "Apps from unknown sources" };
  const v = i.signals.unknownSourcesEnabled;
  const label = i.platform === "macos" ? "Gatekeeper" : i.platform === "windows" ? "SmartScreen" : "unknown-source installs";
  if (!i.nativeHost || v === null) {
    return notAvailable(base, "Higgins couldn't read whether apps from outside the official store can be installed.",
      !i.nativeHost ? PREVIEW_LIMIT : i.platform === "ios" ? "iOS only installs apps through Apple-approved channels and doesn't expose this setting." : i.platform === "android" ? "Since Android 8 this permission is granted per app and Android doesn't let Apollo read it for other apps." : "This setting couldn't be read on this device.");
  }
  if (v) {
    return { ...base, supported: true, executed: true, result: "CAUTION", confidence: "high", severity: "low", evidenceRef: "signals:unknown_sources",
      evidence: i.platform === "macos" ? "Gatekeeper is off — apps from anyone can run." : i.platform === "windows" ? "SmartScreen app checks are off." : "Installs from unknown sources are allowed.",
      explanation: "This device will install or run apps that haven't been checked by the official store or the operating system — a common way malware arrives.",
      platformLimitation: null, action: `Turn ${label} back on unless you need it off.` };
  }
  return { ...base, supported: true, executed: true, result: "PASS", confidence: "high", severity: "none", evidenceRef: "signals:unknown_sources",
    evidence: `${label === "unknown-source installs" ? "Unknown-source installs are blocked" : `${label} is on`}.`, explanation: "Apps from unknown sources are checked or blocked by the operating system.", platformLimitation: null, action: null };
}

function networkConfigCheck(i: FirstCheckInputs): Row {
  const base = { id: "network_config", category: "network_config" as const, title: "VPN, profiles and certificates" };
  const s = i.signals;
  const visible = s.vpnActive !== null || s.managementProfile !== "unknown" || s.userTrustedCertificates !== null;
  if (!visible) {
    return notAvailable(base, "Higgins couldn't read VPN, management-profile or certificate state on this device.",
      !i.nativeHost ? PREVIEW_LIMIT : i.platform === "ios" ? "iOS doesn't let apps list configuration profiles or installed certificates." : "These network-security signals aren't exposed on this device.");
  }
  const found: string[] = [];
  const seen: string[] = [];
  let result: FirstCheckResultState = "PASS";
  let severity: FirstCheckSeverity = "none";
  if (s.vpnActive !== null) seen.push(s.vpnActive ? "VPN on" : "no VPN");
  if (s.vpnActive === true && s.vpnProviderKnown === false) { result = "SUSPICIOUS"; severity = "medium"; found.push("a VPN ApolloSG didn't set up is active"); }
  else if (s.vpnActive === true && s.vpnProviderKnown === null) { result = "INFORMATION"; severity = "info"; found.push("a VPN is on — Apollo can see it but not who runs it"); }
  if (s.userTrustedCertificates !== null) seen.push(`${s.userTrustedCertificates} user-installed certificate${s.userTrustedCertificates === 1 ? "" : "s"}`);
  if ((s.userTrustedCertificates ?? 0) > 0) { if (result === "PASS" || result === "INFORMATION") { result = "CAUTION"; severity = "low"; } found.push("an extra user-trusted certificate is installed"); }
  if (s.managementProfile !== "unknown") seen.push(s.managementProfile === "none" || s.managementProfile === "device_admin" ? "no management profile" : "management profile present");
  if (s.managementProfile === "managed" || s.managementProfile === "present") { if (result === "PASS") { result = "INFORMATION"; severity = "info"; } found.push("a device-management profile is present"); }
  const missing = [s.vpnActive === null && "VPN", s.userTrustedCertificates === null && "certificates", s.managementProfile === "unknown" && "management profiles"].filter(Boolean) as string[];
  return { ...base, supported: true, executed: true, result, confidence: "medium", severity, evidenceRef: found.length ? "signals:network_config" : null,
    evidence: `Observed: ${seen.join(", ")}`,
    explanation: result === "PASS" ? "Higgins found no unexpected VPN, management profile or certificate affecting how this device trusts connections."
      : `Higgins noticed ${found.join("; ")}. ${result === "INFORMATION" ? "That can be perfectly normal — worth knowing about." : "Confirm you set this up."}`,
    platformLimitation: missing.length ? `Couldn't read ${missing.join(" or ")} on this device.` : null,
    action: result === "CAUTION" || result === "SUSPICIOUS" ? "If you didn't set this up, remove the VPN or certificate in Settings." : null };
}

function osSecurityCheck(i: FirstCheckInputs): Row {
  const base = { id: "os_security", category: "os_security" as const, title: "Security settings and updates" };
  const s = i.signals;
  const osVersion = i.deviceFacts?.osVersion ?? null;
  const readings: [string, boolean | null, string][] = [
    ["Screen lock", s.screenLockSecure, "Set a PIN, password or biometric screen lock."],
    ["Firewall", s.firewallEnabled, "Turn the firewall back on."],
    ["System updates", s.osUpdatesCurrent, "Install the pending system updates."],
    ["Antivirus", s.antivirusEnabled, "Turn on Microsoft Defender (or your antivirus) real-time protection."],
  ];
  const read = readings.filter(([, v]) => v !== null);
  if (!osVersion && read.length === 0) {
    return notAvailable(base, "Higgins couldn't read the operating-system version or security settings on this build.", !i.nativeHost ? PREVIEW_LIMIT : "These settings aren't exposed on this build.");
  }
  const bad = read.filter(([, v]) => v === false);
  const evidence = [osVersion ? `Running ${osVersion}` : null, ...read.map(([n, v]) => `${n}: ${n === "System updates" ? (v ? "up to date" : "updates pending") : v ? "on" : "off"}`), s.developerOptions ? "Developer options: on" : null].filter(Boolean).join(" · ");
  const unread = readings.filter(([, v]) => v === null).map(([n]) => n.toLowerCase());
  if (bad.length) {
    return { ...base, supported: true, executed: true, result: "CAUTION", confidence: "high", severity: "low", evidenceRef: "signals:os_condition", evidence,
      explanation: `${bad.map(([n]) => n).join(", ")} ${bad.length > 1 ? "need" : "needs"} attention. These are security conditions that make malware easier to get in — not signs of infection.`,
      platformLimitation: null, action: bad.map(([, , a]) => a).join(" ") };
  }
  return { ...base, supported: true, executed: true, result: "INFORMATION", confidence: "medium", severity: "info", evidenceRef: osVersion ? `os:${osVersion}` : "signals:os_condition", evidence,
    explanation: "The security settings Higgins could read look fine. Keeping the system up to date is still the single best way to stay safe.",
    platformLimitation: unread.length ? `Couldn't read ${unread.join(", ")} on this device.` : null, action: null };
}

function apolloIntegrityCheck(i: FirstCheckInputs): Row {
  const base = { id: "apollo_integrity", category: "apollo_integrity" as const, title: "Apollo's own protection" };
  if (!i.nativeHost) return notAvailable(base, "This preview can't verify Apollo's protection component. On a real device Higgins confirms ApolloSG is present and responding.", PREVIEW_LIMIT);
  if (i.protection) {
    return { ...base, supported: true, executed: true, result: "PASS", confidence: "high", severity: "none", evidenceRef: `adapter:${i.protection.adapterLabel}`,
      evidence: `${i.protection.adapterLabel} responded${i.protection.operational ? " and protection is running" : ""}.`, explanation: "Apollo's protection component is present and responding on this device.", platformLimitation: null, action: null };
  }
  return { ...base, supported: true, executed: false, result: "ERROR", confidence: "low", severity: "low", evidenceRef: null, evidence: null,
    explanation: "Higgins couldn't read Apollo's protection component just now.", platformLimitation: null, action: "Try the check again shortly." };
}

function securityRulesCheck(i: FirstCheckInputs): Row {
  const base = { id: "security_rules", category: "apollo_integrity" as const, title: "Apollo's security rules" };
  const rules = i.ruleBundle ?? null;
  if (!i.nativeHost || !rules || !rules.observable) {
    return notAvailable(base, "Higgins couldn't read the state of Apollo's security rules on this device.",
      !i.nativeHost ? PREVIEW_LIMIT : "This device doesn't report the state of Apollo's security rules.");
  }
  if (rules.current === null) {
    return { ...base, supported: true, executed: false, result: "ERROR", confidence: "low", severity: "low", evidenceRef: null,
      evidence: null, explanation: rules.detail, platformLimitation: null, action: "Run the check again in a moment." };
  }
  if (rules.current === false) {
    return { ...base, supported: true, executed: true, result: "CAUTION", confidence: "high", severity: "medium", evidenceRef: "rules:expiry",
      evidence: rules.detail,
      explanation: "Apollo's security rules are out of date, so the newest known dangerous websites may not be blocked yet.",
      platformLimitation: null, action: "Open ApolloSG's protection and run the check again so it can fetch fresh rules." };
  }
  return { ...base, supported: true, executed: true, result: "PASS", confidence: "high", severity: "none", evidenceRef: "rules:expiry",
    evidence: rules.detail, explanation: "Apollo's security rules are up to date.", platformLimitation: null, action: null };
}

function connectionCheck(i: FirstCheckInputs): Row {
  const base = { id: "connection", category: "connection" as const, title: "Internet connection" };
  const n = i.connection ?? null;
  if (!n) {
    return notAvailable(base, "Higgins couldn't read this device's internet connection.",
      !i.nativeHost ? PREVIEW_LIMIT : "This device didn't report its connection state.");
  }
  const where = n.type === "wifi" ? `Wi-Fi${n.ssid ? ` "${n.ssid}"` : ""}` : n.type === "cellular" ? "mobile data" : n.type === "none" ? "no connection" : `a ${n.type} connection`;
  const evidence = `${where} · reachable: ${n.isInternetReachable === null ? "not revealed" : n.isInternetReachable ? "yes" : "no"}${n.wifiSecurity && n.wifiSecurity !== "n/a" ? ` · security: ${n.wifiSecurity}` : ""}`;
  if (!n.connected || n.isInternetReachable === false) {
    return { ...base, supported: true, executed: true, result: "INFORMATION", confidence: "high", severity: "info", evidenceRef: "signals:connection",
      evidence, explanation: "This device isn't online at the moment, so the checks that need the internet couldn't run.",
      platformLimitation: null, action: null };
  }
  if (n.captivePortal) {
    return { ...base, supported: true, executed: true, result: "CAUTION", confidence: "high", severity: "low", evidenceRef: "signals:connection",
      evidence, explanation: "This connection is asking you to sign in before it lets you online. Sign-in pages on public networks are a common place for fake login screens.",
      platformLimitation: null, action: "Only sign in on a network you recognise, and never enter banking details on a sign-in page." };
  }
  if (n.type === "wifi" && n.wifiSecurity === "open") {
    return { ...base, supported: true, executed: true, result: "CAUTION", confidence: "high", severity: "low", evidenceRef: "signals:connection",
      evidence, explanation: "This Wi-Fi has no password, so other people nearby can see more of what this device sends.",
      platformLimitation: null, action: "Use mobile data for anything private while you're on this network." };
  }
  return { ...base, supported: true, executed: true, result: "PASS", confidence: "high", severity: "none", evidenceRef: "signals:connection",
    evidence, explanation: `This device is online through ${where}, and nothing unusual was found about the connection.`,
    platformLimitation: n.inspectable ? null : "This platform doesn't let Apollo inspect the connection in detail.", action: null };
}

// --- Platform capability explanation -------------------------------------------------------------------

const PLATFORM_NOTE: Record<DevicePlatform, string> = {
  android: "Android lets Apollo read the most: Google Play Protect's malware report, root signs, apps with powerful access, VPN, certificates and device management.",
  windows: "On Windows, Apollo reads Microsoft Defender's own malware report, its tamper protection, SmartScreen, firewall, updates and antivirus state. It doesn't scan files itself.",
  macos: "On a Mac, Apollo reads System Integrity Protection, Gatekeeper, device-management enrolment, firewall and update state. macOS doesn't share XProtect malware detections with apps.",
  ios: "Apple keeps iPhone and iPad apps sealed off from each other, so no app — including ApolloSG — can scan for malware or list other apps. Apollo checks for jailbreak signs, VPN, management and screen lock, and tells you what Apple keeps hidden.",
  web: "This is a preview, so ApolloSG can't reach the device's security system. Install ApolloSG on the device for a real check.",
};

// --- Overall derivation ------------------------------------------------------------------------------

export function deriveOverall(checks: FirstCheckCapabilityResult[]): FirstCheckOverall {
  if (checks.some((c) => c.result === "CONFIRMED_THREAT")) return "CONFIRMED_THREAT";
  if (checks.some((c) => c.result === "SUSPICIOUS")) return "HIGH_RISK";
  if (checks.some((c) => c.result === "CAUTION")) return "ATTENTION";
  const meaningful = checks.filter((c) => MEANINGFUL_CATEGORIES.includes(c.category));
  const meaningfulExecuted = meaningful.filter((c) => c.executed && c.result !== "ERROR").length;
  const meaningfulBlocked = meaningful.filter((c) => !c.executed || c.result === "ERROR").length;
  if (meaningfulExecuted === 0 || meaningfulBlocked >= meaningfulExecuted) return "LIMITED_CHECK";
  return "CLEAR";
}

export function runFirstCheck(inputs: FirstCheckInputs, now: string = new Date().toISOString()): FirstCheckReport {
  const checks: Row[] = [
    osThreatCheck(inputs),
    deviceIntegrityCheck(inputs),
    applicationRiskCheck(inputs),
    installSourcesCheck(inputs),
    networkConfigCheck(inputs),
    osSecurityCheck(inputs),
    apolloIntegrityCheck(inputs),
    securityRulesCheck(inputs),
    connectionCheck(inputs),
  ];
  const overall = deriveOverall(checks);
  const concerns = checks.filter((c) => CONCERN_STATES.includes(c.result)).map((c) => `${c.title}: ${c.explanation}`);
  const unavailable = checks.filter((c) => c.result === "NOT_AVAILABLE").map((c) => c.title);
  const ran = checks.filter((c) => c.executed).length;
  const capabilityNote = `On this ${platformName(inputs.platform)}, Higgins ran ${ran} of ${checks.length} checks. ${PLATFORM_NOTE[inputs.platform]}`;
  return { overall, platform: inputs.platform, checkedAt: now, checks, concerns, unavailable, capabilityNote, signals: inputs.signals };
}

/** The whole run failed technically (collector threw). Honest ERROR overall — never a clean result. */
export function erroredFirstCheck(platform: DevicePlatform, signals: DeviceSignals, now: string = new Date().toISOString(),
                                  reason?: string): FirstCheckReport {
  return { overall: "ERROR", platform, checkedAt: now, checks: [], concerns: [],
    unavailable: [reason?.trim() || "Higgins couldn't complete the initial security check."], signals };
}

// --- Higgins plain-English copy per overall state ------------------------------------------------------

export const FIRST_CHECK_COPY: Record<FirstCheckOverall, { title: string; headline: string; dogState: "resting" | "ears_up" | "growling" | "barking" | "sniffing" }> = {
  CLEAR: { title: "No signs of a problem", dogState: "resting",
    headline: "Higgins First Check complete. I found no signs of malware or compromise in the areas this device allows me to check." },
  ATTENTION: { title: "Worth a look first", dogState: "ears_up",
    headline: "Higgins found something that deserves attention before I can give this device a full all-clear." },
  HIGH_RISK: { title: "This needs your attention", dogState: "barking",
    headline: "Higgins found signs that this device may already be compromised. These are warning signs, not confirmed malware — but they need attention." },
  CONFIRMED_THREAT: { title: "Apollo is barking", dogState: "barking",
    headline: "The device's own malware protection is reporting a threat. Apollo will protect what it can — follow the steps to remove it." },
  LIMITED_CHECK: { title: "Checked everything this device allows", dogState: "ears_up",
    headline: "Higgins ran every check this device allows and found nothing wrong. Some areas can't be inspected on this platform — that's a limitation, not an all-clear." },
  ERROR: { title: "Couldn't finish the check", dogState: "ears_up",
    headline: "Higgins couldn't complete the security check. ApolloSG can still start available protection, but I can't yet confirm the device's security condition." },
};

export function reCheckHeadline(overall: FirstCheckOverall, changeCount: number): string {
  if (overall === "CONFIRMED_THREAT") return FIRST_CHECK_COPY.CONFIRMED_THREAT.headline;
  if (overall === "HIGH_RISK") return "Apollo is barking. Higgins found signs that this device may already be compromised.";
  if (changeCount > 0 && overall === "ATTENTION") return `Higgins found something that's changed. ${changeCount === 1 ? "One item needs" : `${changeCount} items need`} your attention.`;
  if (overall === "LIMITED_CHECK") return "Higgins ran every check this device allows. Some areas can't be inspected on this platform.";
  if (overall === "ERROR") return FIRST_CHECK_COPY.ERROR.headline;
  return "Device Re-check complete. I found no new signs of a problem in the areas this device allows me to check.";
}

// --- Re-check comparison ----------------------------------------------------------------------------

export interface FirstCheckChange { title: string; detail: string; direction: "worse" | "better" | "changed" }

const RANK: Record<FirstCheckResultState, number> = { PASS: 0, INFORMATION: 1, NOT_AVAILABLE: 1, ERROR: 1, CAUTION: 2, SUSPICIOUS: 3, CONFIRMED_THREAT: 4 };

/** Meaningful changes between a previous baseline and a fresh report — evidence, never automatic proof. */
export function diffFirstCheck(previous: FirstCheckReport | null, current: FirstCheckReport): FirstCheckChange[] {
  if (!previous || previous.platform !== current.platform) return [];
  const changes: FirstCheckChange[] = [];
  for (const cur of current.checks) {
    const prev = previous.checks.find((c) => c.id === cur.id);
    if (!prev || prev.result === cur.result) continue;
    const worse = RANK[cur.result] > RANK[prev.result];
    const better = RANK[cur.result] < RANK[prev.result] && (prev.result === "CAUTION" || prev.result === "SUSPICIOUS" || prev.result === "CONFIRMED_THREAT");
    if (!worse && !better) continue;
    changes.push({ title: cur.title, direction: worse ? "worse" : "better",
      detail: better ? `Previously flagged — now ${cur.result === "PASS" ? "clear" : cur.result.toLowerCase().replace("_", " ")}.` : cur.explanation });
  }
  return changes;
}
