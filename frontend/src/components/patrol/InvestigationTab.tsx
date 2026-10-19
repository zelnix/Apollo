import React from "react";
import { Text, View } from "react-native";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import Info from "lucide-react-native/icons/info";
import Search from "lucide-react-native/icons/search";

import { Body, Card, toneText } from "@/src/components/ui";
import { scrubMessage } from "@/src/domain/messageVoice";
import type { PatrolEvent, PatrolRecord } from "@/src/domain/types";
import type { PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  content: { gap: spacing.lg },
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
  sub: {
    fontFamily: fonts.display,
    fontSize: 12,
    color: c.onSurfaceSecondary,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  // Findings
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.onSurface,
  },
  findingCard: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  findingCardLast: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  findingText: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
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
  // Table row
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
  // Info card
  infoCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
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
  const briefing = record?.higginsBriefing;

  // Actual investigation findings from event.why[] — these are the Magnum DI findings
  const findings: string[] = (event.why ?? []).map((w) => scrubMessage(w)).filter(Boolean);

  // Risk reasoning: use effective reason or briefing meaning
  const effectiveReason = scrubMessage(record?.effectiveReason);
  const riskReasoning = effectiveReason && effectiveReason !== "synced from another device"
    ? effectiveReason
    : briefing?.meaning || "";

  // Checks performed: from scenario context
  const scope = record?.scenarioContext?.scenario && record.scenarioContext.scenario !== "shared_investigation"
    ? scrubMessage(record.scenarioContext.scenario)
    : null;

  return (
    <View style={s.content}>
      {/* Probe header */}
      <Card style={{ gap: spacing.md }} testID="probe-header-card">
        <View style={s.tabHeader}>
          <View style={[s.iconCircle, { backgroundColor: "#DBEAFE" }]}>
            <Search size={22} color="#1E3A5F" />
          </View>
          <View>
            <Text style={s.tabTitle}>Magnum DI probe</Text>
            <Text style={s.tabSubtitle}>Investigation findings and reasoning</Text>
          </View>
        </View>

        {/* Result banner */}
        <View
          style={[
            s.alertBanner,
            { backgroundColor: event.state === "resting" ? colors.restingTint : colors.barkingTint },
          ]}
          testID="probe-result-alert"
        >
          <View style={[s.alertIcon, { backgroundColor: event.state === "resting" ? colors.resting : colors.barking }]}>
            <CircleAlert size={16} color="#FFFFFF" />
          </View>
          <View style={s.alertContent}>
            <Text style={s.sub}>Probe result</Text>
            <Text style={[s.alertTitle, { color: event.state === "resting" ? colors.restingText : colors.barkingText }]}>
              {event.headline ?? "Finding detected"}
            </Text>
          </View>
        </View>

        {/* Risk level */}
        <View style={s.tableRow}>
          <Text style={s.tableLabel}>Risk level</Text>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={[s.riskBadge, { backgroundColor: risk.tone === "resting" ? colors.restingTint : risk.tone === "barking" ? colors.barkingTint : colors.ears_upTint }]}>
              <Text style={[s.riskBadgeText, { color: toneText(colors, risk.tone) }]}>{risk.label}</Text>
            </View>
          </View>
        </View>

        {scope ? (
          <View style={s.tableRowLast}>
            <Text style={s.tableLabel}>Scope</Text>
            <Text style={s.tableValue}>{scope}</Text>
          </View>
        ) : null}
      </Card>

      {/* ── Investigation Findings ── */}
      {findings.length > 0 ? (
        <Card style={{ gap: 0 }} testID="probe-findings">
          <Text style={s.sectionTitle}>Investigation findings</Text>
          {findings.map((finding, i) => (
            <View key={i} style={i === findings.length - 1 ? s.findingCardLast : s.findingCard}>
              <Text style={s.findingText}>{finding}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {/* ── Risk Reasoning ── */}
      {riskReasoning ? (
        <Card style={{ gap: spacing.sm }} testID="probe-reasoning">
          <Text style={s.sectionTitle}>Risk reasoning</Text>
          <Body>{riskReasoning}</Body>
        </Card>
      ) : null}

      {/* ── Claimed brand / indicator ── */}
      {(event.claimed_brand || event.indicator_host) ? (
        <Card style={{ gap: 0 }} testID="probe-indicators">
          <Text style={s.sectionTitle}>Indicators</Text>
          {event.indicator_host ? (
            <View style={s.tableRow}>
              <Text style={s.tableLabel}>Domain</Text>
              <Text style={s.tableValue} selectable>{event.indicator_host}</Text>
            </View>
          ) : null}
          {event.claimed_brand ? (
            <View style={s.tableRowLast}>
              <Text style={s.tableLabel}>Claimed brand</Text>
              <Text style={s.tableValue}>{event.claimed_brand}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* ── Conclusion ── */}
      {(record?.summary || briefing?.meaning) ? (
        <View
          style={[s.infoCard, { backgroundColor: "rgba(22,34,53,0.06)" }]}
          testID="probe-conclusion"
        >
          <View style={[s.alertIcon, { backgroundColor: colors.info }]}>
            <Info size={16} color="#FFFFFF" />
          </View>
          <View style={s.alertContent}>
            <Text style={[s.alertTitle, { color: colors.onSurface }]}>Conclusion</Text>
            <Text style={s.alertBody}>{scrubMessage(record?.summary || briefing?.meaning || "")}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
