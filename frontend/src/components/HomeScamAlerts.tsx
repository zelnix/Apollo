// Compact Home section: the most recent verified scam alerts (growling ones first). Separate from the Gates
// coverage count — a general warning is never presented as device protection. Neutral empty/loading states.
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import ExternalLink from "lucide-react-native/icons/external-link";
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Body, Button, Card, Pill, SectionTitle, type Tone } from "@/src/components/ui";
import { governmentScams, type GovernmentAlert } from "@/src/higgins/hubClient";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const SEVERITY_TONE: Record<GovernmentAlert["severity"], Tone> = { EXTREME: "barking", HIGH: "growling", MODERATE: "ears_up", LOW: "neutral" };

const useStyles = makeStyles((c) => ({
  itemTitle: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 21, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  item: { gap: 4, paddingVertical: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: c.divider },
  sourceLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  sourceLinkText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brand },
}));

export function HomeScamAlerts() {
  const s = useStyles(); const router = useRouter(); const { colors } = useTheme();
  const [items, setItems] = useState<GovernmentAlert[] | null>(null);
  useEffect(() => { let ok = true; void governmentScams(12).then((r) => { if (ok) setItems(r.alerts); }).catch(() => { if (ok) setItems([]); }); return () => { ok = false; }; }, []);
  if (items === null) return null; // quiet until loaded; Home never fabricates a warning
  // Growling (High/Extreme + AU exposure) first, then newest; show the 3 most relevant.
  const ranked = [...items].sort((a, b) => Number(b.growling) - Number(a.growling));
  const top = ranked.slice(0, 3);
  return (
    <View style={{ gap: spacing.sm }} testID="home-scam-alerts">
      <SectionTitle>Scam alerts</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        {top.length === 0 ? (
          <Body testID="home-scam-empty">No current scam alerts from the official sources. This doesn&apos;t mean there are no new scams — tap below to review the latest guidance.</Body>
        ) : top.map((it, i) => (
          <Pressable key={it.url} style={[s.item, i > 0 && s.divider]} testID={`home-scam-${i}`} accessibilityRole="link" accessibilityLabel={`Open official source: ${it.title}`} onPress={() => void Linking.openURL(it.url)}>
            <View style={s.row}>
              <Pill tone={SEVERITY_TONE[it.severity]} label={it.severity === "LOW" ? "Info" : `${it.severity[0]}${it.severity.slice(1).toLowerCase()}`} />
              <Pill tone="neutral" label={it.regionLabel} />
            </View>
            <Text style={s.itemTitle}>{it.title}</Text>
            <Text style={s.meta}>{it.source} · {it.dateLabel}</Text>
            {it.growling ? <Body>{it.higgins.whyGrowling}</Body> : null}
            <View style={s.sourceLink}><Text style={s.sourceLinkText}>Open official source</Text><ExternalLink size={15} color={colors.brand} /></View>
          </Pressable>
        ))}
        <Button testID="home-view-all-scams" label="View all scam alerts" variant="secondary" onPress={() => router.push("/(tabs)/scams")} />
      </Card>
    </View>
  );
}
