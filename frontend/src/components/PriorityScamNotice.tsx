// Conditional high-priority scam alert notice for Home.
// Only shown when a credible, HIGH/EXTREME severity, region-relevant alert exists.
// Deduplicates repeated publications and auto-expires stale warnings.
// Does NOT change Apollo's threat state — external warning only.

import * as Linking from "expo-linking";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Body, Button, Card, Pill, type Tone } from "@/src/components/ui";
import { governmentScams, type GovernmentAlert } from "@/src/higgins/hubClient";
import { alertFreshness } from "@/src/domain/alertFreshness";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const SEVERITY_TONE: Record<GovernmentAlert["severity"], Tone> = { EXTREME: "barking", HIGH: "growling", MODERATE: "ears_up", LOW: "neutral" };

// Only alerts published within this window qualify for the priority Home notice.
const MAX_AGE_DAYS = 14;

const useStyles = makeStyles((c) => ({
  card: { gap: spacing.sm, borderLeftWidth: 3, borderLeftColor: c.growling },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.growlingTint, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 22, color: c.onSurface, flex: 1 },
  higginsMessage: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  // ── Compact mode (Home) ──
  compactCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    marginHorizontal: spacing.xl, marginBottom: spacing.sm,
    borderRadius: radius.md, padding: spacing.md,
    backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border,
  },
  compactIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.growlingTint, alignItems: "center", justifyContent: "center" },
  compactContent: { flex: 1, gap: 1 },
  compactTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  compactSub: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  compactLink: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.brand },
}));

/** Deduplicate alerts by normalised title — keep the most recently updated per campaign. */
function deduplicateAlerts(alerts: GovernmentAlert[]): GovernmentAlert[] {
  const seen = new Map<string, GovernmentAlert>();
  for (const alert of alerts) {
    const key = alert.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const existing = seen.get(key);
    if (!existing || (alert.updatedAt ?? alert.publishedAt ?? "") > (existing.updatedAt ?? existing.publishedAt ?? "")) {
      seen.set(key, alert);
    }
  }
  return Array.from(seen.values());
}

/** Filter to only current, high-priority, region-relevant alerts. */
function filterPriorityAlerts(alerts: GovernmentAlert[]): GovernmentAlert[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  const cutoffISO = cutoff.toISOString();

  return alerts.filter((alert) => {
    // Must be HIGH or EXTREME severity
    if (alert.severity !== "HIGH" && alert.severity !== "EXTREME") return false;
    // Must be region-relevant (not overseas-only)
    if (alert.australianRelevance === "overseas_only") return false;
    // Must not be too old
    const date = alert.updatedAt ?? alert.publishedAt;
    if (date && date < cutoffISO) return false;
    return true;
  });
}

/** Build Higgins' natural language message about the priority alert. */
function higginsMessage(alert: GovernmentAlert): string {
  // Use the real Higgins explanation if available
  if (alert.higgins.whatHappened) {
    const base = alert.higgins.whatHappened.trim();
    const action = "You don't need to do anything unless you've received something suspicious. Tap below to read the full warning.";
    return `${base}\n\n${action}`;
  }
  // Fallback: construct from alert data
  return `There's an important new warning about ${alert.title.toLowerCase()}. ${alert.summary || ""} You don't need to do anything unless you've received something suspicious. Tap below to read the full warning.`.trim();
}

