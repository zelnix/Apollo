import React from "react";
import { Text, View } from "react-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import FileText from "lucide-react-native/icons/file-text";
import Info from "lucide-react-native/icons/info";
import Settings from "lucide-react-native/icons/settings";

import { Body, Card, toneText } from "@/src/components/ui";
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
  // Table
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
  // Info card
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
  // Detail row button
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
}));

function provenanceLabel(prov: string | undefined): string {
  switch (prov) {
    case "local_device": return "Device settings (local)";
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

export function EvidenceTab({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const isLocal = hasLocalEvidence(event);
  const record: PatrolRecord | undefined = event.patrol_record ?? undefined;
  const headline = event.headline ?? "Finding detected";
  const isActive = !event.resolved_at;

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
          <Text style={s.tableValue}>{provenanceLabel(event.evidence_provenance)}</Text>
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

      {/* Profile details / Supporting references */}
      {(event.supporting_references && event.supporting_references.length > 0) ||
      (isLocal && event.local_indicator) ? (
        <Card style={{ padding: 0 }} testID="evidence-additional-details">
          <View style={s.detailRow}>
            <View style={[s.detailIcon, { backgroundColor: colors.surfaceTertiary }]}>
              <Settings size={18} color={colors.navyDeep} />
            </View>
            <View style={s.detailContent}>
              <Text style={s.detailTitle}>
                {isLocal ? "Additional details" : "Supporting references"}
              </Text>
              <Text style={s.detailSubtitle}>
                {isLocal
                  ? "Additional evidence about the detected finding."
                  : `${event.supporting_references?.length ?? 0} reference(s) available.`}
              </Text>
            </View>
            <ChevronRight size={20} color={colors.onSurfaceSecondary} />
          </View>
        </Card>
      ) : null}
    </View>
  );
}
