import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import FileText from "lucide-react-native/icons/file-text";
import Info from "lucide-react-native/icons/info";
import Settings from "lucide-react-native/icons/settings";

import { Body, Card } from "@/src/components/ui";
import { hasLocalEvidence } from "@/src/domain/higginsNarration";
import type { PatrolEvent, PatrolRecord } from "@/src/domain/types";
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
  tableCard: { gap: 0 },
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
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  statusBadgeText: {
    fontFamily: fonts.textSemibold,
    fontSize: 12,
  },
  infoCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  infoTitle: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
    lineHeight: 20,
  },
  // Additional evidence card
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  detailIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  detailContent: { flex: 1 },
  detailTitle: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
  },
  detailSubtitle: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: c.onSurfaceSecondary,
  },
  // Expanded evidence section
  expandedSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.divider,
  },
  expandedSectionTitle: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    color: c.onSurface,
    marginTop: spacing.md,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  expandedRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  expandedLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    color: c.onSurface,
    width: 90,
  },
  expandedValue: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    flex: 1,
    lineHeight: 19,
  },
  refCard: {
    backgroundColor: c.surfaceTertiary,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: 2,
  },
  refLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    color: c.onSurface,
  },
  refUrl: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: c.onSurfaceSecondary,
  },
}));

/** Maps evidence provenance + category to an accurate source label. */
function sourceLabel(prov: string | undefined, category: string): string {
  // First try category-specific labels
  if (category === "website") {
    switch (prov) {
      case "local_device": return "Web content analysis (local)";
      case "dns_observation": return "DNS observation";
      case "server_projected": return "Server-synced summary";
      default: return "Web analysis";
    }
  }
  if (category === "call") {
    switch (prov) {
      case "local_device": return "Call metadata (local)";
      case "server_projected": return "Server-synced summary";
      default: return "Call analysis";
    }
  }
  if (category === "message") {
    switch (prov) {
      case "local_device": return "Message content (local)";
      case "server_projected": return "Server-synced summary";
      default: return "Message analysis";
    }
  }
  if (category === "device") {
    switch (prov) {
      case "local_device": return "Device settings (local)";
      case "server_projected": return "Server-synced summary";
      default: return "Device check";
    }
  }
  // Fallback
  switch (prov) {
    case "local_device": return "On-device evidence (local)";
    case "dns_observation": return "DNS observation";
    case "server_projected": return "Server-synced summary";
    default: return "Unknown";
  }
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case "website": return "Website check";
    case "call": return "Call check";
    case "message": return "Message check";
    case "device": return "Device security";
    default: return "Apollo check";
  }
}

/** Determines if there is additional evidence worth showing. */
function hasAdditionalEvidence(event: PatrolEvent): boolean {
  const record = event.patrol_record;
  const hasRefs = (event.supporting_references?.length ?? 0) > 0;
  const hasIndicator = !!(event.local_indicator || event.indicator_host);
  const hasDigest = !!event.indicator_digest;
  const hasScenario = !!(record?.scenarioContext?.scenario || record?.scenarioContext?.claimedBrand || record?.scenarioContext?.indicatorHost);
  const hasBriefingPoints = (record?.higginsBriefing?.evidence_points?.length ?? 0) > 0;
  const hasEnforcement = !!event.enforcement_evidence;
  return hasRefs || hasIndicator || hasDigest || hasScenario || hasBriefingPoints || hasEnforcement;
}

