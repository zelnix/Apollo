// Gate Guard M2.1 Phase 6: fillable acceptance report builder + PDF export, mirroring
// docs/M2_PHASE6_ACCEPTANCE_TEMPLATE.md field-for-field. Captures RAW EVIDENCE only -- this file
// never computes or infers a PASS/FAIL/verdict; every result/verdict field here is exactly what the
// tester typed into the harness screen. See the frozen invariant printed at the top of the generated
// PDF (and of the template) before treating any row as acceptance evidence.
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import { Platform } from "react-native";

import { ANDROID_M2_DNS_COVERAGE_TAG, ANDROID_M2_DNS_VISIBILITY_SCOPE } from "@/src/contracts/shared/capabilities.ts";

export interface Phase6Provenance {
  branch: string;
  commitSha: string;
  ciRunId: string;
  ciRunUrl: string;
  jobNames: string;
  artifactNames: string;
  artifactDigests: string;
  buildSource: string;
  noDriftConfirmation: string;
  apkFilename: string;
  apkSha256: string;
  appVersion: string;
  buildNumber: string;
  architecture: string;
  activeNativeStackId: string;
  backendBranch: string;
  backendCommitSha: string;
  bitingInvariantConfirmed: string;
  rulesetId: string;
  bundleVersion: string;
  bundleKeyId: string;
  bundleSignatureState: string;
  sessionStartedAt: string;
}

export interface Phase6DeviceEnv {
  manufacturer: string;
  model: string;
  osRelease: string;
  securityPatch: string;
  permissionsBeforeTest: string;
  vpnStateBeforeTest: string;
  networkType: string;
  privateDnsSetting: string;
  recordedAt: string;
}

export interface Phase6TestSetup {
  testDomain: string;
  matchingRuleId: string;
  resolvedAt: string;
}

export interface Phase6EvidenceAttempt {
  label: string;
  dnsQueryObserved: string;
  decisionAndReason: string;
  sinkholeBinding: string;
  tunPacketObserved: string;
  intentionalDrop: string;
  evidenceRecord: string;
  evidenceId: string;
  threatBlockedEmitted: string;
  frontendCorrelation: string;
  bitingUiConsequence: string;
  stopRevokeResult: string;
  timestamps: string;
}

export type Phase6MatrixResult = "PASS" | "FAIL" | "CAPTURED" | "BYPASSED" | "UNOBSERVABLE" | "";

export interface Phase6MatrixRow {
  id: string;
  group: 1 | 2 | 3 | 4;
  test: string;
  result: Phase6MatrixResult;
  evidenceRef: string;
  notes: string;
}

export interface Phase6CapabilityGap {
  gap: string;
  observedImpact: string;
  disclosed: string;
}

export type Phase6Verdict = "PASS" | "FAIL" | "PASS WITH DOCUMENTED CAPABILITY GAP" | "";

export interface Phase6Report {
  provenance: Phase6Provenance;
  device: Phase6DeviceEnv;
  setup: Phase6TestSetup;
  attempts: Phase6EvidenceAttempt[];
  matrix: Phase6MatrixRow[];
  gaps: Phase6CapabilityGap[];
  verdict: Phase6Verdict;
  justification: string;
  testedCommitShaRepeat: string;
  completedBy: string;
  completedAt: string;
}

export const DEFAULT_PHASE6_MATRIX: Phase6MatrixRow[] = [
  { id: "1.1", group: 1, test: "Authorized blocked domain → full chain observed", result: "", evidenceRef: "", notes: "" },
  { id: "1.2", group: 1, test: "Repeat resolution of same domain within binding lifetime → consistent evidence", result: "", evidenceRef: "", notes: "" },
  { id: "2.1", group: 2, test: "Rule match alone (no packet ever transits TUN) does not emit THREAT_BLOCKED", result: "", evidenceRef: "", notes: "" },
  { id: "2.2", group: 2, test: "Manual local override / manual \"block\" UI tap does not emit THREAT_BLOCKED (local override is ALLOW-only)", result: "", evidenceRef: "", notes: "" },
  { id: "2.3", group: 2, test: "Local URL/domain analysis verdict alone, no VPN/enforcement active, does not emit THREAT_BLOCKED", result: "", evidenceRef: "", notes: "" },
  { id: "2.4", group: 2, test: "Website Gate starting (configure + accept bundle) alone, no matching traffic, does not emit THREAT_BLOCKED", result: "", evidenceRef: "", notes: "" },
  { id: "2.5", group: 2, test: "A failed/errored DNS forward (fail-open path) does not emit THREAT_BLOCKED", result: "", evidenceRef: "", notes: "" },
  { id: "3.1", group: 3, test: "Stop protection → status truthfully reports inactive, no further evidence/events generated", result: "", evidenceRef: "", notes: "" },
  { id: "3.2", group: 3, test: "Revoke VPN permission mid-session → app detects and reports truthfully, no silent fabricated active state", result: "", evidenceRef: "", notes: "" },
  { id: "3.3", group: 3, test: "App restart (kill + relaunch) → overrides rehydrate correctly, no orphaned biting UI state", result: "", evidenceRef: "", notes: "" },
  { id: "3.4", group: 3, test: "Network transition (wifi ↔ cellular) → protection status reported truthfully through the transition", result: "", evidenceRef: "", notes: "" },
  { id: "4.1", group: 4, test: "Private DNS OFF, authorized domain query → captured, full chain as Group 1", result: "", evidenceRef: "", notes: "" },
  { id: "4.2", group: 4, test: "Private DNS \"Automatic\" → record actual observed behavior (captured or bypassed)", result: "", evidenceRef: "", notes: "" },
  { id: "4.3", group: 4, test: "Private DNS explicit provider (e.g. dns.google) → confirm bypass, confirm no fabricated THREAT_BLOCKED", result: "", evidenceRef: "", notes: "" },
  { id: "4.4", group: 4, test: "App-embedded DoH → confirm query invisible to Apollo's DNS gateway, confirm no fabricated THREAT_BLOCKED", result: "", evidenceRef: "", notes: "" },
];

