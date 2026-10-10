// Pure builders that turn Apollo's existing telemetry into the Support screen's plain-English rows, the
// copyable summary, the email body (spec §8) and the exportable diagnostic report. No new telemetry and
// no sensitive data: only status, counts and dates — never credentials, tokens, browsing history or raw
// app/certificate data (spec §6/§9). Pure and unit-tested; the screen supplies already-observed inputs.
import type { EnforcementEvidence } from "@/src/security/PlatformCapabilityProfile";
import type { NetworkStatus, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import type { FullHealthCheck } from "@/src/health/systemHealthTypes";
import type { FirstCheckReport } from "@/src/domain/firstCheck";

import type { SupportAppInfo, SupportDeviceInfo } from "./supportInfo";

const UNAVAILABLE = "Unavailable";

export type ProtectionState =
  | "Active and verified" | "Active" | "Available" | "Warning" | "Not running" | "Unverified" | "Unsupported on this device" | "Status unavailable";

export interface SupportProtectionRow { label: string; state: ProtectionState; detail: string }
export interface SupportHigginsInfo { lastCheckAt: string; result: string; warnings: string[] }
export interface SupportIntel { safeBrowsing: "ok" | "not_configured" | "unavailable" | null; blocklistEntries: number | null }

export interface SupportSummary {
  app: SupportAppInfo;
  device: SupportDeviceInfo;
  protection: SupportProtectionRow[];
  higgins: SupportHigginsInfo;
}

const RECTANGLE = "────────────────────";

// --- Protection & Services (spec §4) -----------------------------------------------------------------

export function buildProtectionRows(
  p: ProtectionStatus | null, net: NetworkStatus | null, evidence: EnforcementEvidence[], intel: SupportIntel, isMock: boolean,
): SupportProtectionRow[] {
  const rows: SupportProtectionRow[] = [];

  // Apollo Protection Service. A reachable/enabled service is never reported as verified enforcement.
  if (!p) rows.push({ label: "Apollo Protection", state: "Status unavailable", detail: "Apollo could not read protection state." });
  else if (isMock) rows.push({ label: "Apollo Protection", state: "Available", detail: "Preview build: protection state is simulated, not real packet enforcement." });
  else if (p.enforcementMethod === "none") rows.push({ label: "Apollo Protection", state: "Unsupported on this device", detail: p.coverage });
  else if (!p.requested) rows.push({ label: "Apollo Protection", state: "Not running", detail: "Protection is turned off." });
  else if (p.requested && !p.operational) rows.push({ label: "Apollo Protection", state: "Warning", detail: p.degradedReason ?? "Protection is on but not currently enforcing." });
  else if (p.operational && p.lastVerified) rows.push({ label: "Apollo Protection", state: "Active and verified", detail: `Enforcement confirmed by the OS ${new Date(p.lastVerified).toLocaleString()}.` });
  else rows.push({ label: "Apollo Protection", state: "Unverified", detail: "Protection is on; the OS has not yet confirmed enforcement." });

  // VPN / network extension / TUN interface.
  if (!p || p.enforcementMethod === "none") rows.push({ label: "VPN / TUN interface", state: p ? "Unsupported on this device" : "Status unavailable", detail: "No packet-level interface on this platform." });
  else if (p.enforcementMethod === "packet_filter" || p.enforcementMethod === "dns_filter") rows.push({ label: "VPN / TUN interface", state: p.operational ? (p.lastVerified ? "Active and verified" : "Active") : "Warning", detail: p.operational ? "Apollo's local interface is up." : "Interface is not currently up." });
  else rows.push({ label: "VPN / TUN interface", state: "Unsupported on this device", detail: "This platform enforces via a content blocker, not a VPN/TUN." });

  // DNS protection.
  if (p && p.enforcementMethod === "dns_filter") rows.push({ label: "DNS protection", state: p.operational ? "Active" : "Warning", detail: "Apollo filters DNS lookups against its threat list." });
  else rows.push({ label: "DNS protection", state: p ? (p.enforcementMethod === "packet_filter" ? "Active" : "Unsupported on this device") : "Status unavailable", detail: p?.enforcementMethod === "packet_filter" ? "Covered within packet filtering." : "DNS-level filtering isn't the enforcement method here." });

  // Website Gate (Site Guard).
  if (!p) rows.push({ label: "Website Gate", state: "Status unavailable", detail: "Could not read Site Guard state." });
  else if (p.enforcementMethod === "none") rows.push({ label: "Website Gate", state: "Unsupported on this device", detail: p.coverage });
  else rows.push({ label: "Website Gate", state: p.operational ? "Active" : "Warning", detail: p.coverage });

  // Google Safe Browsing.
  rows.push({ label: "Google Safe Browsing", state: intel.safeBrowsing === "ok" ? "Available" : intel.safeBrowsing === "not_configured" ? "Not running" : "Status unavailable", detail: intel.safeBrowsing === "ok" ? "Submitted links are checked against Google's threat lists." : "Not configured for a live check." });

  // Apollo threat list.
  rows.push({ label: "Apollo threat list", state: intel.blocklistEntries != null ? "Available" : "Status unavailable", detail: intel.blocklistEntries != null ? `${intel.blocklistEntries} entries loaded.` : "Threat-list status could not be read." });

  // Last verified block evidence — ONLY actual OS-confirmed enforcement counts.
  const verified = evidence.filter((e) => e.result === "verified").sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] ?? null;
  rows.push({ label: "Last verified block", state: verified ? "Active and verified" : "Unverified", detail: verified ? `${verified.destination?.domain ?? verified.destination?.ip ?? "a destination"} on ${new Date(verified.observedAt).toLocaleString()} (${verified.mechanism}).` : "No verified block has been recorded yet." });

  // Network connectivity.
  if (!net) rows.push({ label: "Network", state: "Status unavailable", detail: "Could not read connectivity." });
  else rows.push({ label: "Network", state: net.connected ? "Active" : "Warning", detail: `${net.connected ? "Connected" : "Offline"} · ${net.type}${net.isInternetReachable === false ? " · no internet" : ""}.` });

  return rows;
}