function ExpandedEvidence({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const record = event.patrol_record;
  const briefing = record?.higginsBriefing;
  const scenario = record?.scenarioContext;

  return (
    <View style={s.expandedSection}>
      {/* Indicator / URL details */}
      {(event.local_indicator || event.indicator_host) ? (
        <>
          <Text style={s.expandedSectionTitle}>Indicator details</Text>
          {event.local_indicator ? (
            <View style={s.expandedRow}>
              <Text style={s.expandedLabel}>URL</Text>
              <Text style={s.expandedValue} selectable>{event.local_indicator}</Text>
            </View>
          ) : null}
          {event.indicator_host ? (
            <View style={s.expandedRow}>
              <Text style={s.expandedLabel}>Domain</Text>
              <Text style={s.expandedValue} selectable>{event.indicator_host}</Text>
            </View>
          ) : null}
          {event.indicator_digest ? (
            <View style={s.expandedRow}>
              <Text style={s.expandedLabel}>Digest</Text>
              <Text style={s.expandedValue} selectable>{event.indicator_digest}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* Scenario context / brand impersonation */}
      {scenario && (scenario.scenario || scenario.claimedBrand || scenario.indicatorHost) ? (
        <>
          <Text style={s.expandedSectionTitle}>Scenario context</Text>
          {scenario.scenario ? (
            <View style={s.expandedRow}>
              <Text style={s.expandedLabel}>Scenario</Text>
              <Text style={s.expandedValue}>{scenario.scenario}</Text>
            </View>
          ) : null}
          {scenario.claimedBrand ? (
            <View style={s.expandedRow}>
              <Text style={s.expandedLabel}>Claimed brand</Text>
              <Text style={s.expandedValue}>{scenario.claimedBrand}</Text>
            </View>
          ) : null}
          {scenario.indicatorHost ? (
            <View style={s.expandedRow}>
              <Text style={s.expandedLabel}>Host</Text>
              <Text style={s.expandedValue} selectable>{scenario.indicatorHost}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* Verification findings from Higgins briefing evidence points */}
      {briefing && briefing.evidence_points.length > 0 ? (
        <>
          <Text style={s.expandedSectionTitle}>Verification findings</Text>
          {briefing.evidence_points.map((point, i) => (
            <View key={i} style={s.expandedRow}>
              <Text style={[s.expandedLabel, { width: 20 }]}>{"\u2022"}</Text>
              <Text style={s.expandedValue}>{point}</Text>
            </View>
          ))}
        </>
      ) : null}

      {/* Enforcement evidence */}
      {event.enforcement_evidence ? (
        <>
          <Text style={s.expandedSectionTitle}>Enforcement record</Text>
          {event.enforcement_evidence.mechanism ? (
            <View style={s.expandedRow}>
              <Text style={s.expandedLabel}>Mechanism</Text>
              <Text style={s.expandedValue}>{event.enforcement_evidence.mechanism}</Text>
            </View>
          ) : null}
          {event.enforcement_evidence.enforced_action ? (
            <View style={s.expandedRow}>
              <Text style={s.expandedLabel}>Action</Text>
              <Text style={s.expandedValue}>{event.enforcement_evidence.enforced_action}</Text>
            </View>
          ) : null}
          {event.enforcement_evidence.result ? (
            <View style={s.expandedRow}>
              <Text style={s.expandedLabel}>Result</Text>
              <Text style={s.expandedValue}>{event.enforcement_evidence.result}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* Supporting references */}
      {event.supporting_references && event.supporting_references.length > 0 ? (
        <>
          <Text style={s.expandedSectionTitle}>Supporting references</Text>
          {event.supporting_references.map((ref, i) => (
            <View key={i} style={s.refCard}>
              <Text style={s.refLabel}>{ref.label}</Text>
              <Text style={s.refUrl} selectable>{ref.url}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

export function EvidenceTab({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const isLocal = hasLocalEvidence(event);
  const record: PatrolRecord | undefined = event.patrol_record ?? undefined;
  const headline = event.headline ?? "Finding detected";
  const isActive = !event.resolved_at;
  const showAdditional = hasAdditionalEvidence(event);
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={s.content}>
      {/* Evidence tab card with header */}
      <Card style={{ gap: spacing.md }} testID="evidence-header-card">
        <View style={s.tabHeader}>
          <View style={[s.iconCircle, { backgroundColor: "#DBEAFE" }]}>
            <FileText size={22} color="#1E3A5F" />
          </View>
          <View>
            <Text style={s.tabTitle}>Evidence</Text>
            <Text style={s.tabSubtitle}>The facts behind this finding</Text>
          </View>
        </View>

        <Body>
          This section shows the actual information Apollo collected for this
          finding, including device settings and related details.
        </Body>

        {/* Alert finding */}
        <View
          style={[
            s.alertBanner,
            { backgroundColor: isActive ? colors.barkingTint : colors.restingTint },
          ]}
          testID="evidence-finding-alert"
        >
          <View style={[s.alertIcon, { backgroundColor: isActive ? colors.barking : colors.resting }]}>
            <CircleAlert size={16} color="#FFFFFF" />
          </View>
          <View style={s.alertContent}>
            <Text style={[s.alertTitle, { color: isActive ? colors.barkingText : colors.restingText }]}>
              {headline}
            </Text>
            <Text style={s.alertBody}>
              {record?.effectiveReason ?? event.what_happened ?? ""}
            </Text>
          </View>
        </View>
      </Card>

      {/* Detected setting table */}
      <Card style={s.tableCard} testID="evidence-detected-setting">
        <Text style={s.tableTitle}>Detected setting</Text>

        <View style={s.tableRow}>
          <Text style={s.tableLabel}>Setting</Text>
          <Text style={s.tableValue}>{headline}</Text>
        </View>

        <View style={s.tableRow}>
          <Text style={s.tableLabel}>Status</Text>
          <View style={{ flex: 1 }}>
            <View style={[s.statusBadge, { backgroundColor: isActive ? colors.barkingTint : colors.restingTint }]}>
              <Text style={[s.statusBadgeText, { color: isActive ? colors.barkingText : colors.restingText }]}>
                {isActive ? "Active" : "Resolved"}
              </Text>
            </View>
          </View>
        </View>

        <View style={s.tableRow}>
          <Text style={s.tableLabel}>Detected by</Text>
          <Text style={s.tableValue}>Apollo {categoryLabel(event.category)}</Text>
        </View>

        <View style={s.tableRow}>
          <Text style={s.tableLabel}>Date & time</Text>
          <Text style={s.tableValue}>
            {new Date(event.occurred_at).toLocaleString([], {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            })}
          </Text>
        </View>

        <View style={s.tableRowLast}>
          <Text style={s.tableLabel}>Source</Text>
          <Text style={s.tableValue}>{sourceLabel(event.evidence_provenance, event.category)}</Text>
        </View>
      </Card>

      {/* What this means */}
      <View
        style={[
          s.infoCard,
          { backgroundColor: "rgba(22,34,53,0.06)" },
        ]}
        testID="evidence-meaning"
      >
        <View style={[s.alertIcon, { backgroundColor: colors.info }]}>
          <Info size={16} color="#FFFFFF" />
        </View>
        <View style={s.alertContent}>
          <Text style={s.infoTitle}>What this means</Text>
          <Text style={s.alertBody}>
            {record?.summary ?? event.what_happened ?? ""}
          </Text>
        </View>
      </View>

      {/* Additional evidence — expandable card */}
      {showAdditional ? (
        <Card style={{ padding: 0 }} testID="evidence-additional">
          <Pressable
            testID="evidence-additional-toggle"
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Collapse additional evidence" : "Expand additional evidence"}
            onPress={() => setExpanded((v) => !v)}
          >
            <View style={s.detailRow}>
              <View style={[s.detailIcon, { backgroundColor: colors.surfaceTertiary }]}>
                <Settings size={18} color={colors.navyDeep} />
              </View>
              <View style={s.detailContent}>
                <Text style={s.detailTitle}>Additional evidence</Text>
                <Text style={s.detailSubtitle}>
                  View supporting records and verification details
                </Text>
              </View>
              {expanded ? (
                <ChevronUp size={20} color={colors.onSurfaceSecondary} />
              ) : (
                <ChevronDown size={20} color={colors.onSurfaceSecondary} />
              )}
            </View>
          </Pressable>
          {expanded ? <ExpandedEvidence event={event} /> : null}
        </Card>
      ) : null}
    </View>
  );
}