export const DEFAULT_PHASE6_GAPS: Phase6CapabilityGap[] = [
  { gap: "Private DNS (DoT) bypass", observedImpact: "", disclosed: `Yes -- ${ANDROID_M2_DNS_VISIBILITY_SCOPE}` },
  { gap: "App-embedded DoH bypass", observedImpact: "", disclosed: `Yes -- scope tag "${ANDROID_M2_DNS_COVERAGE_TAG}" (plaintext UDP/53 only)` },
];

export function emptyPhase6Provenance(): Phase6Provenance {
  return {
    branch: "", commitSha: "", ciRunId: "", ciRunUrl: "", jobNames: "", artifactNames: "", artifactDigests: "",
    buildSource: "", noDriftConfirmation: "", apkFilename: "", apkSha256: "", appVersion: "", buildNumber: "",
    architecture: "", activeNativeStackId: "", backendBranch: "", backendCommitSha: "", bitingInvariantConfirmed: "",
    rulesetId: "", bundleVersion: "", bundleKeyId: "", bundleSignatureState: "", sessionStartedAt: new Date().toISOString(),
  };
}

export function emptyPhase6Device(): Phase6DeviceEnv {
  return { manufacturer: "", model: "", osRelease: "", securityPatch: "", permissionsBeforeTest: "", vpnStateBeforeTest: "", networkType: "", privateDnsSetting: "", recordedAt: new Date().toISOString() };
}

