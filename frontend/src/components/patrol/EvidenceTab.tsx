import React from "react";
import { Linking, Pressable, Text, View } from "react-native";
import Camera from "lucide-react-native/icons/camera";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Info from "lucide-react-native/icons/info";
import Mail from "lucide-react-native/icons/mail";
import Phone from "lucide-react-native/icons/phone";
import Smartphone from "lucide-react-native/icons/smartphone";

import { Card } from "@/src/components/ui";
import type { PatrolEvent, PatrolRecord } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  content: { gap: spacing.lg },
  tabHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.xs,
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
  // Source header
  sourceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    marginBottom: spacing.sm,
  },
  sourceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceHeaderInfo: { flex: 1, gap: 2 },
  sourceHeaderTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  sourceHeaderMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  sourceHeaderMetaBold: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.onSurfaceSecondary },
  // Content block — original evidence preserved here
  sourceContentBlock: {
    backgroundColor: c.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border,
  },
  sourceContentText: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 22,
    color: c.onSurface,
  },
  // Link back to original
  sourceLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(46,158,107,0.08)",
    borderRadius: radius.sm,
    marginTop: spacing.xs,
  },
  sourceLinkText: {
    fontFamily: fonts.textMedium,
    fontSize: 13,
    color: "#2E9E6B",
    flex: 1,
  },
  // Table rows
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
  // Info card
  infoCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  infoBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 19,
    color: c.onSurfaceSecondary,
  },
  // Section title
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    color: c.onSurface,
    paddingBottom: spacing.sm,
  },
}));

// ── Source type detection and header building ─────────────────────────────────

type SourceType = "email" | "message" | "call" | "website" | "screenshot" | "file" | "app" | "device" | "generic";

function detectSourceType(event: PatrolEvent): SourceType {
  switch (event.category) {
    case "email": return "email";
    case "message": return "message";
    case "call": return "call";
    case "website": case "link": case "connection": return "website";
    case "device": return "device";
    case "file": return "file";
    case "app": return "app";
    default:
      // Infer from evidence
      if (event.local_indicator?.startsWith("http")) return "website";
      if (event.indicator_host) return "website";
      return "generic";
  }
}

interface SourceInfo {
  title: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
  iconBg: string;
  iconColor: string;
  metaLines: string[];
  originalUrl: string | null;
}

