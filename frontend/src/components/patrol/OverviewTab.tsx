import React from "react";
import { Text, View } from "react-native";

import { ClassBadge, classBorderColor } from "@/src/components/ClassBadge";
import { EventActions } from "@/src/components/EventActions";
import { Body, Button, Card, Pill, toneColor } from "@/src/components/ui";
import { looksLikeInternalCode } from "@/src/domain/messageVoice";
import { STATE_LABEL, STATE_MEANING } from "@/src/domain/types";
import type { HigginsBriefing, PatrolEvent } from "@/src/domain/types";
import type { PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useRouter } from "expo-router";
import { useApollo } from "@/src/store/ApolloContext";

const useStyles = makeStyles((c) => ({
  content: { gap: spacing.lg },
  sub: {
    fontFamily: fonts.display,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  big: {
    fontFamily: fonts.textMedium,
    fontSize: 16,
    lineHeight: 24,
    color: c.onSurface,
  },
  bullet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  sectionHeader: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    color: c.onSurface,
    letterSpacing: 0.3,
    marginBottom: spacing.xs,
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
  const router = useRouter();
  const { events } = useApollo();

  const briefing: HigginsBriefing | undefined = event.patrol_record?.higginsBriefing ?? undefined;
  const borderColor = briefing
    ? (classBorderColor(colors, briefing.record_class) ?? toneColor(colors, event.state))
    : toneColor(colors, event.state);

  return (
    <View style={s.content}>
      {/* Alert banner */}
      {focusFromAlert ? (
        <Card
          testID="event-from-alert"
          style={{ gap: 4, borderColor: toneColor(colors, event.state) }}
        >
          <Text style={s.sub}>Opened from your Apollo alert</Text>
          <Body>
            Here&apos;s exactly what Apollo flagged. The details below are this
            specific finding.
          </Body>
        </Card>
      ) : null}

      {/* Status pills row */}
      <View
        style={{
          flexDirection: "row",
          gap: spacing.sm,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <Pill
          tone={outcome?.state ?? event.state}
          label={outcome?.result ?? STATE_LABEL[event.state]}
          testID="event-state-pill"
        />
        {event.verified_block ? (
          <Pill
            tone={event.resolved_at ? "resting" : "biting"}
            label={event.resolved_at ? "Threat contained" : "Block verified"}
            testID="event-verified-pill"
          />
        ) : null}
        {event.patrol_record?.recordClass ? (
          <ClassBadge
            recordClass={event.patrol_record.recordClass}
            testID="event-class-badge"
          />
        ) : null}
        {isMock ? <Pill tone="unknown" label={event.adapter_label} /> : null}
      </View>

      {/* Result basis */}
      <Body>{outcome?.resultBasis ?? STATE_MEANING[event.state]}</Body>

      {/* Higgins Briefing card */}
      {briefing ? (
        <Card
          style={{
            gap: spacing.md,
            borderLeftWidth: 3,
            borderLeftColor: borderColor,
          }}
          testID="event-higgins-briefing"
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Text style={[s.sub, { fontSize: 14, letterSpacing: 0 }]}>
              Higgins&apos; briefing
            </Text>
            {event.patrol_record?.reassessment ? (
              <Text
                style={[s.meta, { fontSize: 10 }]}
                testID="event-reassessment-date"
              >
                Updated{" "}
                {new Date(
                  event.patrol_record.reassessment.reassessed_at
                ).toLocaleDateString([], { month: "short", year: "numeric" })}
              </Text>
            ) : null}
          </View>
          <Text style={[s.big, { lineHeight: 22 }]}>
            {briefing.investigated}
          </Text>
          <Text
            style={[s.big, { fontFamily: fonts.text, lineHeight: 22 }]}
          >
            {briefing.established}
          </Text>
          {briefing.evidence_points.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              {briefing.evidence_points.map((ep, i) => (
                <View key={i} style={s.bullet}>
                  <View
                    style={[
                      s.dot,
                      { backgroundColor: borderColor, marginTop: 6 },
                    ]}
                  />
                  <Body style={{ flex: 1 }}>{ep}</Body>
                </View>
              ))}
            </View>
          ) : null}
          <Text
            style={{
              fontFamily: fonts.textSemibold,
              fontSize: 14,
              lineHeight: 20,
              color: colors.onSurface,
            }}
          >
            {briefing.meaning}
          </Text>
          {briefing.action ? (
            <View
              style={{
                backgroundColor: colors.surfaceTertiary,
                borderRadius: radius.sm,
                padding: spacing.md,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.textSemibold,
                  fontSize: 14,
                  color: colors.onSurface,
                }}
                testID="event-briefing-action"
              >
                {briefing.action}
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* What to do */}
      <Card
        style={{
          gap: spacing.sm,
          borderColor: toneColor(
            colors,
            event.state === "biting" && event.resolved_at
              ? "resting"
              : event.state
          ),
        }}
      >
        <Text style={s.sub}>What to do</Text>
        <Text style={s.big} testID="event-what-to-do">
          {shownWhatToDo}
        </Text>
      </Card>

      {/* Actions */}
      <EventActions event={event} />

      {/* Connected incident */}
      {event.scent_id &&
      events.filter((e) => e.scent_id === event.scent_id).length > 1 ? (
        <Card style={{ gap: spacing.sm }} testID="event-incident-card">
          <Body>
            This event is part of a connected incident (
            {events.filter((e) => e.scent_id === event.scent_id).length} events).
          </Body>
          <Button
            testID="event-incident-open"
            variant="secondary"
            label="View incident timeline"
            onPress={() =>
              router.push({
                pathname: "/patrol/scent/[id]",
                params: { id: event.scent_id! },
              })
            }
          />
        </Card>
      ) : null}
    </View>
  );
}
