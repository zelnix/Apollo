import React from "react";
import { Text, View } from "react-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import Info from "lucide-react-native/icons/info";
import Search from "lucide-react-native/icons/search";
import Settings from "lucide-react-native/icons/settings";

import { Body, Card, toneColor, toneText } from "@/src/components/ui";
import { EventActions } from "@/src/components/EventActions";
import { hasLocalEvidence } from "@/src/domain/higginsNarration";
import type { PatrolEvent, PatrolRecord } from "@/src/domain/types";
import type { PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  content: { gap: spacing.lg },
  // Tab header with icon
  tabHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  tabTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.onSurface,
  },
  tabSubtitle: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
  },
  sub: {
    fontFamily: fonts.display,
    fontSize: 12,
    color: c.onSurfaceSecondary,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  // Alert banner
  alertBanner: {
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  alertIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  alertContent: { flex: 1, gap: 4 },
  alertTitle: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    lineHeight: 20,
  },
  alertBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 19,
    color: c.onSurfaceSecondary,
  },
  // Key findings table
  tableCard: {
    gap: 0,
  },
  tableTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    color: c.onSurface,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    gap: spacing.md,
  },
  tableRowLast: {
    flexDirection: "row",
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  tableLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    color: c.onSurface,
    width: 100,
  },
  tableValue: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    flex: 1,
    lineHeight: 19,
  },
  // Risk badge
  riskBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  riskBadgeText: {
    fontFamily: fonts.textSemibold,
    fontSize: 12,
  },
  // Conclusion
  conclusionCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.onSurface,
  },
}));

function riskLabel(state: string): { label: string; tone: "resting" | "ears_up" | "growling" | "barking" } {
  switch (state) {
    case "resting": return { label: "Low", tone: "resting" };
    case "ears_up": return { label: "Medium", tone: "ears_up" };
    case "growling": return { label: "Medium", tone: "growling" };
    case "barking": return { label: "High", tone: "barking" };
    case "biting": return { label: "Critical", tone: "barking" };
    default: return { label: "Unknown", tone: "ears_up" };
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
  const record: PatrolRecord | undefined = event.patrol_record ?? undefined;
  const risk = riskLabel(event.state);
  const headline = event.headline ?? "Finding detected";

  return (
    <View style={s.content}>
      {/* Tab card with Magnum DI header */}
      <Card style={{ gap: spacing.md }} testID="investigation-magnum-card">
        {/* Header */}
        <View style={s.tabHeader}>
          <View style={[s.iconCircle, { backgroundColor: "#DBEAFE" }]}>
            <Search size={22} color="#1E3A5F" />
          </View>
          <View>
            <Text style={s.tabTitle}>Magnum DI probe</Text>
            <Text style={s.tabSubtitle}>Detailed analysis by Magnum DI</Text>
          </View>
        </View>

        {/* Investigation description */}
        <Body>{shownWhatHappened}</Body>

        {/* Investigation Result alert */}
        <View
          style={[
            s.alertBanner,
            { backgroundColor: colors.barkingTint },
          ]}
          testID="investigation-result-alert"
        >
          <View style={[s.alertIcon, { backgroundColor: colors.barking }]}>
            <CircleAlert size={16} color="#FFFFFF" />
          </View>
          <View style={s.alertContent}>
            <Text style={s.sub}>Probe result</Text>
            <Text style={[s.alertTitle, { color: colors.barkingText }]}>
              {headline}
            </Text>
            <Text style={s.alertBody}>
              {record?.effectiveReason ?? outcome?.resultBasis ?? ""}
            </Text>
          </View>
        </View>
      </Card>

      {/* Key findings table */}
      <Card style={s.tableCard} testID="investigation-findings">
        <Text style={s.tableTitle}>Key findings</Text>

        <View style={s.tableRow}>
          <Text style={s.tableLabel}>Finding</Text>
          <Text style={s.tableValue}>{headline}</Text>
        </View>

        <View style={s.tableRow}>
          <Text style={s.tableLabel}>Risk level</Text>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={[s.riskBadge, { backgroundColor: risk.tone === "resting" ? colors.restingTint : risk.tone === "barking" ? colors.barkingTint : colors.ears_upTint }]}>
              <Text style={[s.riskBadgeText, { color: toneText(colors, risk.tone) }]}>{risk.label}</Text>
            </View>
            <Info size={14} color={colors.onSurfaceSecondary} />
          </View>
        </View>

        {record?.effectiveReason ? (
          <View style={s.tableRow}>
            <Text style={s.tableLabel}>Impact</Text>
            <Text style={s.tableValue}>{record.effectiveReason}</Text>
          </View>
        ) : null}

        {(outcome?.whyThisRating ?? event.why).length > 0 ? (
          <View style={s.tableRow}>
            <Text style={s.tableLabel}>Compromise</Text>
            <Text style={s.tableValue}>
              {(outcome?.whyThisRating ?? event.why).join(". ")}
            </Text>
          </View>
        ) : null}

        {record?.scenarioContext?.scenario ? (
          <View style={s.tableRowLast}>
            <Text style={s.tableLabel}>Related finding</Text>
            <Text style={s.tableValue}>{record.scenarioContext.scenario}</Text>
          </View>
        ) : null}
      </Card>

      {/* Conclusion */}
      {record?.summary ? (
        <Card
          style={{ gap: spacing.md }}
          testID="investigation-conclusion"
        >
          <Text style={s.sectionTitle}>Conclusion</Text>
          <View
            style={[
              s.conclusionCard,
              { backgroundColor: "rgba(22,34,53,0.06)", borderRadius: radius.md },
            ]}
          >
            <View style={[s.alertIcon, { backgroundColor: colors.info }]}>
              <Info size={16} color="#FFFFFF" />
            </View>
            <View style={s.alertContent}>
              <Body>{record.summary}</Body>
            </View>
          </View>
        </Card>
      ) : null}

      {/* Recommended next step */}
      <Text style={s.sectionTitle}>Recommended next step</Text>
      <EventActions event={event} />
    </View>
  );
}
