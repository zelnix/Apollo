// Proof report export (JSON evidence + human-readable PDF). Built ONLY from what the harness
// actually observed: SDK events received, harness step results, enforcement stats, recovery snapshot.
// No browsing history or raw URLs are included; the only URL is the injected controlled endpoint.
// Files are written locally on the device (M1 boundary: no upload/archiving).
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import type { SecurityEvent } from "@/src/contracts/securityEventSchemas";
import type { HarnessResult, RecoveryEvidence } from "@/src/harness/androidBlockingProofHarness";
import type { BuildProvenance } from "@/src/harness/buildProvenance";
import type { M1Config } from "@/src/harness/ruleBundleFixtures";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";

export interface ProofReport {
  reportVersion: "m1-3";
  generatedAt: string;
  platform: string;
  nativeModuleAvailable: boolean;
  /** Exact artifact under test: installed APK SHA-256 (must equal CI apk-recheck.txt), commit and CI run id. */
  provenance: BuildProvenance | null;
  proofComplete: boolean;
  recoveryComplete: boolean;
  auditChain: {
    signedBundle: { rulesetId: string | null; bundleVersion: number | null; keyId: string | null; payloadHash: string | null };
    canonicalControlledHost: string;
    configuredControlledIpv4: string;
    routeActivation: { status: string; detail: string } | null;
    packetObservation: Record<string, number> | null;
    intentionalDrop: boolean;
    enforcementEvidenceId: string | null;
    securityEventId: string | null;
    bridgeReceipt: { type: "THREAT_BLOCKED"; source: string; occurredAt: string } | null;
    recovery: RecoveryEvidence | null;
  };
  steps: HarnessResult["steps"];
  events: Pick<SecurityEvent, "id" | "type" | "source" | "occurredAt" | "enforcementEvidenceId" | "protectionState" | "reason">[];
}

export function buildProofReport(
  config: M1Config,
  bundle: { rulesetId: string; bundleVersion: number; keyId: string; payloadHash: string } | null,
  result: HarnessResult,
  events: SecurityEvent[],
  provenance: BuildProvenance | null = null,
): ProofReport {
  const blocked = result.blockedEvent;
  // Captured by the harness before recovery (stopping clears the native drop reporter).
  const stats = result.enforcementStats;
  const start = result.steps.find((s) => s.id === "start") ?? null;
  return {
    reportVersion: "m1-3",
    generatedAt: new Date().toISOString(),
    platform: Platform.OS,
    nativeModuleAvailable: GuardDogSecuritySDK.nativeAvailable,
    provenance,
    proofComplete: result.proofComplete,
    recoveryComplete: result.recoveryComplete,
    auditChain: {
      signedBundle: { rulesetId: bundle?.rulesetId ?? null, bundleVersion: bundle?.bundleVersion ?? null, keyId: bundle?.keyId ?? null, payloadHash: bundle?.payloadHash ?? null },
      canonicalControlledHost: config.controlledEndpoint.host,
      configuredControlledIpv4: config.controlledEndpoint.ipv4,
      routeActivation: start ? { status: start.status, detail: start.detail } : null,
      packetObservation: stats,
      intentionalDrop: !!blocked && (stats?.droppedMatching ?? 0) > 0,
      enforcementEvidenceId: blocked?.enforcementEvidenceId ?? null,
      securityEventId: blocked?.id ?? null,
      bridgeReceipt: blocked ? { type: "THREAT_BLOCKED", source: blocked.source, occurredAt: blocked.occurredAt } : null,
      recovery: result.recovery,
    },
    steps: result.steps,
    events: events.map((e) => ({ id: e.id, type: e.type, source: e.source, occurredAt: e.occurredAt, enforcementEvidenceId: e.enforcementEvidenceId, protectionState: e.protectionState, reason: e.reason })),
  };
}

