// Higgins First Check — Apollo's onboarding malware/virus/compromise BASELINE assessment, plus the
// manual "Higgins Re-check" in the Check tab. This is NOT an antivirus engine and NOT a background
// scanner: it is a point-in-time, capability-based reading of the security signals each platform
// legitimately exposes. Pure and unit-tested; the collector (firstCheckSignals.ts) gathers the
// inputs, the UI reports the result — neither invents a finding.
//
// Core product rule: Apollo must never assume it arrived on a clean device. An OS refusing a signal
// is NOT_AVAILABLE, never PASS. Heuristics alone can never produce CONFIRMED_THREAT.

import type { DevicePlatform, DeviceSignals } from "./deviceAnalysis";

/** Per-check result states (spec §6). NOT_AVAILABLE is never silently upgraded to PASS. */
export type FirstCheckResultState =
  | "PASS" | "INFORMATION" | "CAUTION" | "SUSPICIOUS" | "CONFIRMED_THREAT" | "NOT_AVAILABLE" | "ERROR";

/** One overall result derived from the individual checks (spec §8). */
export type FirstCheckOverall = "CLEAR" | "ATTENTION" | "HIGH_RISK" | "CONFIRMED_THREAT" | "LIMITED_CHECK" | "ERROR";

export type FirstCheckCategory = "device_integrity" | "application_risk" | "network_config" | "apollo_integrity" | "os_security";
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
  /** Local, non-sensitive reference backing the finding (e.g. a signal name). Never raw app/cert data. */
  evidenceRef: string | null;
  /** Plain-English explanation, Higgins' voice. */
  explanation: string;
  /** Why a signal could not be inspected on this platform/build (null when it was). */
  platformLimitation: string | null;
}

/** A deterministic OS-reported threat (Windows Defender, trusted OS malware report). The ONLY path to
 *  CONFIRMED_THREAT — supplied by the collector only when the platform reports it deterministically. */
export interface OsReportedThreat { present: boolean; detail: string }

export interface FirstCheckInputs {
  platform: DevicePlatform;
  nativeHost: boolean;
  signals: DeviceSignals;
  deviceFacts: { osVersion: string | null; manufacturer: string | null; model: string | null } | null;
  protection: { requested: boolean; operational: boolean; enforcementMethod: string; adapterLabel: string } | null;
  osReportedThreat?: OsReportedThreat | null;
}

export interface FirstCheckReport {
  overall: FirstCheckOverall;
  platform: DevicePlatform;
  checkedAt: string;
  checks: FirstCheckCapabilityResult[];
  /** Short list of the human-readable things that need attention (empty when CLEAR/LIMITED). */
  concerns: string[];
  /** Checks that could not be performed on this platform/build. */
  unavailable: string[];
  /** Signal snapshot kept so a later Re-check can diff against this baseline. */
  signals: DeviceSignals;
}

const CONCERN_STATES: FirstCheckResultState[] = ["CAUTION", "SUSPICIOUS", "CONFIRMED_THREAT"];
const MEANINGFUL_CATEGORIES: FirstCheckCategory[] = ["device_integrity", "application_risk", "network_config"];

const platformName = (p: DevicePlatform) => (p === "ios" ? "iPhone or iPad" : p === "android" ? "Android device" : "device");

// --- Individual checks -------------------------------------------------------------------------------

function apolloIntegrityCheck(i: FirstCheckInputs): FirstCheckCapabilityResult {
  const base = { id: "apollo_integrity", category: "apollo_integrity" as const, title: "Apollo's own protection component" };
  if (!i.nativeHost) {
    return { ...base, supported: false, executed: false, result: "NOT_AVAILABLE", confidence: "low", severity: "none", evidenceRef: null,
      explanation: "This preview build can't verify Apollo's native protection component. On a real device Higgins confirms Apollo is present and responding.", platformLimitation: "Native protection isn't available in Expo Go or the web preview." };
  }
  if (i.protection) {
    return { ...base, supported: true, executed: true, result: "PASS", confidence: "high", severity: "none", evidenceRef: `adapter:${i.protection.adapterLabel}`,
      explanation: "Apollo's protection component is present and responding on this device.", platformLimitation: null };
  }
  return { ...base, supported: true, executed: false, result: "ERROR", confidence: "low", severity: "low", evidenceRef: null,
    explanation: "Higgins couldn't read Apollo's protection component just now. Apollo can still start available protection; try the check again shortly.", platformLimitation: null };
}

