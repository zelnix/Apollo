// "Coverage at a glance" for Home — shows the 5 protection areas with their summary status,
// derived live from the same health state the Protection tab uses. Never hard-codes a count:
// the pills and summary line always match the actual state. Tapping opens the Protection tab.
import { useRouter } from "expo-router";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { Card, Pill } from "@/src/components/ui";
import { buildProtectionAreas } from "@/src/domain/protectionAreas";
import { gateTone } from "@/src/domain/gates";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWell: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brand },
  count: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  link: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.restingText },
}));

export function CoverageCard() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const health = useProtectionHealth();

  const areas = useMemo(
    () => (health.checking ? [] : buildProtectionAreas(health.gates)),
    [health.checking, health.gates],
  );

  if (health.checking) return null;

  const totalWatching = areas.reduce((sum, a) => sum + a.watchingCount, 0);
  const areasWithAttention = areas.filter((a) => a.attentionCount > 0).length;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Protection"
      accessibilityHint="See all five protection areas and their current status"
      onPress={() => router.push("/(tabs)/protection")}
      testID="home-coverage-card-tap"
    >
      <Card testID="home-coverage-card" style={{ gap: spacing.sm }}>
        <View style={s.titleRow}>
          <View style={s.iconWell}><ShieldCheck size={16} color={colors.brand} /></View>
          <Text style={s.title}>Your protection</Text>
        </View>
        <Text style={s.count} testID="home-coverage-count">
          {areasWithAttention > 0
            ? `${areasWithAttention} ${areasWithAttention === 1 ? "area needs" : "areas need"} attention`
            : totalWatching > 0
              ? `${totalWatching} automatic ${totalWatching === 1 ? "protection" : "protections"} watching`
              : "Protection status"}
        </Text>
        <View style={s.pills}>
          {areas.map((area) => (
            <Pill
              key={area.id}
              tone={gateTone(area.summaryTone)}
              label={`${area.title}: ${area.summaryStatus}`}
            />
          ))}
        </View>
        <Text style={s.link}>View all protection →</Text>
      </Card>
    </Pressable>
  );
}