function buildSourceInfo(event: PatrolEvent, sourceType: SourceType): SourceInfo {
  const record: PatrolRecord | undefined = event.patrol_record ?? undefined;
  const meta: string[] = [];
  let originalUrl: string | null = null;

  // Extract URL from indicator
  if (event.local_indicator?.startsWith("http")) {
    originalUrl = event.local_indicator;
  }

  // Date/time
  const dt = new Date(event.occurred_at).toLocaleString([], {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  switch (sourceType) {
    case "email": {
      const subject = record?.scenarioContext?.claimedBrand
        ? `From: ${record.scenarioContext.claimedBrand}`
        : "Email";
      meta.push(subject, dt);
      return { title: "Email", Icon: Mail, iconBg: "#DBEAFE", iconColor: "#1E3A5F", metaLines: meta, originalUrl };
    }
    case "message": {
      if (event.indicator_host) meta.push(`From: ${event.indicator_host}`);
      meta.push(dt);
      return { title: "Message", Icon: Phone, iconBg: "rgba(212,120,10,0.15)", iconColor: "#D4780A", metaLines: meta, originalUrl };
    }
    case "call": {
      if (event.indicator_host) meta.push(`Number: ${event.indicator_host}`);
      meta.push(dt);
      return { title: "Call", Icon: Phone, iconBg: "rgba(212,120,10,0.15)", iconColor: "#D4780A", metaLines: meta, originalUrl };
    }
    case "website": {
      const domain = event.indicator_host ?? (originalUrl ? (() => { try { return new URL(originalUrl).hostname; } catch { return ""; } })() : "");
      meta.push(domain || "Website");
      if (originalUrl) meta.push(originalUrl);
      meta.push(dt);
      return { title: domain || "Website", Icon: Globe, iconBg: "#DBEAFE", iconColor: "#1E3A5F", metaLines: meta.filter(Boolean), originalUrl };
    }
    case "screenshot": {
      meta.push("User screenshot", dt);
      return { title: "Screenshot", Icon: Camera, iconBg: "rgba(212,120,10,0.15)", iconColor: "#D4780A", metaLines: meta, originalUrl: null };
    }
    case "file": {
      meta.push(dt);
      return { title: "File", Icon: FileText, iconBg: "#E4F0E8", iconColor: "#2E7D32", metaLines: meta, originalUrl: null };
    }
    case "app": {
      if (record?.scenarioContext?.claimedBrand) meta.push(`App: ${record.scenarioContext.claimedBrand}`);
      meta.push(dt);
      return { title: "App", Icon: Smartphone, iconBg: "#DBEAFE", iconColor: "#1E3A5F", metaLines: meta, originalUrl: null };
    }
    case "device": {
      meta.push(dt);
      return { title: "Device check", Icon: Smartphone, iconBg: "#DBEAFE", iconColor: "#1E3A5F", metaLines: meta, originalUrl: null };
    }
    default: {
      meta.push(dt);
      return { title: "Evidence", Icon: FileText, iconBg: "#DBEAFE", iconColor: "#1E3A5F", metaLines: meta, originalUrl: null };
    }
  }
}

function EvidenceRow({ label, value, isLast, selectable }: { label: string; value: string | null | undefined; isLast?: boolean; selectable?: boolean }) {
  const s = useStyles();
  if (!value) return null;
  return (
    <View style={isLast ? s.tableRowLast : s.tableRow}>
      <Text style={s.tableLabel}>{label}</Text>
      <Text style={s.tableValue} selectable={selectable}>{value}</Text>
    </View>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function EvidenceTab({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const record: PatrolRecord | undefined = event.patrol_record ?? undefined;
  const sourceType = detectSourceType(event);
  const sourceInfo = buildSourceInfo(event, sourceType);
  const IconEl = sourceInfo.Icon;
  const hasRefs = (event.supporting_references?.length ?? 0) > 0;

  return (
    <View style={s.content}>
      {/* Section header */}
      <Card style={{ gap: spacing.xs }} testID="evidence-header-card">
        <Text style={s.sectionTitle}>SOURCE EVIDENCE</Text>
        <Text style={s.infoBody}>
          The original material ApolloSG relied on for this investigation. Content is preserved unaltered.
        </Text>
      </Card>

      {/* ── Source Header + Original Content ── */}
      <Card style={{ gap: spacing.sm }} testID="evidence-source-card">
        {/* Source type header */}
        <View style={s.sourceHeader}>
          <View style={[s.sourceIconWrap, { backgroundColor: sourceInfo.iconBg }]}>
            <IconEl size={20} color={sourceInfo.iconColor} />
          </View>
          <View style={s.sourceHeaderInfo}>
            <Text style={s.sourceHeaderTitle}>{sourceInfo.title}</Text>
            {sourceInfo.metaLines.map((line, i) => (
              <Text key={i} style={i === 0 ? s.sourceHeaderMetaBold : s.sourceHeaderMeta} numberOfLines={2}>{line}</Text>
            ))}
          </View>
        </View>

        {/* Original URL — preserved exactly, tappable */}
        {event.local_indicator ? (
          <View style={s.sourceContentBlock}>
            <Text style={[s.sourceHeaderMetaBold, { marginBottom: 4 }]}>Original URL</Text>
            <Text style={s.sourceContentText} selectable testID="evidence-original-url">{event.local_indicator}</Text>
          </View>
        ) : null}

        {/* Domain */}
        {event.indicator_host && !event.local_indicator ? (
          <View style={s.sourceContentBlock}>
            <Text style={[s.sourceHeaderMetaBold, { marginBottom: 4 }]}>Domain</Text>
            <Text style={s.sourceContentText} selectable>{event.indicator_host}</Text>
          </View>
        ) : null}

        {/* Direct link back to original source */}
        {sourceInfo.originalUrl ? (
          <Pressable
            testID="evidence-open-original"
            accessibilityRole="link"
            accessibilityLabel={`Open original: ${sourceInfo.originalUrl}`}
            onPress={() => void Linking.openURL(sourceInfo.originalUrl!)}
            style={s.sourceLink}
          >
            <Globe size={14} color="#2E9E6B" />
            <Text style={s.sourceLinkText} numberOfLines={1}>Open original source</Text>
          </Pressable>
        ) : null}

        {/* Claimed brand — preserved as-is */}
        {record?.scenarioContext?.claimedBrand ? (
          <EvidenceRow label="Claimed brand" value={record.scenarioContext.claimedBrand} />
        ) : null}

        {/* Indicator digest — for verification */}
        {event.indicator_digest ? (
          <EvidenceRow label="Digest" value={event.indicator_digest} isLast selectable />
        ) : null}
      </Card>

      {/* ── Supporting references — original sources ── */}
      {hasRefs ? (
        <Card style={{ gap: spacing.md }} testID="evidence-references">
          <Text style={s.sectionTitle}>Supporting references</Text>
          {event.supporting_references!.map((ref, i) => (
            <Pressable
              key={i}
              style={s.refCard}
              accessibilityRole="link"
              onPress={() => ref.url ? void Linking.openURL(ref.url) : undefined}
            >
              <Text style={s.refLabel}>{ref.label}</Text>
              <Text style={s.refUrl} selectable>{ref.url}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {/* ── Evidence metadata ── */}
      <Card style={{ gap: 0 }} testID="evidence-metadata">
        <Text style={s.sectionTitle}>Evidence metadata</Text>
        <EvidenceRow
          label="Collected"
          value={new Date(event.occurred_at).toLocaleString([], {
            day: "numeric", month: "short", year: "numeric",
            hour: "numeric", minute: "2-digit", second: "2-digit",
          })}
        />
        {record?.freshness?.observedAt ? (
          <EvidenceRow
            label="Last observed"
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
            isLast
          />
        ) : null}
      </Card>

      {/* Privacy note */}
      {event.evidence_provenance === "server_projected" ? (
        <View
          style={[s.infoCard, { backgroundColor: "rgba(22,34,53,0.06)" }]}
          testID="evidence-privacy-note"
        >
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.info, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
            <Info size={16} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={s.infoBody}>
              Full evidence is on the originating device. This view shows the server-held record.
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
