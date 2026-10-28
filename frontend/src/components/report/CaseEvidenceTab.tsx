// The Threat Case Evidence tab, laid out as the approved mock-up:
//   Evidence summary → Evidence from this device → Investigation findings → Evidence trail → Copy / Share.
// Every line comes from domain/caseEvidence.ts (the case's own records). Source evidence and what TC FlyBy and
// Magnum DI found are kept in separate cards; nothing here re-decides a verdict or a status.
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleCheck from "lucide-react-native/icons/circle-check";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Info from "lucide-react-native/icons/info";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Network from "lucide-react-native/icons/network";
import Phone from "lucide-react-native/icons/phone";
import Search from "lucide-react-native/icons/search";
import Shield from "lucide-react-native/icons/shield";
import Smartphone from "lucide-react-native/icons/smartphone";
import Camera from "lucide-react-native/icons/camera";
import Wifi from "lucide-react-native/icons/wifi";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import React, { useMemo, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { CaseEvidenceProfile } from "@/src/components/CaseEvidenceProfile";
import { useDiTransactions } from "@/src/components/DiReport";
import { EvidenceArtefactCard } from "@/src/components/evidence/EvidenceArtefactCard";
import { caseEvidence, evidenceSummaryLine, EVIDENCE_STATUS_LABEL, type DeviceKind, type DevicePiece, type EvidenceStatus, type FindingPiece, type TrailStage } from "@/src/domain/caseEvidence";
import { RAISED_LABEL } from "@/src/domain/caseHistory";
import { heroWhen } from "@/src/domain/homeHeroBrief";
import { formatDateTime } from "@/src/domain/threatCase";
import type { PatrolEvent } from "@/src/domain/types";
import type { DeviceInvestigation } from "@/src/investigation/deviceStore";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Icon = React.ComponentType<{ size: number; color: string }>;
const KIND_ICON: Record<DeviceKind, Icon> = {
  message: MessageSquare, email: Mail, link: Globe, call: Phone, file: FileText, image: Camera, app: Smartphone,
  wifi: Wifi, device: Smartphone, block: Shield,
};

const useStyles = makeStyles((c) => ({
  content: { paddingHorizontal: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  // Cards
  summary: { flexDirection: "row", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: c.groupAccountsTint, borderWidth: 1, borderColor: c.border },
  card: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, gap: spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  headText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  sub: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  // Summary counts
  counts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  count: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  countText: { fontFamily: fonts.textSemibold, fontSize: 13 },
  // Rows
  rowWrap: { padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, gap: spacing.sm },
  row: { flexDirection: "row", gap: spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  rowTitle: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 20, color: c.onSurface },
  rowText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary },
  metaLabel: { fontFamily: fonts.textSemibold, color: c.onSurfaceSecondary },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.textSemibold, fontSize: 12 },
  detail: { gap: 4, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider },
  why: { fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 18, color: c.onSurface },
  link: { fontFamily: fonts.textMedium, fontSize: 12, lineHeight: 17, color: c.brandPrimary },
  // Trail
  trail: { flexDirection: "row", alignItems: "stretch", gap: 4 },
  stage: { flex: 1, minWidth: 0, flexDirection: "row", gap: 6, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.border },
  stageText: { flex: 1, minWidth: 0, gap: 2 },
  stageName: { fontFamily: fonts.textSemibold, fontSize: 13, lineHeight: 17, color: c.onSurface },
  stageMeta: { fontFamily: fonts.text, fontSize: 11, lineHeight: 15, color: c.onSurfaceSecondary },
  arrow: { justifyContent: "center" },
}));

function useStatusTone(): Record<EvidenceStatus | "contrary", { bg: string; fg: string; Icon: Icon }> {
  const { colors } = useTheme();
  return {
    verified: { bg: colors.restingTint, fg: colors.restingText, Icon: CircleCheck },
    supporting: { bg: colors.groupAccountsTint, fg: colors.groupAccounts, Icon: Info },
    unconfirmed: { bg: colors.unknownTint, fg: colors.onSurfaceSecondary, Icon: CircleCheck },
    contrary: { bg: colors.ears_upTint, fg: colors.ears_upText, Icon: CircleAlert },
  };
}

function StatusPill({ status, testID }: { status: EvidenceStatus | null; testID: string }) {
  const s = useStyles();
  const tone = useStatusTone()[status ?? "contrary"];
  return (
    <View style={[s.pill, { backgroundColor: tone.bg }]} testID={testID}>
      <tone.Icon size={13} color={tone.fg} />
      <Text style={[s.pillText, { color: tone.fg }]}>{status ? EVIDENCE_STATUS_LABEL[status] : "Points the other way"}</Text>
    </View>
  );
}

