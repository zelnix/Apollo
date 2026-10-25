// The top card of a report, shared by Ask Higgins and a threat's Overview: what kind of check, its result and
// status, when, what the result means, who settled it and why, and when its files leave Apollo's server.
import React from "react";
import { Text, View } from "react-native";

import { OutcomeExplainerLink } from "@/src/components/OutcomeExplainerLink";
import { ServerCopyNote } from "@/src/components/ServerCopyNote";
import { SettledReasonLine } from "@/src/components/SettledReasonLine";
import type { CheckKind } from "@/src/components/report/checkKind";
import type { InvestigationCase, SettledReason } from "@/src/investigation/types";
import { fonts, makeStyles, radius, spacing } from "@/src/theme";

export interface ReportBadge { label: string; bg: string; fg: string; Icon?: React.ComponentType<{ size: number; color: string }>; testID?: string }

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 0.25, borderColor: c.border, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface, flex: 1 },
  subtitle: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontFamily: fonts.textSemibold, fontSize: 12 },
  meta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
}));

export function ReportHeader({ kind, subtitle, badges, time, meta, outcome, settledReason, serverCopyCaseId, liveCase, showServerCopy, testID, ids }: {
  kind: CheckKind;
  subtitle?: string | null;
  badges: ReportBadge[];
  time: string | null;
  /** Shown only when there is no result badge to say it. */
  meta?: string | null;
  outcome?: string | null;
  settledReason?: SettledReason | null;
  serverCopyCaseId?: string | null;
  liveCase?: InvestigationCase | null;
  showServerCopy: boolean;
  testID: string;
  ids: { explainer: string; settled: string; serverCopy: string };
}) {
  const s = useStyles();
  return (
    <View style={s.card} testID={testID}>
      <View style={s.row}>
        <View style={[s.iconWrap, { backgroundColor: kind.iconBg }]}><kind.Icon size={16} color={kind.iconColor} /></View>
        <Text style={s.title} testID={`${testID}-title`}>{kind.title}</Text>
      </View>
      {subtitle ? <Text style={s.subtitle} numberOfLines={1} testID={`${testID}-subtitle`}>{subtitle}</Text> : null}
      <View style={{ gap: 4 }}>
        {badges.length ? (
          <View style={s.badges}>
            {badges.map((b) => (
              <View key={b.label} style={[s.badge, { backgroundColor: b.bg }]} testID={b.testID} accessibilityLabel={b.label}>
                {b.Icon ? <b.Icon size={12} color={b.fg} /> : null}
                <Text style={[s.badgeText, { color: b.fg }]}>{b.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {time || meta ? (
          <View style={[s.row, { gap: spacing.md }]}>
            {time ? <Text style={s.meta} testID={`${testID}-time`}>{time}</Text> : null}
            {meta ? <Text style={s.meta}>{meta}</Text> : null}
          </View>
        ) : null}
        {outcome ? <OutcomeExplainerLink outcome={outcome} testID={ids.explainer} /> : null}
        <SettledReasonLine reason={settledReason} testID={ids.settled} />
        {showServerCopy ? <ServerCopyNote caseId={serverCopyCaseId} live={liveCase} testID={ids.serverCopy} /> : null}
      </View>
    </View>
  );
}