function deviceIntegrityCheck(i: FirstCheckInputs): FirstCheckCapabilityResult {
  // Root / jailbreak / bootloader attestation are not exposed by the current build on any platform.
  // Spec: unavailable is reported honestly, never converted to a clean PASS.
  return { id: "device_integrity", category: "device_integrity", title: "Root, jailbreak and system modification",
    supported: false, executed: false, result: "NOT_AVAILABLE", confidence: "low", severity: "none", evidenceRef: null,
    explanation: `Higgins couldn't read system-integrity signals (root, jailbreak or bootloader state) on this ${platformName(i.platform)}. This build doesn't expose them, so Higgins can't confirm or rule out system modification here.`,
    platformLimitation: i.platform === "ios" ? "Apple restricts direct system-integrity inspection by apps." : "This build doesn't expose root/attestation signals yet." };
}

function applicationRiskCheck(i: FirstCheckInputs): FirstCheckCapabilityResult {
  const base = { id: "application_risk", category: "application_risk" as const, title: "Installed apps and their access" };
  if (i.platform !== "android") {
    return { ...base, supported: false, executed: false, result: "NOT_AVAILABLE", confidence: "low", severity: "none", evidenceRef: null,
      explanation: "Higgins checked the security information this device allows apps to inspect. This platform restricts scanning of other apps and system files, so app-level malware checks aren't available here.",
      platformLimitation: i.platform === "ios" ? "Apple prevents any app from listing or scanning other apps." : "Installed-app inspection isn't available on this build." };
  }
  const s = i.signals;
  const remote = s.remoteAccessApps ?? [];
  const a11y = s.thirdPartyAccessibilityServices ?? [];
  const concerns: string[] = [];
  let result: FirstCheckResultState = "PASS";
  let severity: FirstCheckSeverity = "none";
  if (remote.length) { result = "SUSPICIOUS"; severity = "medium"; concerns.push(`remote-access app${remote.length > 1 ? "s" : ""} installed (${remote.join(", ")})`); }
  if (a11y.length) { if (result === "PASS") { result = "CAUTION"; severity = "low"; } concerns.push(`accessibility access held by ${a11y.join(", ")}`); }
  if (s.unknownSourcesEnabled) { if (result === "PASS") { result = "CAUTION"; severity = "low"; } concerns.push("installs from unknown sources are allowed"); }
  const explanation = result === "PASS"
    ? "Higgins found no apps with the kind of powerful access that usually accompanies malware, within what Android lets Apollo read."
    : `Higgins found app access worth a look: ${concerns.join("; ")}. Powerful access is not proof of malware, but it's worth confirming you set it up.`;
  return { ...base, supported: true, executed: true, result, confidence: result === "PASS" ? "medium" : "medium", severity,
    evidenceRef: concerns.length ? "signals:app_access" : null, explanation, platformLimitation: null };
}

function networkConfigCheck(i: FirstCheckInputs): FirstCheckCapabilityResult {
  const base = { id: "network_config", category: "network_config" as const, title: "VPN, profiles and certificates" };
  const s = i.signals;
  const visible = s.vpnActive !== null || s.managementProfile !== "unknown" || s.userTrustedCertificates !== null;
  if (!visible) {
    return { ...base, supported: false, executed: false, result: "NOT_AVAILABLE", confidence: "low", severity: "none", evidenceRef: null,
      explanation: "Higgins couldn't read VPN, configuration-profile or certificate state on this build.", platformLimitation: "These network-security signals aren't exposed on this build." };
  }
  const concerns: string[] = [];
  let result: FirstCheckResultState = "PASS";
  let severity: FirstCheckSeverity = "none";
  if (s.vpnActive === true && s.vpnProviderKnown === false) { result = "SUSPICIOUS"; severity = "medium"; concerns.push("a VPN Apollo didn't set up is active"); }
  else if (s.vpnActive === true && s.vpnProviderKnown === null) { result = "INFORMATION"; severity = "info"; concerns.push("a VPN is on — Apollo can see it but not who runs it"); }
  if ((s.userTrustedCertificates ?? 0) > 0) { if (result === "PASS" || result === "INFORMATION") { result = "CAUTION"; severity = "low"; } concerns.push("an extra user-trusted certificate is installed"); }
  if (s.managementProfile === "managed" || s.managementProfile === "present") { if (result === "PASS") { result = "INFORMATION"; severity = "info"; } concerns.push("a device-management profile is present"); }
  const explanation = result === "PASS"
    ? "Higgins found no unexpected VPN, management profile or certificate affecting how this device trusts connections."
    : `Higgins noticed: ${concerns.join("; ")}. ${result === "INFORMATION" ? "That can be perfectly normal — worth knowing about." : "Confirm you set this up, or remove it if you didn't."}`;
  return { ...base, supported: true, executed: true, result, confidence: "medium", severity, evidenceRef: concerns.length ? "signals:network_config" : null, explanation, platformLimitation: null };
}

