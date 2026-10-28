// The Deep Investigation (DI) tab: the complete, evidence-backed decision path for one case —
// Deterministic triage → TC FlyBy → Magnum DI → Higgins — then three sections, closed until tapped:
// Apollo's deterministic rules, what was sent to Magnum DI, and Magnum DI's response. Diagnostic view:
// internal codes are kept here (the Overview and Higgins translate them). The provider and model are
// never shown. Shown on both the Threat Case screen and the Investigation Report. Evidence is never
// modified to build this view.

import * as Clipboard from "expo-clipboard";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Copy from "lucide-react-native/icons/copy";
import React, { useEffect, useState } from "react";
import { Pressable, Share, Text, View } from "react-native";

import { apiGet } from "@/src/api/client";
import { SettledByBadge } from "@/src/components/SettledByBadge";
import { SettledReasonLine } from "@/src/components/SettledReasonLine";
import { TriageSummary } from "@/src/components/TriageSummary";
import { Card } from "@/src/components/ui";
import type { PatrolEvent } from "@/src/domain/types";
import type { SettledReason } from "@/src/investigation/types";
import { formatBytes, provenanceLabel, type DiTrace, type DiTransaction } from "@/src/domain/diTransaction";
import { diRequestText, diResponseText, toolList } from "@/src/domain/diTransactionText";
import { buildDecisionTrace, TRACE_ORDER, type TraceStatus, type TraceStep } from "@/src/domain/diTrace";
import { outcomeLabel as triageOutcomeLabel, type TriageInvestigationRecord } from "@/src/domain/triage/contract";
import { incompletePlain } from "@/src/domain/triage/completeness";
import { useApollo } from "@/src/store/ApolloContext";
import { formatDateTime } from "@/src/domain/threatCase";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  content: { paddingHorizontal: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface, marginBottom: spacing.xs },
  subTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface, marginTop: spacing.sm, marginBottom: 2 },
  sourceSub: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  evidenceFieldLabel: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.onSurfaceSecondary },
  evidenceFieldValue: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurface },
  evidenceOriginalContent: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xs },
  evidenceOriginalText: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurface },
  provenanceNote: { fontFamily: fonts.text, fontSize: 11, lineHeight: 15, color: c.onSurfaceSecondary, marginTop: 2 },
  diNotice: { borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: c.gold, backgroundColor: c.surfaceSecondary, padding: spacing.md },
  diNoticeText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  copyBtnText: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.onSurface },
  // Decision path
  stepRow: { flexDirection: "row", gap: spacing.md },
  stepRail: { width: 14, alignItems: "center" },
  stepDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  stepLine: { width: 2, flex: 1, backgroundColor: c.divider, marginTop: 4 },
  stepBody: { flex: 1, paddingBottom: spacing.md, gap: 4 },
  stepHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  stepName: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.textSemibold, fontSize: 11 },
  stepDetail: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary },
  // Closed sections
  section: { borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, backgroundColor: c.surface, overflow: "hidden" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: c.surfaceSecondary },
  sectionHeadTitle: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  sectionHeadSub: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: 2 },
  sectionBody: { padding: spacing.md, gap: spacing.xs },
  ruleRow: { paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 2 },
}));