export function PriorityScamNotice({ compact = false }: { compact?: boolean } = {}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [items, setItems] = useState<GovernmentAlert[]>([]);
  const [lastSourced, setLastSourced] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void governmentScams(20)
      .then((r) => { if (active) { setItems(r.alerts); setLastSourced(r.lastSourcedAt); setLoaded(true); } })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const priorityAlert = useMemo(() => {
    if (!loaded || !items.length) return null;
    const deduplicated = deduplicateAlerts(items);
    const priority = filterPriorityAlerts(deduplicated);
    if (!priority.length) {
      // No HIGH/EXTREME alerts — fall back to the single most relevant current alert
      // Prefer Australian-relevant over global
      const fallback = deduplicateAlerts(items)
        .filter((a) => a.australianRelevance !== "overseas_only")
        .sort((a, b) => {
          const sevRank = (s: string) => (s === "EXTREME" ? 4 : s === "HIGH" ? 3 : s === "MODERATE" ? 2 : 1);
          const r = sevRank(b.severity) - sevRank(a.severity);
          if (r !== 0) return r;
          // Prefer directly relevant to AU
          if (a.australianRelevance === "directly_relevant" && b.australianRelevance !== "directly_relevant") return -1;
          if (b.australianRelevance === "directly_relevant" && a.australianRelevance !== "directly_relevant") return 1;
          return ((b.updatedAt ?? b.publishedAt) ?? "").localeCompare((a.updatedAt ?? a.publishedAt) ?? "");
        });
      return fallback[0] ?? null;
    }
    // Show only the single most relevant alert — prefer EXTREME, then AU-relevant, then most recent
    return priority.sort((a, b) => {
      // EXTREME before HIGH
      if (a.severity !== b.severity) return a.severity === "EXTREME" ? -1 : 1;
      // Prefer Australian directly_relevant
      if (a.australianRelevance === "directly_relevant" && b.australianRelevance !== "directly_relevant") return -1;
      if (b.australianRelevance === "directly_relevant" && a.australianRelevance !== "directly_relevant") return 1;
      // Most recently updated first
      return ((b.updatedAt ?? b.publishedAt) ?? "").localeCompare((a.updatedAt ?? a.publishedAt) ?? "");
    })[0] ?? null;
  }, [loaded, items]);

  if (!priorityAlert) return null;

  const freshness = alertFreshness(lastSourced);

  /* ── Compact mode: evidence-specific card for Home "Important for you" ── */
  if (compact) {
    const severityLabel = priorityAlert.severity === "EXTREME" ? "Extreme" : "High";
    const regionLabel = priorityAlert.australianRelevance === "directly_relevant"
      ? "Australian Scam Alert"
      : priorityAlert.regionLabel || "Scam Alert";
    const reason = priorityAlert.higgins?.whatHappened
      ? (priorityAlert.higgins.whatHappened.length > 90 ? priorityAlert.higgins.whatHappened.slice(0, 90) + "…" : priorityAlert.higgins.whatHappened)
      : priorityAlert.summary
        ? (priorityAlert.summary.length > 90 ? priorityAlert.summary.slice(0, 90) + "…" : priorityAlert.summary)
        : "";

    return (
      <Pressable
        testID="home-priority-scam-compact"
        accessibilityRole="button"
        onPress={() => void Linking.openURL(priorityAlert.url)}
        style={[s.compactCard, { flexDirection: "column", alignItems: "stretch" }]}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
          <View style={[s.compactIconWrap, {
            backgroundColor: priorityAlert.severity === "EXTREME" ? colors.barkingTint : colors.growlingTint,
          }]}>
            <TriangleAlert size={16} color={priorityAlert.severity === "EXTREME" ? colors.barking : colors.growling} />
          </View>
          <View style={s.compactContent}>
            <Text style={s.compactTitle} numberOfLines={2}>{priorityAlert.title}</Text>
            <Text style={s.compactSub} numberOfLines={1}>
              {severityLabel} · {regionLabel}
            </Text>
            {reason ? <Text style={[s.compactSub, { marginTop: 2, lineHeight: 17 }]} numberOfLines={2}>{reason}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.sm }}>
          <Text style={s.compactSub} numberOfLines={1} testID="home-priority-scam-freshness">{freshness.label}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={s.compactLink}>View scam alert</Text>
            <ChevronRight size={14} color={colors.brand} />
          </View>
        </View>
      </Pressable>
    );
  }

  /* ── Full mode (used on dedicated screens) ── */
  return (
    <Card style={s.card} testID="home-priority-scam-notice">
      <View style={s.header}>
        <View style={s.iconWell}>
          <TriangleAlert size={18} color={colors.growling} />
        </View>
        <Text style={s.title} numberOfLines={2}>Priority scam warning</Text>
      </View>

      <View style={s.row}>
        <Pill tone={SEVERITY_TONE[priorityAlert.severity]} label={priorityAlert.severity === "EXTREME" ? "Extreme" : "High priority"} />
        <Pill tone="neutral" label={priorityAlert.regionLabel} />
      </View>

      <Text style={[s.higginsMessage, { fontFamily: fonts.textSemibold }]} numberOfLines={2} testID="priority-scam-title">
        {priorityAlert.title}
      </Text>

      <Text style={s.higginsMessage} testID="priority-scam-higgins">
        {higginsMessage(priorityAlert)}
      </Text>

      <Text style={s.meta} testID="priority-scam-source">
        {priorityAlert.source} · {priorityAlert.dateLabel} · {freshness.label}
      </Text>

      <Button label="Read Alert" variant="secondary" onPress={() => void Linking.openURL(priorityAlert.url)} testID="priority-scam-read-button" />
    </Card>
  );
}
