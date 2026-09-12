// Gate Guard M2.1 Phase 6A: canonical JSON is the source of truth (Phase6RunState, produced entirely
// by phase6AutomatedHarness.ts's deterministic decision engine). This file ONLY renders that JSON --
// it never computes, infers, or overrides a single verdict field. If a number here disagrees with the
// JSON, the JSON wins; fix the renderer, not the other way round.
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import { Platform } from "react-native";

import type { Phase6RunState, Phase6StepResult, Phase6StepVerdict } from "@/src/harness/phase6AutomatedHarness";

const VERDICT_COLOR: Record<string, string> = {
  PASS: "#15803d",
  FAIL: "#b91c1c",
  PRECONDITION_FAILURE: "#b45309",
  CAPABILITY_GAP: "#b45309",
  UNOBSERVABLE: "#64748b",
  NOT_TESTABLE: "#64748b",
  PENDING: "#64748b",
  PASS_WITH_CAPABILITY_GAP: "#b45309",
};

function esc(v: unknown): string {
  return String(v ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

function verdictBadge(v: Phase6StepVerdict | string | null): string {
  const color = (v && VERDICT_COLOR[v]) || "#64748b";
  return `<span style="color:${color};font-weight:800">${esc(v ?? "PENDING")}</span>`;
}

function stepsTable(steps: Phase6StepResult[], group: 0 | 1 | 2 | 3 | 4): string {
  const rows = steps
    .filter((s) => s.group === group)
    .map(
      (s) =>
        `<tr><td>${esc(s.id)}</td><td>${esc(s.title)}</td><td>${verdictBadge(s.verdict)}</td><td>${esc(s.reasonCode)}</td><td>${esc(s.explanation)}</td><td style="font-size:10px;color:#64748b">${esc(s.startedAt)} → ${esc(s.completedAt)}</td></tr>`,
    )
    .join("");
  return `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr><th>#</th><th>Test</th><th>Verdict</th><th>Reason code</th><th>Explanation</th><th>Timing</th></tr></thead><tbody>${rows || `<tr><td colspan="6" style="color:#94a3b8">Not reached in this run.</td></tr>`}</tbody></table>`;
}

/** True only once the harness has actually reached "done" and settled on a verdict. A run that is
 * still mid-flight (e.g. paused on an "awaiting-*" tester action, or still running automated
 * phases) is NEVER final -- exporting it must always be clearly labelled interim, never presented
 * as an acceptance result. This is the single source of truth for that distinction; nothing else
 * in this file, or in the screen that calls it, decides completeness independently. */
export function isFinalRun(run: Phase6RunState): boolean {
  return run.phase === "done" && run.overallVerdict != null;
}

/** Canonical, machine-readable result for EXACTLY this run (by runId) -- never merged with, derived
 * from, or falling back to any other run's state (e.g. the separate legacy /phase6-acceptance manual
 * screen, which persists under an entirely different AsyncStorage key and report builder). Wrapped
 * with an explicit reportKind so a CI job or reviewer can never mistake an interim/incomplete run's
 * JSON for a final acceptance result just by glancing at it. Everything in the PDF is derived from
 * exactly this same wrapped object -- nothing more, nothing less. */
export function buildCanonicalResultJson(run: Phase6RunState): string {
  const wrapper = {
    reportKind: isFinalRun(run) ? "FINAL_ACCEPTANCE_RESULT" : "INTERIM_DIAGNOSTIC_ONLY",
    isFinal: isFinalRun(run),
    runId: run.runId,
    exportedAt: new Date().toISOString(),
    run,
  };
  return JSON.stringify(wrapper, null, 2);
}

export function buildPhase6AutomatedReportHtml(run: Phase6RunState): string {
  const totalSteps = run.steps.length;
  const passCount = run.steps.filter((s) => s.verdict === "PASS").length;
  const failCount = run.steps.filter((s) => s.verdict === "FAIL").length;
  const gapCount = run.steps.filter((s) => s.verdict === "CAPABILITY_GAP").length;
  const isFinal = isFinalRun(run);
  return `<html><body style="font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#0b1220;font-size:13px">
<h1>Apollo M2.1 — Phase 6A Automated Physical-Device Acceptance Report</h1>
${
    !isFinal
      ? `<div style="border:3px solid #b45309;background:#fffbeb;padding:14px;border-radius:6px;margin:16px 0">
<strong style="font-size:15px;color:#b45309">⚠ INCOMPLETE / INTERIM DIAGNOSTIC REPORT — NOT AN ACCEPTANCE VERDICT</strong>
<p style="margin:6px 0 0 0">Run ${esc(run.runId)} has not finished (current phase: <strong>${esc(run.phase)}</strong>). This export exists only to
help debug where the run currently stands. It carries NO acceptance meaning -- do not attach this to a release decision.
Re-run to completion (phase reaches "done" with a non-null overall verdict) and export again to get the final report.</p>
</div>`
      : ""
  }
<div style="border:2px solid #b91c1c;background:#fef2f2;padding:14px;border-radius:6px;margin:16px 0">
<strong>FROZEN ACCEPTANCE INVARIANT:</strong> THREAT_BLOCKED is evidence-backed only. It requires an authorized destination, a
real packet observed by the enforcement layer, an intentional drop, an enforcement evidence record, and event emission from
that evidence path. No rule match, DNS classification, failed request, UI action, or test helper may independently create a
verified block. A THREAT_BLOCKED result without a matching evidence ID forces a Truth-of-State FAIL, unconditionally.
</div>
<div style="border:2px solid #1d4ed8;background:#eff6ff;padding:14px;border-radius:6px;margin:16px 0;font-size:12px">
Every verdict in this report was decided by software from directly observed evidence (native protection/recovery state,
enforcement counters, and the SDK's own validated security-event stream) -- not typed or tapped by the tester. The tester
performed only the physical, OS-level actions Android does not let this app perform on itself (see the "tester actions"
section below); everything else was triggered and judged automatically.
</div>
<h2 style="color:${isFinal ? VERDICT_COLOR[run.overallVerdict ?? "PENDING"] : "#b45309"}">${isFinal ? `Overall verdict: ${verdictBadge(run.overallVerdict)}` : "Overall verdict: NOT YET AVAILABLE (run incomplete)"}</h2>
<p><strong>Reason code:</strong> ${esc(run.overallReasonCode)}<br/><strong>Explanation:</strong> ${esc(run.overallExplanation)}</p>
<p><strong>Run ID:</strong> ${esc(run.runId)} &nbsp; <strong>Started:</strong> ${esc(run.startedAt)} &nbsp; <strong>Completed:</strong> ${esc(run.completedAt)}</p>
<p><strong>Authorized test domain:</strong> ${esc(run.testDomain)} &nbsp; <strong>Matching rule ID:</strong> ${esc(run.matchingRuleId)}</p>
<p style="font-size:12px;color:#475569">Steps recorded: ${totalSteps} — PASS ${passCount}, FAIL ${failCount}, CAPABILITY_GAP ${gapCount}. Truth-of-State violation flag: ${esc(run.truthOfStateViolation)}.</p>

<h3>0. Preconditions (native module, VPN consent, protection ACTIVE, DNS gateway active, stale-override clearing)</h3>
${stepsTable(run.preconditions, 0)}

<h3>1. Positive enforcement</h3>
${stepsTable(run.steps, 1)}

<h3>2. Negative false-Biting</h3>
${stepsTable(run.steps, 2)}

<h3>3. Recovery / stop / revoke / restart / network transition</h3>
${stepsTable(run.steps, 3)}
<p style="font-size:11px;color:#475569">Rows 3.2 (VPN revoke), 3.3 (app restart), 3.4 (network transition) required one physical
OS-level action from the tester that Android does not let this app trigger on itself -- the harness detected completion of
each automatically and produced the verdict without any tester interpretation.</p>

<h3>4. DNS capability (Private DNS / DoT / DoH)</h3>
${stepsTable(run.steps, 4)}
<p style="font-size:11px;color:#475569">Android does not expose the device's actual Private DNS setting value to a
non-privileged app. These rows classify the CONSEQUENCE instead: CAPABILITY_GAP is only used when there is independent
evidence the connection succeeded via some path (a real HTTP response) while Apollo's own interception did not observe it --
never inferred from absence alone. DoH rows with no in-app trigger mechanism are marked NOT_TESTABLE, never guessed.</p>

<h3>Full run log</h3>
<pre style="font-size:10px;background:#f8fafc;padding:10px;border-radius:6px;white-space:pre-wrap">${esc(run.log.join("\n"))}</pre>

<p style="font-size:11px;color:#475569;margin-top:24px">Generated by the Apollo Native Gates Phase 6A automated harness. Enforcement stack under
test: com.guarddog.* only — com.hucentai.apollosecurity is a separate, independent native stack, not exercised by this report.
This PDF is a rendering of the canonical JSON result (same run ID) -- the JSON is the source of truth.</p>
</body></html>`;
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

/** Native: writes a PDF file and returns its URI. Web: opens the browser print dialog, returns null. */
export async function exportPhase6AutomatedReportPdf(run: Phase6RunState): Promise<string | null> {
  const html = buildPhase6AutomatedReportHtml(run);
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return null;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const suffix = isFinalRun(run) ? "" : "-INTERIM-DIAGNOSTIC";
  const target = new File(Paths.document, `apollo-m2.1-${run.runId}${suffix}-${stamp(run.completedAt || run.startedAt)}.pdf`);
  await new File(uri).move(target, { overwrite: true });
  return target.uri;
}

/** Writes the canonical JSON result next to the PDF (same run) for archival/CI-attachment purposes. */
export async function exportPhase6AutomatedResultJson(run: Phase6RunState): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const suffix = isFinalRun(run) ? "" : "-INTERIM-DIAGNOSTIC";
  const target = new File(Paths.document, `apollo-m2.1-${run.runId}${suffix}-${stamp(run.completedAt || run.startedAt)}.json`);
  target.write(buildCanonicalResultJson(run));
  return target.uri;
}