function CardHead({ icon: IconEl, bg, fg, title, sub }: { icon: Icon; bg: string; fg: string; title: string; sub: string }) {
  const s = useStyles();
  return (
    <View style={s.head}>
      <View style={[s.circle, { backgroundColor: bg }]}><IconEl size={22} color={fg} /></View>
      <View style={s.headText}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  const s = useStyles();
  return <Text style={s.meta} selectable><Text style={s.metaLabel}>{`${label}: `}</Text>{value}</Text>;
}

/** A row that opens in place, like the mock-up's chevron rows. */
function OpenRow({ icon: IconEl, iconBg, iconFg, title, status, testID, children, detail }: {
  icon: Icon; iconBg: string; iconFg: string; title: string; status: EvidenceStatus | null; testID: string;
  children: React.ReactNode; detail: React.ReactNode;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={s.rowWrap} testID={testID}>
      {/* Only the summary is the button, so the evidence opened under it keeps its own buttons. */}
      <Pressable style={({ pressed }) => [s.row, { opacity: pressed ? 0.85 : 1 }]} onPress={() => setOpen((v) => !v)}
        accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}. ${status ? EVIDENCE_STATUS_LABEL[status] : "Points the other way"}.`}
        accessibilityHint={open ? "Hides the full evidence" : "Shows the full evidence"} testID={`${testID}-toggle`}>
        <View style={[s.rowIcon, { backgroundColor: iconBg }]}><IconEl size={18} color={iconFg} /></View>
        <View style={s.rowBody}>
          <View style={s.rowTop}>
            <Text style={s.rowTitle}>{title}</Text>
            <StatusPill status={status} testID={`${testID}-status`} />
            {open ? <ChevronDown size={18} color={colors.muted} /> : <ChevronRight size={18} color={colors.muted} />}
          </View>
          {children}
        </View>
      </Pressable>
      {open ? <View style={s.detail} testID={`${testID}-detail`}>{detail}</View> : null}
    </View>
  );
}

function DeviceRow({ piece, index, event, facts }: { piece: DevicePiece; index: number; event: PatrolEvent; facts: string[] }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <OpenRow icon={KIND_ICON[piece.kind]} iconBg={colors.groupAccountsTint} iconFg={colors.groupAccounts} title={piece.name} status={piece.status}
      testID={`tc-evidence-device-${index}`}
      detail={<>
        <Text style={s.why}>{piece.why}</Text>
        {piece.primary && piece.id === "event" && facts.length ? <>
          <Text style={s.metaLabel}>What Apollo found</Text>
          {facts.map((line, i) => <Text key={`${i}-${line}`} style={s.meta} selectable testID={`tc-evidence-found-${i}`}>{`\u2022 ${line}`}</Text>)}
        </> : null}
        {piece.details.map((d, i) => <Meta key={`${d.label}-${i}`} label={d.label} value={d.value} />)}
        {/* The item itself, as it arrived, with the copy that was sent alongside it. */}
        {piece.primary ? (
          <EvidenceArtefactCard caseKeys={[event.event_id, event.investigation_case_id, event.patrol_record?.investigationCaseId]}
            packTitle={event.headline} packDate={event.occurred_at} phones={event.evidence_phones}
            packSummary={{ overview: event.what_happened || null, findings: event.why ?? [], steps: event.what_to_do ? [event.what_to_do] : [], uncertainties: [] }}
            testID="tc-evidence-artefact" />
        ) : null}
      </>}>
      <Text style={s.rowText}>{piece.description}</Text>
      <Meta label="Source" value={piece.source} />
      {piece.at ? <Meta label="Collected" value={formatDateTime(piece.at)} /> : null}
    </OpenRow>
  );
}

function FindingRow({ finding, index }: { finding: FindingPiece; index: number }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <OpenRow icon={Search} iconBg={colors.groupDataTint} iconFg={colors.groupData} title={`${finding.by} finding`} status={finding.status}
      testID={`tc-evidence-finding-${index}`}
      detail={<>
        <Text style={s.why}>{finding.why}</Text>
        <Meta label="How it was found" value={finding.basis} />
        {finding.confidence ? <Meta label="Confidence" value={`${finding.confidence[0].toUpperCase()}${finding.confidence.slice(1)}`} /> : null}
        {finding.raisedBy.map((r, i) => (
          <Meta key={`${i}-${r.text}`} label={RAISED_LABEL[r.from]} value={r.text} />
        ))}
        {finding.sources.map((src, i) => (
          <Pressable key={`${src.url}-${i}`} onPress={() => void Linking.openURL(src.url)} accessibilityRole="link" testID={`tc-evidence-finding-${index}-source-${i}`}>
            <Text style={s.link}>{`Source: ${src.title}`}</Text>
          </Pressable>
        ))}
      </>}>
      <Text style={s.rowText} selectable>{finding.text}</Text>
      <Meta label="Based on" value={finding.basedOn.length ? finding.basedOn.join(", ") : "not recorded"} />
      {finding.at ? <Meta label="Collected" value={formatDateTime(finding.at)} /> : null}
    </OpenRow>
  );
}

function Trail({ stages }: { stages: TrailStage[] }) {
  const s = useStyles();
  const { colors } = useTheme();
  const tone = {
    done: { bg: colors.surfaceSecondary, fg: colors.groupAccounts },
    escalated: { bg: colors.ears_upTint, fg: colors.ears_upText },
    failed: { bg: colors.barkingTint, fg: colors.barkingText },
    pending: { bg: colors.surfaceSecondary, fg: colors.muted },
  };
  return (
    <View style={s.trail} testID="tc-evidence-trail-stages">
      {stages.map((stage, i) => {
        const triage = stage.id === "triage" && stage.tone === "done";
        const t = triage ? { bg: colors.restingTint, fg: colors.restingText } : tone[stage.tone];
        const IconEl = triage ? CircleCheck : stage.tone === "failed" ? CircleAlert : Search;
        return (
          <React.Fragment key={stage.id}>
            {i ? <View style={s.arrow}><ChevronRight size={14} color={colors.muted} /></View> : null}
            <View style={[s.stage, { backgroundColor: t.bg }]} testID={`tc-evidence-trail-${stage.id}`}>
              <IconEl size={16} color={t.fg} />
              <View style={s.stageText}>
                <Text style={s.stageName}>{stage.name}</Text>
                <Text style={s.stageMeta}>{stage.at ? heroWhen(stage.at) : "Time not recorded"}</Text>
                <Text style={s.stageMeta} testID={`tc-evidence-trail-${stage.id}-status`}>{stage.status}</Text>
              </View>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

export function CaseEvidenceTab({ event, investigation, facts, footer }: {
  event: PatrolEvent; investigation: DeviceInvestigation | null;
  /** What Higgins Triage / Apollo recorded about the item. */
  facts: string[];
  /** Copy facts & sources · Share. */
  footer: React.ReactNode;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const tones = useStatusTone();
  const caseId = event.investigation_case_id ?? event.patrol_record?.investigationCaseId ?? null;
  const di = useDiTransactions(caseId);
  const ev = useMemo(() => caseEvidence({ event, investigation, trace: di.trace, records: di.records, facts }),
    [event, investigation, di.trace, di.records, facts]);

  return (
    <View style={s.content} testID="tc-evidence-tab">
      {/* 1. Evidence summary */}
      <View style={s.summary} testID="tc-evidence-summary">
        <View style={[s.circle, { backgroundColor: colors.surface }]}><FileText size={22} color={colors.groupAccounts} /></View>
        <View style={s.headText}>
          <Text style={s.title}>Evidence summary</Text>
          <Text style={s.sub} testID="tc-evidence-summary-line">{evidenceSummaryLine(ev)}</Text>
          <Text style={s.sub}>{ev.collectedFrom}</Text>
          <View style={s.counts}>
            {(["verified", "supporting", "unconfirmed"] as EvidenceStatus[]).map((status) => {
              const t = tones[status];
              return (
                <View key={status} style={[s.count, { backgroundColor: t.bg }]} testID={`tc-evidence-count-${status}`}>
                  <t.Icon size={14} color={t.fg} />
                  <Text style={[s.countText, { color: t.fg }]}>{`${ev.counts[status]} ${EVIDENCE_STATUS_LABEL[status]}`}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* 2. Evidence from this device */}
      <View style={s.card} testID="tc-evidence-device">
        <CardHead icon={Smartphone} bg={colors.restingTint} fg={colors.restingText} title="Evidence from this device" sub="Directly from your phone, tablet or computer" />
        {ev.device.map((piece, i) => <DeviceRow key={piece.id} piece={piece} index={i} event={event} facts={facts} />)}
        <CaseEvidenceProfile event={event} />
      </View>

      {/* 3. Investigation findings — only when TC FlyBy or Magnum DI actually answered. */}
      {ev.findings.length ? (
        <View style={s.card} testID="tc-evidence-findings">
          <CardHead icon={Search} bg={colors.groupAlertsTint} fg={colors.groupAlerts} title="Investigation findings" sub="Results from ApolloSG investigations" />
          {ev.findings.map((f, i) => <FindingRow key={f.id} finding={f} index={i} />)}
        </View>
      ) : null}

      {/* 4. Evidence trail — only the stages that happened. */}
      {ev.trail.length ? (
        <View style={s.card} testID="tc-evidence-trail">
          <CardHead icon={Network} bg={colors.groupDataTint} fg={colors.groupData} title="Evidence trail" sub="How evidence was used in this investigation" />
          <Trail stages={ev.trail} />
        </View>
      ) : null}

      {footer}
    </View>
  );
}