function esc(v: unknown): string {
  return String(v ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

export function reportToHtml(r: ProofReport): string {
  const chain = r.auditChain;
  const rows = [
    ["Signed bundle", `${esc(chain.signedBundle.rulesetId)} v${esc(chain.signedBundle.bundleVersion)}`],
    ["keyId", esc(chain.signedBundle.keyId)],
    ["payloadHash", esc(chain.signedBundle.payloadHash)],
    ["Canonical controlled host", esc(chain.canonicalControlledHost)],
    ["Configured dedicated IPv4", esc(chain.configuredControlledIpv4)],
    ["Route activation", chain.routeActivation ? `${esc(chain.routeActivation.status)} — ${esc(chain.routeActivation.detail)}` : "—"],
    ["Packet observation", chain.packetObservation ? esc(JSON.stringify(chain.packetObservation)) : "none observed"],
    ["Intentional drop", chain.intentionalDrop ? "yes" : "no"],
    ["enforcementEvidenceId", esc(chain.enforcementEvidenceId)],
    ["SecurityEvent id", esc(chain.securityEventId)],
    ["Bridge receipt", chain.bridgeReceipt ? `${chain.bridgeReceipt.type} via ${esc(chain.bridgeReceipt.source)} at ${esc(chain.bridgeReceipt.occurredAt)}` : "no THREAT_BLOCKED received"],
  ];
  const rec = chain.recovery;
  const recoveryRows = rec
    ? [
        ["stopProtection() requested", esc(rec.stopRequestedAt)],
        ["State after stop", `${esc(rec.stateAfterStop)}${rec.stateReason ? ` — ${esc(rec.stateReason)}` : ""}`],
        ["TUN descriptor closed", rec.tunOpen === null ? "unknown" : rec.tunOpen ? "NO (still open)" : "yes"],
        ["Selective route active", rec.selectiveRouteActive === null ? "unknown" : rec.selectiveRouteActive ? "YES (still active)" : "no"],
        ["OS VPN transport present", rec.vpnTransportPresent === null ? "unknown" : rec.vpnTransportPresent ? "YES" : "no"],
        ["HTTPS status after stop", esc(rec.httpsStatusAfterStop)],
        ["Recovered at", esc(rec.recoveredAt)],
      ]
    : [["Recovery", "not run (protection was never started)"]];
  const pv = r.provenance;
  const provenanceRows = pv
    ? [
        ["Installed APK SHA-256", esc(pv.apkSha256) + (pv.splitApks ? ` (+${pv.splitApks} split APKs)` : "")],
        ["Package / version", `${esc(pv.packageName)} ${esc(pv.versionName)} (${esc(pv.versionCode)})${pv.debuggable ? " · debuggable dev build" : ""}`],
        ["Git commit", esc(pv.gitSha)],
        ["CI workflow run id", esc(pv.ciRunId)],
      ]
    : [["Provenance", "unavailable"]];
  const table = (rows: string[][]) => `<table border="1" cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><th align="left">${k}</th><td>${v}</td></tr>`).join("")}</table>`;
  const steps = r.steps.map((s) => `<tr><td>${esc(s.status)}</td><td>${esc(s.title)}</td><td>${esc(s.detail)}</td></tr>`).join("");
  return `<html><body style="font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#0b1220">
<h1>Guard Dog — M1 Selective Block Proof</h1>
<p>Generated ${esc(r.generatedAt)} · platform ${esc(r.platform)} · native module ${r.nativeModuleAvailable ? "present" : "absent"}</p>
<h2 style="color:${r.proofComplete ? "#15803d" : "#b45309"}">${r.proofComplete ? "BLOCK PROOF COMPLETE" : "BLOCK PROOF INCOMPLETE — milestone remains open"}</h2>
<h2 style="color:${r.recoveryComplete ? "#15803d" : "#b45309"}">${r.recoveryComplete ? "RECOVERY PROOF COMPLETE" : "RECOVERY PROOF INCOMPLETE"}</h2>
<h3>Artifact provenance</h3>${table(provenanceRows)}
<h3>Audit chain</h3>${table(rows)}
<h3>Recovery chain</h3>${table(recoveryRows)}
<h3>Steps</h3><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Status</th><th>Step</th><th>Detail</th></tr>${steps}</table>
<p style="font-size:12px;color:#475569">Scope: Android selective /32 route to a Guard Dog-controlled dedicated IP only. No DNS interception, DoH/DoT, QUIC visibility, per-app attribution or universal protection claimed. No browsing history included.</p>
</body></html>`;
}

function stamp(r: ProofReport): string {
  return r.generatedAt.replace(/[:.]/g, "-");
}

/** Native: writes the JSON evidence file locally and returns its URI. Web: returns null (JSON shown in the UI). */
export async function exportReportJson(report: ProofReport): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const file = new File(Paths.document, `guarddog-m1-proof-${stamp(report)}.json`);
  file.write(JSON.stringify(report, null, 2));
  return file.uri;
}

/** Native: writes a PDF file and returns its URI. Web: opens the browser print dialog. */
export async function exportReportPdf(report: ProofReport): Promise<string | null> {
  const html = reportToHtml(report);
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return null;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const target = new File(Paths.document, `guarddog-m1-proof-${stamp(report)}.pdf`);
  await new File(uri).move(target, { overwrite: true });
  return target.uri;
}

/** Hands a local evidence file to the OS share sheet (the only way evidence leaves the device in M1). */
export async function shareEvidenceFile(uri: string): Promise<boolean> {
  if (Platform.OS === "web" || !(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri);
  return true;
}
