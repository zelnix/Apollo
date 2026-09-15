// Gate Guard — out-of-band DNS/DoH capability characterization: JSON + PDF export. Renders exactly
// what dnsCapabilityDiagnostic.ts observed -- never computes or overrides a classification.
// COMPLETELY SEPARATE from, and does not touch, phase6AutomatedReport.ts (the frozen M2.1
// acceptance report) or any M2.1 acceptance state.
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import { Platform } from "react-native";

import { CLASSIFICATION_LABELS, type DnsDiagnosticRecord } from "@/src/diagnostics/dnsCapabilityDiagnostic";
import type { DnsDiagnosticTruthSnapshot } from "@/src/diagnostics/dnsCapabilityTruthSnapshot";
import type { BuildProvenance } from "@/src/harness/buildProvenance";
import type { Phase6DeviceProvenance } from "@/src/harness/phase6DeviceProvenance";

export interface DnsCharacterizationRun {
  runId: string;
  startedAt: string;
  records: DnsDiagnosticRecord[];
  buildProvenance: BuildProvenance | null;
  deviceProvenance: Phase6DeviceProvenance | null;
  /** Full machine-observed truth-of-state snapshot captured at the end of Preflight (null if the
   * wizard never reached/passed Preflight this session). */
  preflightSnapshot: DnsDiagnosticTruthSnapshot | null;
}

const CLASS_COLOR: Record<string, string> = {
  CAPTURED: "#15803d",
  BYPASSED: "#b91c1c",
  UNOBSERVABLE: "#64748b",
  NOT_TESTABLE: "#64748b",
};