function osSecurityCheck(i: FirstCheckInputs): FirstCheckCapabilityResult {
  const base = { id: "os_security", category: "os_security" as const, title: "Operating-system security condition" };
  const osVersion = i.deviceFacts?.osVersion ?? null;
  if (!osVersion) {
    return { ...base, supported: false, executed: false, result: "NOT_AVAILABLE", confidence: "low", severity: "none", evidenceRef: null,
      explanation: "Higgins couldn't read the operating-system version on this build.", platformLimitation: "OS version isn't exposed on this build." };
  }
  // An old OS or a missing patch is a security CONDITION, never proof of malware (spec §5).
  return { ...base, supported: true, executed: true, result: "INFORMATION", confidence: "medium", severity: "info", evidenceRef: `os:${osVersion}`,
    explanation: `This device reports ${osVersion}. Keeping the operating system up to date is the single best way to stay safe. An out-of-date system is a security condition, not a sign of malware.`,
    platformLimitation: "Detailed security-patch status isn't exposed on this build." };
}

function osThreatCheck(i: FirstCheckInputs): FirstCheckCapabilityResult | null {
  // Only emitted when a trusted OS threat report is supplied. This is the sole deterministic path to
  // CONFIRMED_THREAT — heuristics above never create it.
  const t = i.osReportedThreat;
  if (!t) return null;
  return { id: "os_reported_threat", category: "device_integrity", title: "Operating-system threat report",
    supported: true, executed: true, result: t.present ? "CONFIRMED_THREAT" : "PASS", confidence: "high", severity: t.present ? "high" : "none",
    evidenceRef: t.present ? "os:threat_report" : null,
    explanation: t.present ? `The operating system is reporting an active threat: ${t.detail}` : "The operating system reports no active threats.", platformLimitation: null };
}

// --- Overall derivation ------------------------------------------------------------------------------

export function deriveOverall(checks: FirstCheckCapabilityResult[]): FirstCheckOverall {
  if (checks.some((c) => c.result === "CONFIRMED_THREAT")) return "CONFIRMED_THREAT";
  if (checks.some((c) => c.result === "SUSPICIOUS")) return "HIGH_RISK";
  if (checks.some((c) => c.result === "CAUTION")) return "ATTENTION";
  // No concern found. Decide CLEAR vs LIMITED_CHECK by how much Apollo could meaningfully inspect.
  const meaningful = checks.filter((c) => MEANINGFUL_CATEGORIES.includes(c.category));
  const meaningfulExecuted = meaningful.filter((c) => c.executed && c.result !== "ERROR").length;
  const meaningfulBlocked = meaningful.filter((c) => !c.executed || c.result === "ERROR").length;
  if (meaningfulExecuted === 0 || meaningfulBlocked >= meaningfulExecuted) return "LIMITED_CHECK";
  return "CLEAR";
}

export function runFirstCheck(inputs: FirstCheckInputs, now: string = new Date().toISOString()): FirstCheckReport {
  const checks: FirstCheckCapabilityResult[] = [
    apolloIntegrityCheck(inputs),
    deviceIntegrityCheck(inputs),
    applicationRiskCheck(inputs),
    networkConfigCheck(inputs),
    osSecurityCheck(inputs),
  ];
  const threat = osThreatCheck(inputs);
  if (threat) checks.unshift(threat);
  const overall = deriveOverall(checks);
  const concerns = checks.filter((c) => CONCERN_STATES.includes(c.result)).map((c) => `${c.title}: ${c.explanation}`);
  const unavailable = checks.filter((c) => c.result === "NOT_AVAILABLE").map((c) => c.title);
  return { overall, platform: inputs.platform, checkedAt: now, checks, concerns, unavailable, signals: inputs.signals };
}

