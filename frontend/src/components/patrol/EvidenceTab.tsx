import React from "react";
import { Pressable, Text, View } from "react-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import FileText from "lucide-react-native/icons/file-text";
import Info from "lucide-react-native/icons/info";
import MessageSquare from "lucide-react-native/icons/message-square";
import { useRouter } from "expo-router";

import { Body, Card } from "@/src/components/ui";
import { hasLocalEvidence } from "@/src/domain/higginsNarration";
import { scrubMessage } from "@/src/domain/messageVoice";
import { contextFromEvent, gateForCategory, openHigginsHandoff } from "@/src/domain/higginsHandoff";
import { caseForEvent } from "@/src/investigation/caseIndex";
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
  // Primary finding alert
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
  // Verification findings
  bullet: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  bulletDot: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    marginTop: 1,
    width: 14,
  },
  bulletText: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    flex: 1,
    lineHeight: 19,
  },
  // Reference card
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
  // Ask Higgins button
  askRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  askIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  askText: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
    flex: 1,
  },
}));

/** Maps evidence provenance + category to an accurate source label. */
function sourceLabel(prov: string | undefined, category: string): string {
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

/** Table row helper — only renders when value is truthy. */
function EvidenceRow({
  label,
  value,
  isLast,
  selectable,
}: {
  label: string;
  value: string | null | undefined;
  isLast?: boolean;
  selectable?: boolean;
}) {
  const s = useStyles();
  if (!value) return null;
  return (
    <View style={isLast ? s.tableRowLast : s.tableRow}>
      <Text style={s.tableLabel}>{label}</Text>
      <Text style={s.tableValue} selectable={selectable}>
        {value}
      </Text>
    </View>
  );
}

/** Maps raw effective_reason codes to plain-English descriptions. */
function humanReadableReason(reason: string | undefined | null): string {
  if (!reason) return "";
  return scrubMessage(reason);
}

/** Maps enforcement mechanism codes to readable descriptions. */
function humanReadableMechanism(mechanism: string | undefined | null): string {
  if (!mechanism) return "";
  const MAP: Record<string, string> = {
    dns_sinkhole: "DNS-level block (prevented the connection at network level)",
    content_policy: "Content policy filter (blocked by content safety rules)",
    firewall_rule: "Firewall rule (network traffic was filtered)",
    browser_interstitial: "Browser warning page (shown before the site loaded)",
    app_block: "App-level block (the app prevented the action)",
    packet_drop: "Network packet drop (connection was silently blocked)",
  };
  return MAP[mechanism] ?? mechanism.replace(/_/g, " ");
}

/** Maps enforcement action codes to readable descriptions. */
function humanReadableAction(action: string | undefined | null): string {
  if (!action) return "";
  const MAP: Record<string, string> = {
    blocked: "The connection or action was blocked",
    warned: "A warning was shown before proceeding",
    quarantined: "The item was quarantined for review",
    redirected: "The request was redirected to a safe destination",
    logged: "The event was logged for review",
  };
  return MAP[action] ?? action.replace(/_/g, " ");
}

/** Maps enforcement result codes to readable descriptions. */
function humanReadableResult(result: string | undefined | null): string {
  if (!result) return "";
  const MAP: Record<string, string> = {
    success: "Successfully enforced",
    partial: "Partially enforced — some elements may have loaded",
    failed: "Enforcement was attempted but did not complete",
    bypassed: "The block was bypassed by the user",
  };
  return MAP[result] ?? result.replace(/_/g, " ");
}

/** Maps confidence values to readable descriptions. */
function humanReadableConfidence(confidence: string | undefined | null): string {
  if (!confidence) return "";
  const MAP: Record<string, string> = {
    high: "High confidence — supported by multiple evidence sources",
    medium: "Medium confidence — based on available indicators",
    low: "Low confidence — limited evidence available",
    verified: "Verified — independently confirmed",
  };
  return MAP[confidence] ?? confidence.replace(/_/g, " ");
}

export function EvidenceTab({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const record: PatrolRecord | undefined = event.patrol_record ?? undefined;
  const briefing = record?.higginsBriefing;
  const scenario = record?.scenarioContext;
  const headline = event.headline ?? "Finding detected";
  const isActive = !event.resolved_at;

  // Collect all unique evidence rows for the details table
  const hasIndicator = !!(event.local_indicator || event.indicator_host);
  const hasScenario = !!(scenario?.scenario || scenario?.claimedBrand || scenario?.indicatorHost);
  const hasVerification = (briefing?.evidence_points?.length ?? 0) > 0;
  const hasRefs = (event.supporting_references?.length ?? 0) > 0;
  const hasEnforcement = !!event.enforcement_evidence;

  return (
    <View style={s.content}>
      {/* Tab header */}
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

        {/* Primary finding */}
        <View
          style={[
            s.alertBanner,
            { backgroundColor: isActive ? colors.barkingTint : colors.restingTint },
          ]}
          testID="evidence-primary-finding"
        >
          <View style={[s.alertIcon, { backgroundColor: isActive ? colors.barking : colors.resting }]}>
            <CircleAlert size={16} color="#FFFFFF" />
          </View>
          <View style={s.alertContent}>
            <Text style={[s.alertTitle, { color: isActive ? colors.barkingText : colors.restingText }]}>
              {headline}
            </Text>
            <Text style={s.alertBody}>
              {humanReadableReason(record?.effectiveReason) || scrubMessage(event.what_happened) || ""}
            </Text>
          </View>
        </View>
      </Card>

      {/* Evidence details — unified table */}
      <Card style={s.tableCard} testID="evidence-details">
        <Text style={s.tableTitle}>Evidence details</Text>

        <EvidenceRow label="Finding" value={headline} />

        {/* Status with badge — custom render */}
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

        <EvidenceRow label="Detected by" value={`Apollo ${categoryLabel(event.category)}`} />
        <EvidenceRow
          label="Date & time"
          value={new Date(event.occurred_at).toLocaleString([], {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}
        />
        <EvidenceRow label="Source" value={sourceLabel(event.evidence_provenance, event.category)} />

        {/* Indicator details — merged from Additional details */}
        {hasIndicator ? (
          <>
            <EvidenceRow label="URL" value={event.local_indicator} selectable />
            <EvidenceRow label="Domain" value={event.indicator_host} selectable />
            <EvidenceRow label="Digest" value={event.indicator_digest} selectable />
          </>
        ) : null}

        {/* Scenario context — merged from Additional details */}
        {hasScenario ? (
          <>
            {scenario?.scenario && scenario.scenario !== "shared_investigation" ? (
              <EvidenceRow label="Investigation scope" value={scrubMessage(scenario.scenario)} />
            ) : null}
            <EvidenceRow label="Claimed brand" value={scenario?.claimedBrand} />
            {/* Only show host if different from indicator_host already shown */}
            {scenario?.indicatorHost && scenario.indicatorHost !== event.indicator_host ? (
              <EvidenceRow label="Host" value={scenario.indicatorHost} selectable />
            ) : null}
          </>
        ) : null}

        {/* Enforcement details — human-readable */}
        {hasEnforcement && event.enforcement_evidence ? (
          <>
            <EvidenceRow label="Detection method" value={humanReadableMechanism(event.enforcement_evidence.mechanism)} />
            <EvidenceRow label="Action taken" value={humanReadableAction(event.enforcement_evidence.enforced_action)} />
            <EvidenceRow label="Outcome" value={humanReadableResult(event.enforcement_evidence.result)} />
            <EvidenceRow label="Confidence explained" value={humanReadableConfidence(event.enforcement_evidence.confidence)} />
          </>
        ) : null}

        {/* Freshness / observation times */}
        {record?.freshness?.observedAt ? (
          <EvidenceRow
            label="Observed"
            value={new Date(record.freshness.observedAt).toLocaleString([], {
              day: "numeric", month: "short", year: "numeric",
              hour: "numeric", minute: "2-digit",
            })}
          />
        ) : null}
        {event.resolved_at ? (
          <EvidenceRow
            label="Resolved"
            value={new Date(event.resolved_at).toLocaleString([], {
              day: "numeric", month: "short", year: "numeric",
              hour: "numeric", minute: "2-digit",
            })}
            isLast={!hasVerification && !hasRefs}
          />
        ) : null}
      </Card>

      {/* Verification findings — from Higgins evidence points */}
      {hasVerification ? (
        <Card style={{ gap: spacing.md }} testID="evidence-verification">
          <Text style={s.tableTitle}>Verification findings</Text>
          {briefing!.evidence_points.map((point, i) => (
            <View key={i} style={s.bullet}>
              <Text style={s.bulletDot}>{"\u2022"}</Text>
              <Text style={s.bulletText}>{point}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {/* Supporting references */}
      {hasRefs ? (
        <Card style={{ gap: spacing.md }} testID="evidence-references">
          <Text style={s.tableTitle}>Supporting references</Text>
          {event.supporting_references!.map((ref, i) => (
            <View key={i} style={s.refCard}>
              <Text style={s.refLabel}>{ref.label}</Text>
              <Text style={s.refUrl} selectable>{ref.url}</Text>
            </View>
          ))}
        </Card>
      ) : null}

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
            {scrubMessage(record?.summary || briefing?.meaning || event.what_happened || "")}
          </Text>
        </View>
      </View>

      {/* Ask Higgins to explain */}
      <Pressable
        testID="evidence-ask-higgins"
        accessibilityRole="button"
        accessibilityLabel="Ask Higgins to explain"
        onPress={() => {
          void caseForEvent(event.event_id, event.patrol_record?.investigationCaseId ?? null).then((caseId) =>
            openHigginsHandoff(
              router,
              { ...contextFromEvent(event, gateForCategory(event.category)), ...(caseId ? { case_id: caseId } : {}) },
              caseId ? "" : "Explain the evidence for this finding."
            )
          );
        }}
      >
        <Card style={{ padding: 0 }}>
          <View style={s.askRow}>
            <View style={[s.askIcon, { backgroundColor: colors.surfaceTertiary }]}>
              <MessageSquare size={18} color={colors.navyDeep} />
            </View>
            <Text style={s.askText}>Ask Higgins to explain</Text>
            <ChevronRight size={20} color={colors.onSurfaceSecondary} />
          </View>
        </Card>
      </Pressable>
    </View>
  );
}
