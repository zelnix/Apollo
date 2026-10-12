import React from "react";
import { Text, View } from "react-native";

import { Body, Card, toneColor } from "@/src/components/ui";
import { hasLocalEvidence } from "@/src/domain/higginsNarration";
import type { PatrolEvent, PatrolRecord } from "@/src/domain/types";
import type { PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

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
  riskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  riskDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  riskLabel: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    color: c.onSurface,
  },
  scenarioCard: {
    gap: spacing.sm,
    backgroundColor: c.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  scenarioLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  scenarioValue: {
    fontFamily: fonts.textMedium,
    fontSize: 15,
    color: c.onSurface,
    lineHeight: 22,
  },
}));

function riskLevelLabel(state: string): string {
  switch (state) {
    case "resting":
      return "No concern";
    case "ears_up":
      return "Low risk — worth a look";
    case "growling":
      return "Medium risk — needs caution";
    case "barking":
      return "High risk — needs attention";
    case "biting":
      return "Confirmed threat — blocked";
    default:
      return "Assessed";
  }
}

export function InvestigationTab({
  event,
  outcome,
  shownWhatHappened,
}: {
  event: PatrolEvent;
  outcome: PatrolOutcome | null;
  shownWhatHappened: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const isIncomplete = !hasLocalEvidence(event);
  const record: PatrolRecord | undefined = event.patrol_record ?? undefined;
  const scenarioCtx = record?.scenarioContext;

  return (
    <View style={s.content}>
      {/* Risk level assessment */}
      <Card style={{ gap: spacing.md }} testID="investigation-risk-card">
        <Text style={s.sub}>Risk assessment</Text>
        <View style={s.riskRow}>
          <View
            style={[
              s.riskDot,
              { backgroundColor: toneColor(colors, event.state) },
            ]}
          />
          <Text style={s.riskLabel}>
            {riskLevelLabel(event.state)}
          </Text>
        </View>
        {record?.effectiveReason ? (
          <Body>{record.effectiveReason}</Body>
        ) : null}
      </Card>

      {/* What happened — the Magnum DI analysis */}
      <Card style={{ gap: spacing.sm }} testID="investigation-what-happened">
        <Text style={s.sub}>What happened</Text>
        <Text style={s.big} testID="event-what-happened">
          {shownWhatHappened}
        </Text>
        {!isIncomplete && event.local_indicator ? (
          <Text style={s.meta} selectable testID="event-indicator">
            {event.local_indicator}
          </Text>
        ) : event.indicator_host ? (
          <Text style={s.meta}>{event.indicator_host}</Text>
        ) : null}
      </Card>

      {/* Scenario context */}
      {scenarioCtx &&
      (scenarioCtx.scenario || scenarioCtx.claimedBrand) ? (
        <View style={s.scenarioCard} testID="investigation-scenario">
          {scenarioCtx.scenario ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={s.scenarioLabel}>Scenario</Text>
              <Text style={s.scenarioValue}>{scenarioCtx.scenario}</Text>
            </View>
          ) : null}
          {scenarioCtx.claimedBrand ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={s.scenarioLabel}>Claimed brand</Text>
              <Text style={s.scenarioValue}>
                {scenarioCtx.claimedBrand}
              </Text>
            </View>
          ) : null}
          {scenarioCtx.indicatorHost ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={s.scenarioLabel}>Host</Text>
              <Text style={s.scenarioValue}>
                {scenarioCtx.indicatorHost}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Caller info for call events */}
      {event.category === "call" &&
      (event as unknown as Record<string, unknown>).caller_meta
        ? (() => {
            const meta = (event as unknown as Record<string, unknown>)
              .caller_meta as {
              country?: string | null;
              carrier?: string | null;
              line_type?: string | null;
              voip?: boolean | null;
              fraud_score?: number | null;
              source?: string;
              identity_verified?: boolean;
            };
            return (
              <Card style={{ gap: spacing.sm }} testID="call-caller-info">
                <Text style={s.sub}>Number information</Text>
                {meta.country ? (
                  <Text style={s.big} testID="call-info-country">
                    Country: {meta.country}
                  </Text>
                ) : null}
                {meta.carrier ? (
                  <Text style={s.big} testID="call-info-carrier">
                    Carrier: {meta.carrier}
                  </Text>
                ) : null}
                {meta.line_type ? (
                  <Text style={s.big} testID="call-info-linetype">
                    Line type: {meta.line_type}
                    {meta.voip ? " (VOIP)" : ""}
                  </Text>
                ) : null}
                {meta.fraud_score != null ? (
                  <Text style={s.big} testID="call-info-score">
                    Fraud score: {meta.fraud_score}/100
                  </Text>
                ) : null}
                <Text style={s.meta} testID="call-info-identity">
                  {meta.identity_verified
                    ? "Caller identity verified"
                    : "Caller identity unverified \u2014 a displayed name does not authenticate the caller."}
                </Text>
                {meta.country ? (
                  <Text style={s.meta} testID="call-info-location-note">
                    The number\u2019s country does not confirm the caller\u2019s
                    actual location.
                  </Text>
                ) : null}
                {meta.source === "not_configured" ? (
                  <Text style={s.meta}>
                    Number reputation service not configured.
                  </Text>
                ) : meta.source ? (
                  <Text style={s.meta}>Source: {meta.source}</Text>
                ) : null}
              </Card>
            );
          })()
        : null}

      {/* Why action was taken — Magnum DI findings */}
      <Card style={{ gap: spacing.sm }} testID="investigation-findings">
        <Text style={s.sub}>Findings</Text>
        {(outcome?.whyThisRating ?? event.why).length === 0 ? (
          <Body>No specific warning signs were recorded.</Body>
        ) : (
          (outcome?.whyThisRating ?? event.why).map((w, i) => (
            <View key={i} style={s.bullet}>
              <View
                style={[
                  s.dot,
                  { backgroundColor: toneColor(colors, event.state) },
                ]}
              />
              <Body style={{ flex: 1 }}>{w}</Body>
            </View>
          ))
        )}
      </Card>

      {/* Conclusion */}
      {record?.summary ? (
        <Card style={{ gap: spacing.sm }} testID="investigation-conclusion">
          <Text style={s.sub}>Conclusion</Text>
          <Text style={s.big}>{record.summary}</Text>
        </Card>
      ) : null}
    </View>
  );
}