function esc(v: unknown): string {
  return String(v ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

export function buildDnsCharacterizationJson(run: DnsCharacterizationRun): string {
  return JSON.stringify({ reportKind: "DNS_DOH_CAPABILITY_CHARACTERIZATION", exportedAt: new Date().toISOString(), ...run }, null, 2);
}

function recordRow(r: DnsDiagnosticRecord): string {
  const violation = r.truthSnapshot?.truthViolation;
  const violationCell = violation?.violated ? `<span style="color:#b91c1c;font-weight:700">⚠ ${esc(violation.reasons.join(" "))}</span>` : "none";
  return `<tr><td>${esc(r.category)}</td><td>${esc(r.configurationLabel)}</td><td>${esc(r.probeHostname)}</td><td>${esc(r.transportNetworkType)}</td><td>${r.sawPlaintextUdp53 ? "yes" : "no"}</td><td>${r.websiteGateEventProduced ? "yes" : "no"}</td><td>${r.independentSuccess === null ? "n/a" : r.independentSuccess ? "yes" : "no"} (${esc(r.independentSuccessSource)})</td><td style="color:${CLASS_COLOR[r.classification] ?? "#64748b"};font-weight:800">${esc(r.classification)}<br/><span style="font-weight:400;font-size:9px">${esc(CLASSIFICATION_LABELS[r.classification])}</span></td><td style="font-size:9px">${violationCell}</td><td style="font-size:10px">${esc(r.notes)}</td></tr>`;
}

function truthSnapshotSection(title: string, s: DnsDiagnosticTruthSnapshot | null): string {
  if (!s) return `<h3>${esc(title)}</h3><p style="font-size:11px;color:#94a3b8">Not captured this session.</p>`;
  const rows: [string, string][] = [
    ["Native module available", s.nativeAvailable ? "yes" : "no (Expo Go / web)"],
    ["VPN consent granted", s.vpnConsentGranted === null ? "n/a" : s.vpnConsentGranted ? "yes" : "no"],
    ["Protection state", s.protectionState ?? "n/a"],
    ["TUN open", s.tunOpen === null ? "n/a" : s.tunOpen ? "yes" : "no"],
    ["Selective route active", s.selectiveRouteActive === null ? "n/a" : s.selectiveRouteActive ? "yes" : "no"],
    ["Notifications enabled", s.notificationsEnabled === null ? "n/a" : s.notificationsEnabled ? "yes" : "no"],
    ["Website Gate configured", s.websiteGateConfigured === null ? "n/a" : s.websiteGateConfigured ? "yes" : "no"],
    ["DNS gateway active", s.dnsGatewayActive === null ? "n/a" : s.dnsGatewayActive ? "yes" : "no"],
    ["Accepted ruleset / bundle / key", `${s.acceptedRulesetId ?? "n/a"} / v${s.acceptedBundleVersion ?? "?"} / ${s.acceptedKeyId ?? "n/a"}`],
    ["M1 protection bundle accepted", s.m1BundleAccepted === null ? "n/a (never attempted)" : s.m1BundleAccepted ? "yes" : "NO"],
    ["Internet continuity (non-test destination reachable)", s.internetContinuityOk === null ? "n/a (never attempted)" : s.internetContinuityOk ? "yes" : "NO — ordinary browsing would be broken"],
    ["Dedicated probe rule confirmed in bundle", s.probeRuleConfirmedInBundle === null ? "n/a" : s.probeRuleConfirmedInBundle ? "yes" : "NO"],
    ["Active native stack", s.activeNativeStackId ?? "n/a"],
    ["Supported ABIs / primary", `${s.supportedAbis.join(", ") || "n/a"} / ${s.primaryAbi ?? "n/a"}`],
    ["Private DNS runtime mode", s.privateDnsRuntimeMode],
    ["Private DNS server name (Strict only)", s.privateDnsServerName ?? "n/a"],
    ["Network transport", s.networkTransport ?? "n/a"],
    ["APK SHA-256 / debuggable", `${s.buildProvenance.apkSha256 ?? "n/a"} / ${s.buildProvenance.debuggable === null ? "n/a" : s.buildProvenance.debuggable}`],
    ["Captured at", s.capturedAt],
  ];
  const violationBanner = s.truthViolation.violated
    ? `<div style="border:2px solid #b91c1c;background:#fef2f2;padding:8px;border-radius:4px;margin:6px 0;font-size:11px;color:#7f1d1d"><strong>⚠ Truth-of-state violation:</strong> ${esc(s.truthViolation.reasons.join(" "))}</div>`
    : "";
  return `<h3>${esc(title)}</h3>${violationBanner}<table border="1" cellpadding="4" style="border-collapse:collapse;width:100%;font-size:10px">${rows.map(([k, v]) => `<tr><td style="font-weight:700">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
}

export function buildDnsCharacterizationHtml(run: DnsCharacterizationRun): string {
  const captured = run.records.filter((r) => r.classification === "CAPTURED").length;
  const bypassed = run.records.filter((r) => r.classification === "BYPASSED").length;
  const unobservable = run.records.filter((r) => r.classification === "UNOBSERVABLE").length;
  const notTestable = run.records.filter((r) => r.classification === "NOT_TESTABLE").length;
  return `<html><body style="font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#0b1220;font-size:13px">
<h1>Apollo — Out-of-band Private DNS / DoH Capability Characterization</h1>
<div style="border:2px solid #1d4ed8;background:#eff6ff;padding:14px;border-radius:6px;margin:16px 0;font-size:12px">
This is an OBSERVATIONAL characterization tool, completely separate from the frozen M2.1 Phase 6A acceptance harness.
It does not test, weaken, or re-run any M2.1 acceptance row, and carries no acceptance/freeze meaning of its own.
Every classification below is decided from directly observed evidence (the SDK's own validated security-event
stream, or the backend's independently server-verified nonce receipt for app-embedded DoH, which this app cannot
trigger or observe itself) -- never inferred from absence alone, and never from a manually-reported judgment call.
No mitigation or enforcement behavior was added, changed, or tested.
</div>
<p><strong>Run ID:</strong> ${esc(run.runId)} &nbsp; <strong>Started:</strong> ${esc(run.startedAt)}</p>
<p><strong>APK SHA-256:</strong> ${esc(run.buildProvenance?.apkSha256)} &nbsp; <strong>Commit/CI run:</strong> ${esc(run.buildProvenance?.gitSha)} / ${esc(run.buildProvenance?.ciRunId)}</p>
<p><strong>Device:</strong> ${esc(run.deviceProvenance?.manufacturer)} ${esc(run.deviceProvenance?.model)} · Android ${esc(run.deviceProvenance?.osRelease)} (SDK ${esc(run.deviceProvenance?.sdkInt)}) · patch ${esc(run.deviceProvenance?.securityPatch)}</p>

${truthSnapshotSection("Preflight — full automated truth-of-state snapshot", run.preflightSnapshot)}

<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:11px;margin-top:16px">
<thead><tr><th>Category</th><th>Configuration (machine-observed)</th><th>Probe host</th><th>Network</th><th>Saw plaintext UDP/53</th><th>Website Gate event</th><th>Independent success</th><th>Classification</th><th>Truth violation</th><th>Notes</th></tr></thead>
<tbody>${run.records.map(recordRow).join("") || `<tr><td colspan="10" style="color:#94a3b8">No probes recorded yet.</td></tr>`}</tbody>
</table>

<h3>Summary</h3>
<p style="font-size:12px">CAPTURED: ${captured} &nbsp; BYPASSED: ${bypassed} &nbsp; UNOBSERVABLE: ${unobservable} &nbsp; NOT_TESTABLE: ${notTestable}</p>

<h3>Future mitigation candidates (NOT implemented, NOT in scope this milestone)</h3>
<p style="font-size:11px;color:#475569">Any of: blocking port 853 (DoT) at the VPN layer, heuristic detection of encrypted-DNS-shaped traffic,
intercepting/MITM-ing DoH, or app-specific DoH-provider blocklists would be NEW security-enforcement behavior requiring
its own design + acceptance milestone (see docs/dns-capability-characterization.md). None of that is implemented,
changed, or tested by this tool.</p>

<p style="font-size:11px;color:#475569;margin-top:24px">Generated by the Apollo out-of-band DNS/DoH capability characterization tool
(frontend/src/diagnostics/). Enforcement stack under test: com.guarddog.* only.</p>
</body></html>`;
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

/** Native: writes a PDF file and returns its URI. Web: opens the browser print dialog, returns null. */
export async function exportDnsCharacterizationPdf(run: DnsCharacterizationRun): Promise<string | null> {
  const html = buildDnsCharacterizationHtml(run);
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return null;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const target = new File(Paths.document, `apollo-dns-doh-characterization-${run.runId}-${stamp(run.startedAt)}.pdf`);
  await new File(uri).move(target, { overwrite: true });
  return target.uri;
}

/** Writes the canonical JSON result next to the PDF (same run) for archival/evidence purposes. */
export async function exportDnsCharacterizationJson(run: DnsCharacterizationRun): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const target = new File(Paths.document, `apollo-dns-doh-characterization-${run.runId}-${stamp(run.startedAt)}.json`);
  target.write(buildDnsCharacterizationJson(run));
  return target.uri;
}