// --- Current issues & Higgins (spec §5) --------------------------------------------------------------

export function buildHigginsInfo(health: FullHealthCheck | null, firstCheck: FirstCheckReport | null): SupportHigginsInfo {
  const times = [health?.checkedAt ?? null, firstCheck?.checkedAt ?? null].filter(Boolean) as string[];
  const lastCheckAt = times.length ? new Date(times.sort((a, b) => b.localeCompare(a))[0]).toLocaleString() : UNAVAILABLE;
  const warnings: string[] = [];
  if (firstCheck) warnings.push(...firstCheck.concerns);
  if (health) {
    if (health.device.status === "degraded" || health.device.status === "unavailable") warnings.push("Apollo could not confirm device protection.");
    if (health.backend.status === "degraded" || health.backend.status === "unavailable") warnings.push("Apollo's online services need attention.");
    if (health.higgins.status === "unavailable") warnings.push("Higgins investigations are currently unavailable.");
  }
  const result = firstCheck ? `Higgins ${firstCheck.overall.replace("_", " ")}` : health?.overall === "healthy" ? "All checks passed" : health?.checkedAt ? "Some checks need attention" : UNAVAILABLE;
  return { lastCheckAt, result, warnings };
}

export function buildSupportSummary(app: SupportAppInfo, device: SupportDeviceInfo, protection: SupportProtectionRow[], higgins: SupportHigginsInfo): SupportSummary {
  return { app, device, protection, higgins };
}

// --- Renderers ---------------------------------------------------------------------------------------

const row = (p: SupportProtectionRow) => `${p.label}: ${p.state}${p.detail ? ` — ${p.detail}` : ""}`;