function esc(v: unknown): string {
  return String(v ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

function table(rows: [string, string][]): string {
  return `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tbody>${rows.map(([k, v]) => `<tr><th align="left" style="width:38%;background:#f1f5f9">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
}

const RESULT_COLOR: Record<Phase6MatrixResult, string> = {
  PASS: "#15803d", FAIL: "#b91c1c", CAPTURED: "#15803d", BYPASSED: "#b45309", UNOBSERVABLE: "#b45309", "": "#64748b",
};

function matrixTable(rows: Phase6MatrixRow[], group: 1 | 2 | 3 | 4): string {
  const filtered = rows.filter((r) => r.group === group);
  const body = filtered
    .map(
      (r) =>
        `<tr><td>${esc(r.id)}</td><td>${esc(r.test)}</td><td style="color:${RESULT_COLOR[r.result]};font-weight:bold">${esc(r.result || "not run")}</td><td>${esc(r.evidenceRef)}</td><td>${esc(r.notes)}</td></tr>`,
    )
    .join("");
  return `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><thead><tr><th>#</th><th>Test</th><th>Result</th><th>Evidence ref</th><th>Notes</th></tr></thead><tbody>${body}</tbody></table>`;
}

function attemptTable(a: Phase6EvidenceAttempt): string {
  return table([
    ["Label", a.label],
    ["DNS query observed", a.dnsQueryObserved],
    ["Website Gate decision + reason", a.decisionAndReason],
    ["Sinkhole IP / binding created", a.sinkholeBinding],
    ["Packet observed at TUN enforcement layer", a.tunPacketObserved],
    ["Intentional packet drop", a.intentionalDrop],
    ["EnforcementEvidence record", a.evidenceRecord],
    ["enforcementEvidenceId", a.evidenceId],
    ["THREAT_BLOCKED emitted (matches evidence id?)", a.threatBlockedEmitted],
    ["Frontend Patrol/event correlation", a.frontendCorrelation],
    ["\"Apollo is biting\" UI consequence", a.bitingUiConsequence],
    ["Stop/revoke/recovery result (if exercised)", a.stopRevokeResult],
    ["Timestamps", a.timestamps],
  ]);
}

export function buildPhase6ReportHtml(r: Phase6Report): string {
  const p = r.provenance;
  const d = r.device;
  const s = r.setup;
  const verdictColor = r.verdict === "PASS" ? "#15803d" : r.verdict === "FAIL" ? "#b91c1c" : r.verdict === "PASS WITH DOCUMENTED CAPABILITY GAP" ? "#b45309" : "#64748b";
  const gapsRows = r.gaps.map((g) => `<tr><td>${esc(g.gap)}</td><td>${esc(g.observedImpact)}</td><td>${esc(g.disclosed)}</td></tr>`).join("");
  return `<html><body style="font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#0b1220;font-size:13px">
<h1>Apollo M2.1 — Phase 6 Gate Guard Android Physical-Device Acceptance Report</h1>
<div style="border:2px solid #b91c1c;background:#fef2f2;padding:14px;border-radius:6px;margin:16px 0">
<strong>FROZEN ACCEPTANCE INVARIANT:</strong> THREAT_BLOCKED is evidence-backed only. It requires an authorized destination,
a real packet observed by the enforcement layer, an intentional drop, an enforcement evidence record, and event emission
from that evidence path. No rule match or UI action alone may satisfy Phase 6 acceptance.
</div>
<h2 style="color:${verdictColor}">Overall verdict: ${esc(r.verdict || "NOT YET DETERMINED")}</h2>
<p><strong>Justification:</strong> ${esc(r.justification)}</p>
<p><strong>Tested commit SHA:</strong> ${esc(r.testedCommitShaRepeat)} &nbsp; <strong>Completed by:</strong> ${esc(r.completedBy)} &nbsp; <strong>At:</strong> ${esc(r.completedAt)}</p>

<h3>0. Provenance baseline</h3>
${table([
    ["Branch", p.branch], ["Exact commit SHA tested", p.commitSha], ["CI run ID", p.ciRunId], ["CI run URL", p.ciRunUrl],
    ["Job name(s)", p.jobNames], ["Artifact name(s)", p.artifactNames], ["Artifact digest(s)", p.artifactDigests],
    ["Build source", p.buildSource], ["No-drift confirmation (if fresh build)", p.noDriftConfirmation],
    ["APK filename", p.apkFilename], ["APK SHA-256", p.apkSha256], ["App version", p.appVersion], ["Build number", p.buildNumber],
    ["Architecture", p.architecture], ["Active Android native stack", p.activeNativeStackId],
    ["Backend branch", p.backendBranch], ["Backend commit SHA", p.backendCommitSha],
    ["Biting/Truth-of-State invariant confirmed present", p.bitingInvariantConfirmed],
    ["Ruleset/bundle ID", p.rulesetId], ["Bundle version", p.bundleVersion], ["Bundle signing key ID", p.bundleKeyId],
    ["Bundle signature state", p.bundleSignatureState], ["Session start timestamp", p.sessionStartedAt],
  ])}

<h3>1. Device &amp; environment</h3>
${table([
    ["Manufacturer", d.manufacturer], ["Model", d.model], ["Android OS version", d.osRelease], ["Security patch level", d.securityPatch],
    ["Permissions granted before test", d.permissionsBeforeTest], ["VPN state before test", d.vpnStateBeforeTest],
    ["Network type", d.networkType], ["Private DNS setting", d.privateDnsSetting], ["Recorded at", d.recordedAt],
  ])}

<h3>2. Test case setup</h3>
${table([["Authorized test domain/indicator", s.testDomain], ["Matching rule ID", s.matchingRuleId], ["Test domain resolved at", s.resolvedAt]])}

<h3>3. Evidence chain — per attempt</h3>
${r.attempts.map((a, i) => `<h4>Attempt ${i + 1}</h4>${attemptTable(a)}`).join("") || "<p>No attempts recorded yet.</p>"}

<h3>4. PASS/FAIL matrix</h3>
<h4>Group 1 — Positive enforcement</h4>${matrixTable(r.matrix, 1)}
<h4>Group 2 — Negative false-Biting</h4>${matrixTable(r.matrix, 2)}
<h4>Group 3 — Recovery / stop / revoke</h4>${matrixTable(r.matrix, 3)}
<h4>Group 4 — Private DNS / DoT / DoH</h4>${matrixTable(r.matrix, 4)}

<h3>5. Known capability gaps</h3>
<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><thead><tr><th>Gap</th><th>Observed impact</th><th>Disclosed in capability reporting?</th></tr></thead><tbody>${gapsRows}</tbody></table>

<p style="font-size:11px;color:#475569;margin-top:24px">Generated by the Apollo Native Gates Phase 6 harness screen. Enforcement stack under test: com.guarddog.* only —
com.hucentai.apollosecurity is a separate, independent native stack, not exercised by this report.</p>
</body></html>`;
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

/** Native: writes a PDF file and returns its URI (hand to shareEvidenceFile from proofReport.ts to
 * open the OS share sheet). Web: opens the browser print dialog, returns null. */
export async function exportPhase6ReportPdf(report: Phase6Report): Promise<string | null> {
  const html = buildPhase6ReportHtml(report);
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return null;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const target = new File(Paths.document, `apollo-m2.1-phase6-acceptance-${stamp(report.completedAt || new Date().toISOString())}.pdf`);
  await new File(uri).move(target, { overwrite: true });
  return target.uri;
}
