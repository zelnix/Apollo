// The Deep Investigation (DI) report: Magnum DI's real processing record for one case — what was
// prepared for the Gemini boundary, what the provider (live Gemini or the preview simulator)
// returned, and the processing statistics. Shown as the DI tab on both the Threat Case screen and the
// Investigation Report. Evidence is never modified to build this view.

import * as Clipboard from "expo-clipboard";
import Copy from "lucide-react-native/icons/copy";
import { useEffect, useState } from "react";
import { Pressable, Share, Text, View } from "react-native";

import { apiGet } from "@/src/api/client";
import { Card } from "@/src/components/ui";
import { formatBytes, provenanceLabel, type DiTransaction } from "@/src/domain/diTransaction";
import { diRequestText, diResponseText } from "@/src/domain/diTransactionText";
import { useApollo } from "@/src/store/ApolloContext";
import { formatDateTime } from "@/src/domain/threatCase";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  content: { paddingHorizontal: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface, marginBottom: spacing.xs },
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
}));

/** One-tap copy (long-press to share) of exactly what this card shows. */
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
      showToast("Apollo couldn't copy to the clipboard on this device.", "growling");
    }
  };
  const share = async () => {
    try { await Share.share({ message: text, title: label }); }
    catch { showToast("Apollo couldn't open the share sheet on this device.", "growling"); }
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
      <Text style={[s.evidenceFieldLabel, { width: "auto", marginBottom: 4 }]}>{title}</Text>
      <Text style={[s.evidenceOriginalText, { fontSize: 12 }]} selectable>{body}</Text>
    </View>
  );
}