/** Copyable plain-text summary + the email body share this core so they always match. */
export function renderSupportSummaryText(s: SupportSummary, reference: string): string {
  const warnings = s.higgins.warnings.length ? s.higgins.warnings.map((w) => `  • ${w}`).join("\n") : "  None reported";
  return [
    `Support Reference: ${reference}`, "",
    "APPLICATION DETAILS",
    `App: Apollo`,
    `Version: ${s.app.version}`,
    `Build: ${s.app.build}`,
    `Build ID: ${s.app.buildId}`,
    `Update ID: ${s.app.updateId}`,
    `Environment: ${s.app.environment}${s.app.nativeBuild ? "" : " (preview — native data unavailable)"}`,
    `App first installed: ${s.app.installedAt}`,
    `Bundle published: ${s.app.bundlePublishedAt}`,
    `Last native update: ${s.app.lastNativeUpdateAt}`, "",
    "DEVICE INFORMATION",
    `Device: ${s.device.manufacturer} ${s.device.model}`,
    `Operating System: ${s.device.os} ${s.device.osVersion}`,
    `Device Type: ${s.device.deviceType}`,
    `Architecture: ${s.device.architecture}`, "",
    "PROTECTION STATUS",
    ...s.protection.map(row), "",
    "HIGGINS CHECKUP",
    `Last Check: ${s.higgins.lastCheckAt}`,
    `Result: ${s.higgins.result}`,
    "Warnings:", warnings,
  ].join("\n");
}

/** Email body per the spec §8 template. Description is the user's words (left blank for them to fill). */
export function renderEmailBody(s: SupportSummary, reference: string, description = ""): string {
  return [
    "Apollo Support Request", RECTANGLE, "",
    `Support Reference: ${reference}`, "",
    "DESCRIPTION OF PROBLEM",
    description || "[Please describe the issue here]", "",
    renderSupportSummaryText(s, reference), "",
    "DIAGNOSTIC ATTACHMENTS",
    "No diagnostic report is attached unless you exported one and attached it yourself.", "",
    `Support Reference: ${reference}`, "",
    "This email was prepared by Apollo. You have reviewed it before sending.",
  ].join("\n");
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Exportable, redacted diagnostic report (spec §6). Shares the reference with the email. */
export function renderReportHtml(s: SupportSummary, reference: string): string {
  const pRows = s.protection.map((p) => `<tr><td>${esc(p.label)}</td><td><b>${esc(p.state)}</b></td><td>${esc(p.detail)}</td></tr>`).join("");
  const warnings = s.higgins.warnings.length ? `<ul>${s.higgins.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "<p>None reported.</p>";
  return `<html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#0B1B3A;padding:24px;font-size:12px}
    h1{margin:0 0 2px;font-size:22px;color:#0B1B3A} h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#9A7B2E;margin:18px 0 6px}
    .ref{color:#555;margin-bottom:14px} table{width:100%;border-collapse:collapse} td{border-top:1px solid #e3e6ec;padding:6px 8px;vertical-align:top}
    .kv{display:flex;justify-content:space-between;border-top:1px solid #eef0f4;padding:5px 0} .kv b{color:#0B1B3A}
  </style></head><body>
    <h1>Apollo Higgins Diagnostic Report</h1>
    <div class="ref">Support Reference: ${esc(reference)} · Generated on-device ${esc(new Date().toLocaleString())}</div>
    <h2>Application</h2>
    ${[["Version", s.app.version], ["Build", s.app.build], ["Build ID", s.app.buildId], ["Update ID", s.app.updateId], ["Environment", s.app.environment], ["App first installed", s.app.installedAt], ["Bundle published", s.app.bundlePublishedAt], ["Last native update", s.app.lastNativeUpdateAt]].map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
    <h2>Device</h2>
    ${[["Device", `${s.device.manufacturer} ${s.device.model}`], ["Operating System", `${s.device.os} ${s.device.osVersion}`], ["Device Type", s.device.deviceType], ["Architecture", s.device.architecture]].map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
    <h2>Protection &amp; Services</h2>
    <table>${pRows}</table>
    <h2>Device Checkup</h2>
    <div class="kv"><span>Last check</span><b>${esc(s.higgins.lastCheckAt)}</b></div>
    <div class="kv"><span>Result</span><b>${esc(s.higgins.result)}</b></div>
    <h2>Warnings</h2>
    ${warnings}
    <p style="margin-top:18px;color:#555">Generated on-device by Apollo. Contains only status, counts and dates — no credentials, tokens, browsing history or raw app data. This is a diagnostic record, not a forensic report, and a status marked "verified" refers only to OS-confirmed enforcement.</p>
  </body></html>`;
}