/** The whole run failed technically (collector threw). Honest ERROR overall — never a clean result. */
export function erroredFirstCheck(platform: DevicePlatform, signals: DeviceSignals, now: string = new Date().toISOString()): FirstCheckReport {
  return { overall: "ERROR", platform, checkedAt: now, checks: [], concerns: [],
    unavailable: ["Higgins couldn't complete the initial security check."], signals };
}

// --- Higgins plain-English copy per overall state (spec §8/§17) --------------------------------------

export const FIRST_CHECK_COPY: Record<FirstCheckOverall, { title: string; headline: string; dogState: "resting" | "ears_up" | "growling" | "barking" | "sniffing" }> = {
  CLEAR: { title: "No signs of a problem", dogState: "resting",
    headline: "Higgins First Check complete. I found no signs of an existing compromise in the areas this device allows me to check." },
  ATTENTION: { title: "Worth a look first", dogState: "ears_up",
    headline: "Higgins found something that deserves attention before I can give this device a full all-clear." },
  HIGH_RISK: { title: "This needs your attention", dogState: "barking",
    headline: "Higgins found signs that this device may already be compromised. Apollo can protect the traffic and activity it controls, but this issue needs attention." },
  CONFIRMED_THREAT: { title: "Apollo is barking", dogState: "barking",
    headline: "Higgins found a confirmed threat reported by this device. Apollo will protect what it can — follow the steps to deal with it." },
  LIMITED_CHECK: { title: "Checked everything this device allows", dogState: "ears_up",
    headline: "Higgins completed every check this device allows. Some areas can't be inspected on this platform — that's a limitation, not a failure." },
  ERROR: { title: "Couldn't finish the check", dogState: "ears_up",
    headline: "Higgins couldn't complete the initial security check. Apollo can still start available protection, but I can't yet confirm the device's starting security condition." },
};

/** Re-check copy (spec §17) — framed as "has anything changed?". */
export function reCheckHeadline(overall: FirstCheckOverall, changeCount: number): string {
  if (overall === "CONFIRMED_THREAT" || overall === "HIGH_RISK") return "Apollo is barking. Higgins found signs that this device may already be compromised.";
  if (changeCount > 0 && (overall === "ATTENTION")) return `Higgins found something that's changed. ${changeCount === 1 ? "One item needs" : `${changeCount} items need`} your attention.`;
  if (overall === "LIMITED_CHECK") return "Higgins completed every check this device allows. Some areas can't be inspected on this platform.";
  if (overall === "ERROR") return FIRST_CHECK_COPY.ERROR.headline;
  return "Higgins Re-check complete. I found no new signs of a problem in the areas this device allows me to check.";
}

// --- Re-check comparison (spec §17 "compare with previous state") ------------------------------------

export interface FirstCheckChange { title: string; detail: string; direction: "worse" | "better" | "changed" }

const RANK: Record<FirstCheckResultState, number> = { PASS: 0, INFORMATION: 1, NOT_AVAILABLE: 1, ERROR: 1, CAUTION: 2, SUSPICIOUS: 3, CONFIRMED_THREAT: 4 };

/** Meaningful changes between a previous baseline and a fresh report. A change is EVIDENCE for further
 *  assessment, never automatic proof of compromise (spec §17). */
export function diffFirstCheck(previous: FirstCheckReport | null, current: FirstCheckReport): FirstCheckChange[] {
  if (!previous || previous.platform !== current.platform) return [];
  const changes: FirstCheckChange[] = [];
  for (const cur of current.checks) {
    const prev = previous.checks.find((c) => c.id === cur.id);
    if (!prev) continue;
    if (prev.result === cur.result) continue;
    const worse = RANK[cur.result] > RANK[prev.result];
    const better = RANK[cur.result] < RANK[prev.result] && (prev.result === "CAUTION" || prev.result === "SUSPICIOUS" || prev.result === "CONFIRMED_THREAT");
    if (!worse && !better) continue;
    changes.push({ title: cur.title, direction: worse ? "worse" : "better",
      detail: better ? `Previously flagged — now ${cur.result === "PASS" ? "clear" : cur.result.toLowerCase()}.` : cur.explanation });
  }
  return changes;
}
