// Conditional high-priority scam alert notice for Home.
// Only shown when a credible, HIGH/EXTREME severity, region-relevant alert exists.
// Deduplicates repeated publications and auto-expires stale warnings.
// Does NOT change Apollo's threat state — external warning only.

import * as Linking from "expo-linking";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Body, Button, Card, Pill, type Tone } from "@/src/components/ui";
import { governmentScams, type GovernmentAlert } from "@/src/higgins/hubClient";
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void governmentScams(20)
      .then((r) => { if (active) { setItems(r.alerts); setLoaded(true); } })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const priorityAlert = useMemo(() => {
    if (!loaded || !items.length) return null;
    const deduplicated = deduplicateAlerts(items);
    const priority = filterPriorityAlerts(deduplicated);
    // Show only the single most relevant alert
    return priority.sort((a, b) => {
      // EXTREME before HIGH
      if (a.severity !== b.severity) return a.severity === "EXTREME" ? -1 : 1;
      // Most recently updated first
      return ((b.updatedAt ?? b.publishedAt) ?? "").localeCompare((a.updatedAt ?? a.publishedAt) ?? "");
    })[0] ?? null;
  }, [loaded, items]);

  if (!priorityAlert) return null;

  /* ── Compact mode: short summary row with "View details" link ── */
  if (compact) {
    return (
      <Pressable
        testID="home-priority-scam-compact"
        accessibilityRole="button"
        onPress={() => void Linking.openURL(priorityAlert.url)}
        style={s.compactCard}
      >
        <View style={s.compactIconWrap}>
          <TriangleAlert size={16} color={colors.growling} />
        </View>
        <View style={s.compactContent}>
          <Text style={s.compactTitle} numberOfLines={1}>{priorityAlert.title}</Text>
          <Text style={s.compactSub} numberOfLines={1}>
            {priorityAlert.severity === "EXTREME" ? "Extreme" : "High priority"} · {priorityAlert.source}
          </Text>
        </View>
        <Text style={s.compactLink}>View details</Text>
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
        {priorityAlert.source} · {priorityAlert.dateLabel}
      </Text>

      <Button label="Read Alert" variant="secondary" onPress={() => void Linking.openURL(priorityAlert.url)} testID="priority-scam-read-button" />
    </Card>
  );
}
