import React from "react";
import { Text, View } from "react-native";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Image from "lucide-react-native/icons/image";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import Shield from "lucide-react-native/icons/shield";
import Smartphone from "lucide-react-native/icons/smartphone";

import { Card } from "@/src/components/ui";
import type { PatrolEvent, SourceMetadata } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  typeLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#6B7280",
  },
  headline: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    color: c.onSurface,
    lineHeight: 21,
  },
  table: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  label: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    width: 72,
  },
  value: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurface,
    flex: 1,
    lineHeight: 19,
  },
  note: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: c.muted,
    fontStyle: "italic",
    marginTop: spacing.xs,
  },
}));

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Type-label + icon for each source type */
function sourcePresentation(meta: SourceMetadata | null | undefined, category: string) {
  if (meta) {
    switch (meta.type) {
      case "email":
        return { label: "Original item — Email", Icon: Mail, bg: "#DBEAFE" as string, fg: "#1E3A5F" as string };
      case "text":
        return { label: "Original item — Text message", Icon: MessageSquare, bg: "#D1FAE5" as string, fg: "#065F46" as string };
      case "screenshot":
        return { label: "Original item — Screenshot", Icon: Image, bg: "#EDE9FE" as string, fg: "#5B21B6" as string };
      case "link":
        return { label: "Original item — Link", Icon: Globe, bg: "#DBEAFE" as string, fg: "#1E3A5F" as string };
      case "call":
        return { label: "Original item — Phone call", Icon: Phone, bg: "#FEF3C7" as string, fg: "#92400E" as string };
      case "file":
        return { label: "Original item — File", Icon: FileText, bg: "#DBEAFE" as string, fg: "#1E3A5F" as string };
      case "app":
        return { label: "Original item — App", Icon: Smartphone, bg: "#D1FAE5" as string, fg: "#065F46" as string };
      case "device":
      case "network":
        return { label: "Original item — Device observation", Icon: Shield, bg: "#FEE2E2" as string, fg: "#991B1B" as string };
      case "account":
        return { label: "Original item — Account", Icon: Shield, bg: "#FEF3C7" as string, fg: "#92400E" as string };
    }
  }
  // Fallback from event category when no structured metadata
  switch (category) {
    case "email": return { label: "Original item — Email", Icon: Mail, bg: "#DBEAFE", fg: "#1E3A5F" };
    case "message": return { label: "Original item — Text message", Icon: MessageSquare, bg: "#D1FAE5", fg: "#065F46" };
    case "website": case "link": return { label: "Original item — Link/Site", Icon: Globe, bg: "#DBEAFE", fg: "#1E3A5F" };
    case "call": return { label: "Original item — Phone call", Icon: Phone, bg: "#FEF3C7", fg: "#92400E" };
    case "file": return { label: "Original item — File", Icon: FileText, bg: "#DBEAFE", fg: "#1E3A5F" };
    default: return { label: "Original item", Icon: Shield, bg: "#F3F4F6", fg: "#374151" };
  }
}

/** Row helper — renders only when value is truthy. */
function MetaRow({ label, value, selectable }: { label: string; value: string | null | undefined; selectable?: boolean }) {
  const s = useStyles();
  if (!value) return null;
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value} numberOfLines={2} selectable={selectable}>{value}</Text>
    </View>
  );
}

export function OriginalItemCard({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const meta = event.source_metadata;
  const pres = sourcePresentation(meta, event.category);
  const { Icon } = pres;

  // Build a human headline from the investigation overview when no metadata
  const briefHeadline = event.patrol_record?.higginsBriefing?.investigated
    ?? event.headline
    ?? "Security finding";

  return (
    <Card style={{ gap: spacing.sm }} testID="original-item-card">
      {/* Header: icon + type label + headline */}
      <View style={s.header}>
        <View style={[s.iconCircle, { backgroundColor: pres.bg }]}>
          <Icon size={20} color={pres.fg} />
        </View>
        <View style={s.headerText}>
          <Text style={s.typeLabel}>{pres.label}</Text>
          <Text style={s.headline} numberOfLines={2}>{briefHeadline}</Text>
        </View>
      </View>

      {/* Metadata rows — source-appropriate */}
      <View style={s.table}>
        {meta?.type === "email" ? (
          <>
            <MetaRow label="From" value={meta.sender} selectable />
            <MetaRow label="Subject" value={meta.subject} />
            <MetaRow label="Received" value={formatDateTime(meta.received_at)} />
            {meta.reply_to ? <MetaRow label="Reply-To" value={meta.reply_to} selectable /> : null}
            {(meta.attachment_count ?? 0) > 0 ? (
              <MetaRow label="Files" value={`${meta.attachment_count} attachment${(meta.attachment_count ?? 0) > 1 ? "s" : ""}`} />
            ) : null}
          </>
        ) : meta?.type === "text" ? (
          <>
            <MetaRow label="From" value={meta.sender} selectable />
            <MetaRow label="Received" value={formatDateTime(meta.received_at)} />
            {meta.preview ? <MetaRow label="Preview" value={meta.preview} /> : null}
          </>
        ) : meta?.type === "screenshot" ? (
          <>
            <MetaRow label="Submitted" value={formatDateTime(meta.submitted_at)} />
            {(meta.image_count ?? 0) > 1 ? <MetaRow label="Images" value={`${meta.image_count} screenshot${(meta.image_count ?? 0) > 1 ? "s" : ""}`} /> : null}
            {meta.user_question ? <MetaRow label="Question" value={meta.user_question} /> : null}
          </>
        ) : meta?.type === "link" ? (
          <>
            <MetaRow label="URL" value={meta.url} selectable />
            <MetaRow label="Checked" value={formatDateTime(meta.submitted_at)} />
          </>
        ) : meta?.type === "call" ? (
          <>
            <MetaRow label="Number" value={meta.sender ?? meta.preview} selectable />
            <MetaRow label="Date" value={formatDateTime(meta.received_at ?? meta.submitted_at)} />
          </>
        ) : (
          // Fallback: use what we have from the event itself
          <>
            {event.indicator_host ? <MetaRow label="Domain" value={event.indicator_host} selectable /> : null}
            <MetaRow label="Date" value={formatDateTime(event.occurred_at)} />
          </>
        )}
      </View>

      {/* Device-only privacy note when applicable */}
      {event.evidence_provenance === "server_projected" && !meta ? (
        <Text style={s.note}>
          Full content is available on the originating device only.
        </Text>
      ) : null}
    </Card>
  );
}
