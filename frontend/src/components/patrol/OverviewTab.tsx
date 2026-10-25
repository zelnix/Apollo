import React from "react";
import { Text, View } from "react-native";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Info from "lucide-react-native/icons/info";

import { EventActions } from "@/src/components/EventActions";
import { Body, Card } from "@/src/components/ui";
import { OriginalItemCard } from "@/src/components/patrol/OriginalItemCard";
import { scrubMessage } from "@/src/domain/messageVoice";
import type { HigginsBriefing, PatrolEvent } from "@/src/domain/types";
import type { PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { HigginsAvatar } from "@/src/components/HigginsAvatar";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useApollo } from "@/src/store/ApolloContext";
import { APP_VERSION, buildLabel } from "@/src/config/buildInfo";


const useStyles = makeStyles((c) => ({
  content: { gap: spacing.lg },
  // Higgins header row
  higginsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  higginsTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.onSurface,
  },
  higginsSubtitle: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
  },
  // Outcome banner
  bannerCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  bannerIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  bannerContent: { flex: 1, gap: 4 },
  bannerTitle: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    lineHeight: 20,
  },
  bannerBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 19,
  },
  divider: {
    height: 1,
    backgroundColor: c.divider,
  },
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.onSurface,
  },
  footer: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  buildInfo: {
    fontFamily: fonts.text,
    fontSize: 11,
    color: c.onSurfaceTertiary,
    textAlign: "center",
    paddingBottom: spacing.md,
  },
  // Briefing text
  briefingBody: {
    fontFamily: fonts.text,
    fontSize: 15,
    lineHeight: 22,
    color: c.onSurfaceSecondary,
  },
}));

export function OverviewTab({
  event,
  outcome,
  isMock,
  shownWhatToDo,
  focusFromAlert,
}: {
  event: PatrolEvent;
  outcome: PatrolOutcome | null;
  isMock: boolean;
  shownWhatToDo: string;
  focusFromAlert: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const { events } = useApollo();
  const briefing: HigginsBriefing | undefined = event.patrol_record?.higginsBriefing ?? undefined;
  const isResolved = !!event.resolved_at;

  return (
    <View style={s.content}>
      {/* ── Original Item Summary ── */}
      <OriginalItemCard event={event} />

      {/* ── Outcome / Risk banner ── */}
      {isResolved ? (
        <View
          style={[s.bannerCard, { backgroundColor: colors.restingTint }]}
          testID="briefing-outcome-banner"
        >
          <View style={[s.bannerIcon, { backgroundColor: colors.resting }]}>
            <CircleCheck size={16} color="#FFFFFF" />
          </View>
          <View style={s.bannerContent}>
            <Text style={[s.bannerTitle, { color: colors.restingText }]}>
              Resolved
            </Text>
            <Text style={[s.bannerBody, { color: colors.onSurfaceSecondary }]}>
              {scrubMessage(outcome?.resultBasis) ??
                `Resolved on ${event.resolved_at ? new Date(event.resolved_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "an earlier date"}.`}
            </Text>
          </View>
        </View>
      ) : (
        <View
          style={[s.bannerCard, { backgroundColor: colors.barkingTint }]}
          testID="briefing-outcome-banner"
        >
          <View style={[s.bannerIcon, { backgroundColor: colors.barking }]}>
            <Info size={16} color="#FFFFFF" />
          </View>
          <View style={s.bannerContent}>
            <Text style={[s.bannerTitle, { color: colors.barkingText }]}>
              {scrubMessage(outcome?.result) ?? "Needs attention"}
            </Text>
            <Text style={[s.bannerBody, { color: colors.onSurfaceSecondary }]}>
              {scrubMessage(outcome?.resultBasis) ?? "This finding has not been resolved yet."}
            </Text>
          </View>
        </View>
      )}

      {/* ── Conclusion: plain-English from Higgins briefing ── */}
      {briefing ? (
        <Card style={{ gap: spacing.sm }} testID="briefing-conclusion-card">
          <View style={s.higginsHeader}>
            <HigginsAvatar size={44} />
            <View>
              <Text style={s.higginsTitle}>What this means</Text>
              <Text style={s.higginsSubtitle}>In plain English</Text>
            </View>
          </View>
          <Text style={s.briefingBody}>{briefing.established}</Text>
          {briefing.meaning && briefing.meaning !== briefing.established ? (
            <Text style={s.briefingBody}>{briefing.meaning}</Text>
          ) : null}
        </Card>
      ) : event.what_happened ? (
        <Card style={{ gap: spacing.sm }} testID="briefing-conclusion-card">
          <Text style={s.sectionTitle}>What this means</Text>
          <Text style={s.briefingBody}>
            {scrubMessage(event.what_happened)}
          </Text>
        </Card>
      ) : null}

      <View style={s.divider} />

      {/* ── What to do ── */}
      <Text style={s.sectionTitle}>What you should do</Text>
      <Body>{shownWhatToDo}</Body>
      <EventActions event={event} hideAsk />

      {/* Connected incident */}
      {event.scent_id &&
      events.filter((e) => e.scent_id === event.scent_id).length > 1 ? (
        <Card style={{ gap: spacing.sm }} testID="event-incident-card">
          <Body>
            This event is part of a connected incident (
            {events.filter((e) => e.scent_id === event.scent_id).length} events).
          </Body>
        </Card>
      ) : null}

      {/* Footer */}
      <Text style={s.footer}>Together, Apollo and Higgins help you stay safer.</Text>
      <Text style={s.buildInfo}>v{APP_VERSION} · {buildLabel()}</Text>
    </View>
  );
}