/** One-tap copy (long-press to share) of exactly what this section shows. */
function CardCopy({ text, label, testID }: { text: string; label: string; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { showToast } = useApollo();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      showToast(`${label} copied. Paste it into an email, message or report.`, "neutral");
    } catch {
      showToast("ApolloSG couldn't copy to the clipboard on this device.", "growling");
    }
  };
  const share = async () => {
    try { await Share.share({ message: text, title: label }); }
    catch { showToast("ApolloSG couldn't open the share sheet on this device.", "growling"); }
  };
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label}`}
      accessibilityHint="Long press to share instead"
      onPress={() => void copy()}
      onLongPress={() => void share()}
      style={({ pressed }) => [s.copyBtn, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Copy size={14} color={colors.onSurface} />
      <Text style={s.copyBtnText}>{copied ? "Copied" : "Copy"}</Text>
    </Pressable>
  );
}

function DiRow({ label, value, note }: { label: string; value: string; note?: string }) {
  const s = useStyles();
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, paddingVertical: 3 }}>
      <Text style={[s.evidenceFieldLabel, { width: 132 }]}>{label}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.evidenceFieldValue} selectable>{value}</Text>
        {note ? <Text style={s.provenanceNote}>{note}</Text> : null}
      </View>
    </View>
  );
}

function DiBlock({ title, body, testID }: { title: string; body: string; testID: string }) {
  const s = useStyles();
  return (
    <View style={s.evidenceOriginalContent} testID={testID}>
      <Text style={[s.evidenceFieldLabel, { marginBottom: 4 }]}>{title}</Text>
      <Text style={[s.evidenceOriginalText, { fontSize: 12 }]} selectable>{body}</Text>
    </View>
  );
}

/** A section that starts closed; tapping the header opens it. */
function DiSection({ title, subtitle, testID, children }: { title: string; subtitle: string; testID: string; children: React.ReactNode }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={s.section} testID={testID}>
      <Pressable
        testID={`${testID}-toggle`}
        style={({ pressed }) => [s.sectionHead, { opacity: pressed ? 0.8 : 1 }]}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.sectionHeadTitle}>{title}</Text>
          <Text style={s.sectionHeadSub}>{subtitle}</Text>
        </View>
        {open ? <ChevronUp size={20} color={colors.muted} /> : <ChevronDown size={20} color={colors.muted} />}
      </Pressable>
      {open ? <View style={s.sectionBody} testID={`${testID}-body`}>{children}</View> : null}
    </View>
  );
}

type DiState = { loading: boolean; error: string | null; records: DiTransaction[]; trace: DiTrace | null };

/** The Magnum DI record(s) and decision path for one case, exactly as the server holds them — nothing
 *  filtered out. */
export function useDiTransactions(caseId: string | null): DiState {
  const [state, setState] = useState<DiState>({ loading: !!caseId, error: null, records: [], trace: null });

  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    apiGet<{ transactions: DiTransaction[]; trace?: DiTrace | null }>(`/investigations/${encodeURIComponent(caseId)}/di`)
      .then((data) => { if (alive) setState({ loading: false, error: null, records: data.transactions ?? [], trace: data.trace ?? null }); })
      .catch((error: unknown) => {
        if (alive) setState({ loading: false, error: error instanceof Error ? error.message : "The DI record could not be read.", records: [], trace: null });
      });
    return () => { alive = false; };
  }, [caseId]);

  return state;
}

// ── Decision path ───────────────────────────────────────────────────────────

function useStatusColors(): Record<TraceStatus, { dot: string; bg: string; fg: string }> {
  const { colors } = useTheme();
  const muted = { dot: colors.muted, bg: colors.surfaceSecondary, fg: colors.onSurfaceSecondary };
  return {
    ran: { dot: colors.brandPrimary, bg: colors.sniffingTint, fg: colors.sniffingText },
    settled: { dot: colors.restingText, bg: colors.restingTint, fg: colors.restingText },
    escalated: { dot: colors.ears_upText, bg: colors.ears_upTint, fg: colors.ears_upText },
    simulated: { dot: colors.gold, bg: colors.ears_upTint, fg: colors.ears_upText },
    failed: { dot: colors.barkingText, bg: colors.barkingTint, fg: colors.barkingText },
    not_engaged: muted, pending: muted, not_recorded: muted,
  };
}

function DecisionTrace({ steps, settled }: { steps: TraceStep[]; settled: React.ReactNode }) {
  const s = useStyles();
  const tones = useStatusColors();
  return (
    <Card testID="tc-di-trace">
      <Text style={s.sectionTitle}>Decision path</Text>
      {settled}
      <Text style={[s.provenanceNote, { marginBottom: spacing.md }]}>{TRACE_ORDER}</Text>
      {steps.map((step, i) => {
        const tone = tones[step.status];
        return (
          <View key={step.id} style={s.stepRow} testID={`tc-di-step-${step.id}`}>
            <View style={s.stepRail}>
              <View style={[s.stepDot, { backgroundColor: tone.dot }]} />
              {i < steps.length - 1 ? <View style={s.stepLine} /> : null}
            </View>
            <View style={s.stepBody}>
              <View style={s.stepHead}>
                <Text style={s.stepName}>{step.name}</Text>
                <View style={[s.pill, { backgroundColor: tone.bg }]}>
                  <Text style={[s.pillText, { color: tone.fg }]} testID={`tc-di-step-${step.id}-status`}>{step.label}</Text>
                </View>
              </View>
              <Text style={s.evidenceFieldValue} selectable testID={`tc-di-step-${step.id}-summary`}>{step.summary}</Text>
              {step.details.map((d, j) => <Text key={j} style={s.stepDetail} selectable>{d}</Text>)}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

// ── Apollo deterministic rules ───────────────────────────────────────────────

const RESULT_LABEL: Record<string, string> = { met: "MET", not_met: "NOT MET", coverage_gap: "COVERAGE GAP", not_applicable: "NOT APPLICABLE", routed: "ROUTED" };

function RulesBody({ triage, trace }: { triage: TriageInvestigationRecord | null; trace: DiTrace | null }) {
  const s = useStyles();
  const flyby = trace?.flyby;
  const applicable = triage?.rules.filter((r) => r.applicable) ?? [];
  const notApplicable = triage?.rules.filter((r) => !r.applicable) ?? [];
  return (
    <>
      <Text style={s.subTitle}>Triage rule catalogue</Text>
      {triage ? (
        <View testID="tc-di-rules-triage">
          <DiRow label="Outcome:" value={`${triage.outcome} — ${triageOutcomeLabel(triage)}`} />
          <DiRow label="Reason:" value={triage.reason || "not recorded"} />
          {(triage.incompleteChecks ?? []).map((c, i) => (
            <DiRow key={`incomplete-${i}`} label="Not completed:" value={`${c.check} · ${c.status}${c.failure ? ` (${c.failure})` : ""}`} note={incompletePlain(c)} />
          ))}
          <DiRow label="Rules:" value={`${triage.rulesChecked.length} of ${triage.rulesApplicable.length} applicable checked, ${triage.rulesMet.length} met`} />
          <DiRow label="Catalogue:" value={`v${triage.catalogueVersion} · source ${triage.sourceType}`} />
          <DiRow label="Investigation ID:" value={triage.investigationId} />
          <DiRow label="Evaluated:" value={triage.evaluatedAt ? formatDateTime(triage.evaluatedAt) : "not recorded"} />
          <DiRow label="Magnum DI calls:" value={String(triage.geminiCalls ?? 0)} note="Triage never engages Magnum DI." />
          {applicable.map((rule) => (
            <View key={rule.ruleId} style={s.ruleRow} testID={`tc-di-rule-${rule.ruleId}`}>
              <Text style={s.evidenceFieldValue} selectable>
                <Text style={{ fontFamily: fonts.textSemibold }}>{`${rule.ruleId} · ${RESULT_LABEL[rule.result] ?? rule.result}${rule.coverageGap ? ` (${rule.coverageGap})` : ""}`}</Text>
                {`\n${rule.title}`}
              </Text>
              {rule.evidence.map((e, i) => <Text key={i} style={s.stepDetail} selectable>{`• ${e}`}</Text>)}
              {rule.detail ? <Text style={s.stepDetail} selectable>{rule.detail}</Text> : null}
            </View>
          ))}
          {notApplicable.length ? <Text style={s.subTitle}>{`Not applicable (${notApplicable.length})`}</Text> : null}
          {notApplicable.map((rule) => (
            <View key={rule.ruleId} style={s.ruleRow} testID={`tc-di-rule-na-${rule.ruleId}`}>
              <Text style={s.evidenceFieldValue} selectable>
                <Text style={{ fontFamily: fonts.textSemibold }}>{`${rule.ruleId} · NOT APPLICABLE`}</Text>
                {`\n${rule.title}`}
              </Text>
              <Text style={s.stepDetail} selectable>{rule.evidence[0] || rule.detail || "Not applicable to this kind of item."}</Text>
            </View>
          ))}
          {triage.coverageGaps.length ? <Text style={s.subTitle}>Coverage gaps</Text> : null}
          {triage.coverageGaps.map((gap) => (
            <DiRow key={gap.code} label={`${gap.code}:`} value={gap.detail || "no detail recorded"}
              note={`${gap.recoverable ? "Recoverable — a re-check could help" : "Not recoverable"}${gap.ruleIds.length ? ` · rules ${gap.ruleIds.join(", ")}` : ""}`} />
          ))}
          {triage.retries.length ? <Text style={s.subTitle}>Retries</Text> : null}
          {triage.retries.map((r, i) => <DiRow key={i} label={`${r.check}:`} value={`${r.attempts} attempt(s) · ${r.outcome}`} />)}
        </View>
      ) : (
        <Text style={s.sourceSub} testID="tc-di-rules-triage-none">No deterministic Triage record is stored for this case.</Text>
      )}

      <Text style={s.subTitle}>TC FlyBy checks</Text>
      {flyby ? (
        <View testID="tc-di-rules-flyby">
          <DiRow label="Decision:" value={flyby.resolved ? `Settled · ${flyby.outcome ?? "outcome not recorded"} · basis ${flyby.basis ?? "not recorded"}` : "Escalated to Magnum DI"} />
          {trace?.settledReason ? <DiRow label="Settling rule:" value={`${trace.settledReason.ruleId} — ${trace.settledReason.rule}`} note={trace.settledReason.sentence} /> : null}
          <DiRow label="Message type:" value={flyby.messageType ?? "not recorded"} />
          <DiRow label="KB scam pattern:" value={flyby.pattern ? `${flyby.pattern.key} · ${flyby.pattern.stage} match` : "no match"} />
          <DiRow label="Web searches:" value={`${flyby.searchCalls ?? 0} call(s) · ${flyby.searchQueries ?? 0} queries · ${flyby.cacheHits ?? 0} from saved results`} />
          {flyby.checks.map((c, i) => (
            <DiRow key={i} label={`${c.kind}:`} value={`${c.status}${c.route ? ` · settled by ${c.route}` : ""}`} />
          ))}
          {(flyby.gaps ?? []).map((g, i) => <DiRow key={`gap-${i}`} label="Couldn't extract:" value={`${g.item} — ${g.what}`} />)}
        </View>
      ) : (
        <Text style={s.sourceSub} testID="tc-di-rules-flyby-none">TC FlyBy was not engaged for this case.</Text>
      )}
    </>
  );
}

// ── Sent to Magnum DI ────────────────────────────────────────────────────────

function SentBody({ records, trace, hasCase }: { records: DiTransaction[]; trace: DiTrace | null; hasCase: boolean }) {
  const s = useStyles();
  const flyby = trace?.flyby;
  const issues = flyby && !flyby.resolved ? flyby.issues ?? [] : [];
  return (
    <>
      {flyby && !flyby.resolved ? (
        <View testID="tc-di-sent-why">
          <Text style={s.subTitle}>Why it was escalated</Text>
          {trace?.settledReason?.by === "Magnum DI" ? <Text style={s.evidenceFieldValue} selectable>{trace.settledReason.sentence}</Text> : null}
          {issues.map((i, n) => <Text key={n} style={s.stepDetail} selectable>{`• Needs ${i.capability}: ${i.text}`}</Text>)}
        </View>
      ) : null}
      {records.length === 0 ? (
        <Text style={s.sourceSub} testID="tc-di-sent-none">
          {flyby?.resolved ? "Nothing was sent. Magnum DI was not engaged — TC FlyBy settled the case."
            : !hasCase ? "Nothing was sent. Magnum DI was not engaged."
              : "No Magnum DI request is recorded for this case."}
        </Text>
      ) : null}
      {records.map((record, index) => (
        <View key={`${record.investigationId}-${index}`} testID={`tc-di-request-${index}`} style={{ marginTop: spacing.sm }}>
          <View style={s.cardHeader}>
            <Text style={[s.subTitle, { flex: 1, marginTop: 0 }]}>{records.length > 1 ? `Request ${index + 1}` : "Request"}</Text>
            <CardCopy text={diRequestText(record)} label="The request sent to Magnum DI" testID={`tc-di-request-copy-${index}`} />
          </View>
          <Text style={s.provenanceNote}>
            The final request at the privacy boundary, after your personal information was removed. Attachments are the
            post-redaction form that was transmitted — originals are never shown here.
          </Text>
          <DiBlock testID={`tc-di-prompt-${index}`} title="Question and evidence sent" body={record.request.investigationPrompt || "not recorded"} />
          {trace?.magnum ? <DiRow label="Evidence items:" value={String(trace.magnum.itemsSent)} /> : null}
          <DiRow label="Tools:" value={toolList(record)} />
          <DiRow label="Attachments:" value={String(record.request.attachmentCount ?? 0)} />
          {(record.request.attachments ?? []).map((a, i) => (
            <View key={i} style={s.evidenceOriginalContent} testID={`tc-di-attachment-${index}-${i}`}>
              <DiRow label="Type:" value={a.mimeType} />
              <DiRow label="Size:" value={formatBytes(a.sizeBytes)} />
              {a.dimensions ? <DiRow label="Dimensions:" value={`${a.dimensions.width} × ${a.dimensions.height}`} /> : null}
              <DiRow label="Privacy screening:" value={a.privacyScreening} />
              <DiRow label="Redaction:" value={a.redactionStatus} />
              <DiRow label="Transmitted form:" value={a.transmittedForm} />
            </View>
          ))}
          <DiRow label="Payload size:" value={formatBytes(record.request.requestBytes ?? null)} />
        </View>
      ))}
    </>
  );
}

// ── Response from Magnum DI ──────────────────────────────────────────────────

function ResponseBody({ records, trace, hasCase }: { records: DiTransaction[]; trace: DiTrace | null; hasCase: boolean }) {
  const s = useStyles();
  if (records.length === 0) {
    return (
      <Text style={s.sourceSub} testID="tc-di-received-none">
        {trace?.flyby?.resolved || !hasCase ? "Magnum DI was not engaged, so there is no response." : "No Magnum DI response is recorded for this case."}
      </Text>
    );
  }
  return (
    <>
      {records.map((record, index) => {
        const p = record.processing;
        const tokenNote = provenanceLabel(!!p.tokensAreSimulated, p.tokensAreEstimates);
        return (
          <View key={`${record.investigationId}-${index}`} style={{ gap: spacing.xs, marginTop: index ? spacing.md : 0 }}>
            <View testID={`tc-di-investigation-${index}`}>
              <View style={s.cardHeader}>
                <Text style={[s.subTitle, { flex: 1, marginTop: 0 }]}>{records.length > 1 ? `Response ${index + 1}` : "Response"}</Text>
                <CardCopy text={diResponseText(record)} label={record.simulated ? "The simulator response" : "The response from Magnum DI"} testID={`tc-di-response-copy-${index}`} />
              </View>
              <DiRow label="Investigation ID:" value={record.investigationId} />
              <DiRow label="Engine:" value={record.engine} />
              <DiRow label="Environment:" value={record.environment} />
              <DiRow label="Mode:" value={record.mode} note={record.simulated ? "Magnum DI was engaged; the preview stood in for the outside service Magnum DI calls." : "Magnum DI was engaged."} />
              <DiRow label="Status:" value={record.failureCode ? `${record.status ?? "failed"} (${record.failureCode})` : record.status ?? "not recorded"} />
              <DiRow label="Date/time:" value={record.occurredAt ? formatDateTime(record.occurredAt) : "not recorded"} />
            </View>
            <View testID={`tc-di-response-${index}`}>
              <DiBlock testID={`tc-di-response-text-${index}`} title="Complete response" body={record.response.text || "not recorded"} />
              <DiRow label="Finish reason:" value={record.response.finishReason ?? "not recorded"} />
            </View>
            <View testID={`tc-di-processing-${index}`}>
              <Text style={s.subTitle}>Processing</Text>
              <DiRow label="Prompt tokens:" value={p.promptTokens == null ? "not recorded" : String(p.promptTokens)} note={tokenNote} />
              <DiRow label="Output tokens:" value={p.outputTokens == null ? "not recorded" : String(p.outputTokens)} note={tokenNote} />
              <DiRow label="Total tokens:" value={p.totalTokens == null ? "not recorded" : String(p.totalTokens)} note={tokenNote} />
              <DiRow label="Cached tokens:" value={p.cachedTokens == null ? "not recorded" : String(p.cachedTokens)} />
              <DiRow label="Cache status:" value={p.cacheStatus ?? "not recorded"} />
              <DiRow label="Attachments:" value={String(p.attachmentCount ?? 0)} />
              <DiRow label="Payload size:" value={formatBytes(p.requestBytes ?? null)} note="Measured" />
              <DiRow label="Duration:" value={p.durationMs == null ? "not recorded" : `${p.durationMs} ms`} note="Measured" />
              <DiRow label="Magnum DI calls:" value={String(p.geminiCalls ?? 0)} />
              <DiRow label="Retries:" value={String(p.retries ?? 0)} />
              <DiRow
                label="Cost:"
                value={p.cost?.amountUsd == null ? "not recorded" : `US$${p.cost.amountUsd.toFixed(6)}`}
                note={record.simulated
                  ? "Simulated — not billed. The preview stood in for the outside service Magnum DI calls."
                  : `${p.cost?.basis === "estimated" ? "Estimated" : "Recorded"} — ${p.cost?.note ?? ""}`}
              />
            </View>
          </View>
        );
      })}
    </>
  );
}

// ── The DI tab ──────────────────────────────────────────────────────────────

export function DiReport({ caseId, triage, settledReason, settledEvent, how }: {
  caseId: string | null;
  /** "How Apollo checked", in Higgins' plain words: the method behind the Findings Brief, kept here and not there. */
  how?: string[];
  triage?: TriageInvestigationRecord | null;
  /** The rule that settled the result, as this phone recorded it ("Settled by TC FlyBy — …"). */
  settledReason?: SettledReason | null;
  /** For results saved before the settling rule was recorded: who settled it, from the threat's record. */
  settledEvent?: Pick<PatrolEvent, "investigation_completed_at" | "investigation_answered_by"> | null;
}) {
  const s = useStyles();
  const state = useDiTransactions(caseId);

  if (!caseId && !triage) {
    return (
      <View style={s.content}>
        <Card testID="tc-di-none">
          <Text style={s.sectionTitle}>No decision record</Text>
          <Text style={s.sourceSub}>
            Apollo settled this case with his own checks. Magnum DI was not engaged, and no Triage, TC FlyBy or Magnum DI
            record is stored for it.
          </Text>
        </Card>
      </View>
    );
  }

  if (caseId && state.loading) {
    return <View style={s.content}><Card testID="tc-di-loading"><Text style={s.sourceSub}>Reading the decision record…</Text></Card></View>;
  }

  if (caseId && state.error) {
    return <View style={s.content}><Card testID="tc-di-error"><Text style={s.sectionTitle}>DI record unavailable</Text><Text style={s.sourceSub}>{state.error}</Text></Card></View>;
  }

  const hasCase = !!caseId;
  const triageRecord = state.trace?.triage ?? triage ?? null;
  const steps = buildDecisionTrace({ trace: state.trace, records: state.records, triage: triageRecord, hasCase });
  const rulesCount = triageRecord ? `${triageRecord.rules.filter((r) => r.applicable).length} rules · ${triageRecord.outcome}` : "No Triage record";
  const flybyNote = state.trace?.flyby ? ` · TC FlyBy ${state.trace.flyby.checks.length} check(s)` : "";
  const sentNote = state.records.length ? `${state.records.length} request(s) · ${state.records[0].mode}` : "Magnum DI was not engaged";
  // Who settled the result and by which rule: the phone's record, else the server's decision record.
  const reason = settledReason ?? state.trace?.settledReason ?? null;
  const settled = reason ? <SettledReasonLine reason={reason} testID="tc-di-settled-reason" />
    : settledEvent ? <SettledByBadge event={settledEvent} testID="tc-di-settled" /> : null;

  return (
    <View style={s.content} testID="tc-di-content">
      {/* Every record is shown in every build; a simulated one says so in its own Mode row below. */}
      {state.records.map((record, index) => record.notice && !record.simulated ? (
        <View key={index} style={s.diNotice} testID={`tc-di-notice-${index}`}>
          <Text style={s.diNoticeText}>{record.notice}</Text>
        </View>
      ) : null)}

      <DecisionTrace steps={steps} settled={settled} />

      {how?.length ? (
        <Card testID="tc-di-how">
          <Text style={s.sectionTitle}>How Apollo checked</Text>
          {how.map((line, i) => <Text key={`${i}-${line}`} style={s.sourceSub} testID={`tc-di-how-${i}`}>{line}</Text>)}
        </Card>
      ) : null}

      {/* How Apollo's own checks ran: what was checked, what couldn't be, and what that means. */}
      {triageRecord ? <TriageSummary record={triageRecord} /> : null}

      <DiSection testID="tc-di-rules" title="Apollo deterministic rules" subtitle={`${rulesCount}${flybyNote}`}>
        <RulesBody triage={triageRecord} trace={state.trace} />
      </DiSection>

      <DiSection testID="tc-di-sent" title="Sent to Magnum DI" subtitle={sentNote}>
        <SentBody records={state.records} trace={state.trace} hasCase={hasCase} />
      </DiSection>

      <DiSection testID="tc-di-received" title="Response from Magnum DI"
        subtitle={state.records.length ? (state.records[state.records.length - 1].status ?? "status not recorded") : "No response"}>
        <ResponseBody records={state.records} trace={state.trace} hasCase={hasCase} />
      </DiSection>
    </View>
  );
}