export function DiReport({ caseId }: { caseId: string | null }) {
  const s = useStyles();
  const [state, setState] = useState<{ loading: boolean; error: string | null; records: DiTransaction[] }>({
    loading: !!caseId, error: null, records: [],
  });

  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    apiGet<{ transactions: DiTransaction[] }>(`/investigations/${encodeURIComponent(caseId)}/di`)
      .then((data) => { if (alive) setState({ loading: false, error: null, records: data.transactions ?? [] }); })
      .catch((error: unknown) => {
        if (alive) setState({ loading: false, error: error instanceof Error ? error.message : "The DI record could not be read.", records: [] });
      });
    return () => { alive = false; };
  }, [caseId]);

  if (!caseId) {
    return (
      <View style={s.content}>
        <Card testID="tc-di-none">
          <Text style={s.sectionTitle}>No Deep Investigation</Text>
          <Text style={s.sourceSub}>
            Apollo settled this case with his own checks, so Magnum DI was never asked to investigate and there is no
            Deep Investigation transaction to show.
          </Text>
        </Card>
      </View>
    );
  }

  if (state.loading) {
    return <View style={s.content}><Card testID="tc-di-loading"><Text style={s.sourceSub}>Reading the Magnum DI record…</Text></Card></View>;
  }

  if (state.error) {
    return <View style={s.content}><Card testID="tc-di-error"><Text style={s.sectionTitle}>DI record unavailable</Text><Text style={s.sourceSub}>{state.error}</Text></Card></View>;
  }

  if (state.records.length === 0) {
    return (
      <View style={s.content}>
        <Card testID="tc-di-empty">
          <Text style={s.sectionTitle}>No transaction recorded</Text>
          <Text style={s.sourceSub}>This investigation has no recorded Magnum DI transaction on this device yet.</Text>
        </Card>
      </View>
    );
  }

  return (
    <View style={s.content} testID="tc-di-content">
      {state.records.map((record, index) => {
        const p = record.processing;
        const tokenNote = provenanceLabel(!!p.tokensAreSimulated, p.tokensAreEstimates);
        return (
          <View key={`${record.investigationId}-${index}`} style={{ gap: spacing.md }}>
            {record.notice ? (
              <View style={s.diNotice} testID={`tc-di-notice-${index}`}>
                <Text style={s.diNoticeText}>{record.notice}</Text>
              </View>
            ) : null}

            {record.simulated && !__DEV__ ? (
              <View style={s.diNotice} testID={`tc-di-simulator-warning-${index}`}>
                <Text style={s.diNoticeText}>
                  This record came from the preview simulator, not from Gemini. It is NOT a real investigation and
                  must not be relied on. Report this — the app is pointing at a preview backend.
                </Text>
              </View>
            ) : null}

            <Card testID={`tc-di-investigation-${index}`}>
              <Text style={s.sectionTitle}>Investigation</Text>
              <DiRow label="Investigation ID:" value={record.investigationId} />
              <DiRow label="Engine:" value={record.engine} />
              <DiRow label="Environment:" value={record.environment} />
              <DiRow label="Model requested:" value={record.modelRequested ?? "not recorded"} />
              <DiRow label="Call:" value={record.mode} note={record.simulated ? "No Gemini API call was made." : "A live Gemini API call was made."} />
              <DiRow label="Status:" value={record.failureCode ? `${record.status ?? "failed"} (${record.failureCode})` : record.status ?? "not recorded"} />
              <DiRow label="Date/time:" value={record.occurredAt ? formatDateTime(record.occurredAt) : "not recorded"} />
            </Card>

            <Card testID={`tc-di-request-${index}`}>
              <View style={s.cardHeader}>
                <Text style={[s.sectionTitle, { flex: 1, marginBottom: 0 }]}>Sent to Gemini</Text>
                <CardCopy text={diRequestText(record)} label="The request sent to Gemini" testID={`tc-di-request-copy-${index}`} />
              </View>
              <Text style={s.provenanceNote}>
                The actual final request produced at the Gemini boundary. Attachments are the post-redaction form that
                would be transmitted — originals are never shown here.
              </Text>
              <DiBlock testID={`tc-di-prompt-${index}`} title="Question and evidence sent" body={record.request.investigationPrompt || "not recorded"} />
              <DiRow label="Tools:" value={(record.request.tools ?? []).join(", ") || "none"} />
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
            </Card>

            <Card testID={`tc-di-response-${index}`}>
              <View style={s.cardHeader}>
                <Text style={[s.sectionTitle, { flex: 1, marginBottom: 0 }]}>{record.simulated ? "Simulator response" : "Gemini response"}</Text>
                <CardCopy text={diResponseText(record)} label={record.simulated ? "The simulator response" : "The Gemini response"} testID={`tc-di-response-copy-${index}`} />
              </View>
              <DiBlock testID={`tc-di-response-text-${index}`} title="Complete response" body={record.response.text || "not recorded"} />
              <DiRow label="Finish reason:" value={record.response.finishReason ?? "not recorded"} />
            </Card>

            <Card testID={`tc-di-processing-${index}`}>
              <Text style={s.sectionTitle}>Processing</Text>
              <DiRow label="Prompt tokens:" value={p.promptTokens == null ? "not recorded" : String(p.promptTokens)} note={tokenNote} />
              <DiRow label="Output tokens:" value={p.outputTokens == null ? "not recorded" : String(p.outputTokens)} note={tokenNote} />
              <DiRow label="Total tokens:" value={p.totalTokens == null ? "not recorded" : String(p.totalTokens)} note={tokenNote} />
              <DiRow label="Cached tokens:" value={p.cachedTokens == null ? "not recorded" : String(p.cachedTokens)} />
              <DiRow label="Cache status:" value={p.cacheStatus ?? "not recorded"} />
              <DiRow label="Attachments:" value={String(p.attachmentCount ?? 0)} />
              <DiRow label="Payload size:" value={formatBytes(p.requestBytes ?? null)} note="Measured" />
              <DiRow label="Duration:" value={p.durationMs == null ? "not recorded" : `${p.durationMs} ms`} note="Measured" />
              <DiRow label="Gemini calls:" value={String(p.geminiCalls ?? 0)} />
              <DiRow label="Retries:" value={String(p.retries ?? 0)} />
              <DiRow
                label="Cost:"
                value={p.cost?.amountUsd == null ? "not recorded" : `US$${p.cost.amountUsd.toFixed(6)}`}
                note={record.simulated
                  ? "Simulated — not Gemini billing. No Gemini API call was made."
                  : `${p.cost?.basis === "estimated" ? "Estimated" : "Recorded"} — ${p.cost?.note ?? ""}`}
              />
            </Card>
          </View>
        );
      })}
    </View>
  );
}

