// "Coverage at a glance" for Home — shows every gate that is verifiably WATCHING (real, active,
// automatic background protection), derived live from the same health state the Gates tab uses.
// It never hard-codes a subset or a count: the pills and the "N gates Watching" line always match
// the gates actually watching right now. Tapping a gate opens it.
import { useRouter } from "expo-router";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { Card, Pill } from "@/src/components/ui";
import type { GateId } from "@/src/domain/gates";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

// Where each gate opens from Home.
const GATE_ROUTE: Record<GateId, string> = {
  site: "/(tabs)/guard", text: "/text-guard", call: "/call-guard", network: "/network", email: "/email",
  link: "/check", account: "/account", file: "/file", app: "/app-check", device: "/device",
};

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
  if (health.checking) return null;

  // A gate is "Watching" only when it has verified, active, non-manual automatic protection.
  const watching = health.gates.filter(
    (g) => g.tone === "good" && g.capability.automatic?.state === "running" && !g.capability.automatic?.manualOnly,
  );

  return (
    <Card testID="home-coverage-card" style={{ gap: spacing.sm }}>
      <View style={s.titleRow}>
        <View style={s.iconWell}><ShieldCheck size={16} color={colors.brand} /></View>
        <Text style={s.title}>Coverage at a glance</Text>
      </View>
      <Text style={s.count} testID="home-coverage-count">
        {watching.length === 0 ? "No automatic protection is verified yet" : `${watching.length} ${watching.length === 1 ? "gate" : "gates"} Watching`}
      </Text>
      {watching.length > 0 ? (
        <View style={s.pills}>
          {watching.map((g) => (
            <Pressable key={g.id} testID={`home-coverage-${g.id}`} accessibilityRole="button" onPress={() => router.push((GATE_ROUTE[g.id] ?? "/(tabs)/guard") as never)}>
              <Pill tone="resting" label={`${g.title.replace(/ Gate$/, "")}: Watching`} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/guard")} testID="home-coverage-setup">
          <Text style={s.link}>Set up a gate to start watching →</Text>
        </Pressable>
      )}
    </Card>
  );
}
