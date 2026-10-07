// Compact "coverage at a glance" card for Home — mirrors the end-of-setup recap so people can
// re-check their key protections anytime. Shows the permission/connection Gates (Site, Text, Call,
// Email) as On / pending pills with an "X of Y on" line. Tapping a pill opens that Gate. Reads live
// health state; does not change any Gate's architecture or enforcement.
import { useRouter } from "expo-router";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { Card, Pill } from "@/src/components/ui";
import { GATE_ORDER, GATE_PERMISSIONS, gateAppliesToPlatform, type GatePermId } from "@/src/domain/gatePermissions";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const PENDING_STATES = ["permission_needed", "setup_needed"];
const ROUTE: Record<GatePermId, string> = { site: "/(tabs)/guard", text: "/text-guard", call: "/call-guard", email: "/email" };

const useStyles = makeStyles((c) => ({
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWell: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brand },
  count: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
}));

export function CoverageCard() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { enableSiteProtection, showToast } = useApollo();
  const health = useProtectionHealth();
  const [busyId, setBusyId] = React.useState<GatePermId | null>(null);
  if (health.checking) return null;

  const rows = GATE_ORDER.filter(gateAppliesToPlatform).map((id) => {
    const state = health.gates.find((g) => g.id === id)?.capability.automatic?.state;
    if (state === "running") return { id, on: true };
    if (state && PENDING_STATES.includes(state)) return { id, on: false };
    return null;
  }).filter((r): r is { id: GatePermId; on: boolean } => r !== null);
  if (rows.length === 0) return null;

  // Tapping an On pill opens the Gate; a pending pill triggers the enable flow directly — Site inline
  // (VPN consent), the rest from their Gate screen's enable path (notification/role/OAuth).
  const press = async (id: GatePermId, on: boolean) => {
    if (on) { router.push(ROUTE[id] as never); return; }
    if (id === "site") {
      setBusyId("site");
      try {
        const granted = await enableSiteProtection();
        showToast(granted ? "Site Gate is on." : "Site Gate needs VPN permission. Your other protection stays active.", granted ? "resting" : "growling");
      } catch { showToast("Couldn't open that just now. Try again shortly.", "growling"); }
      finally { setBusyId(null); }
      return;
    }
    router.push(ROUTE[id] as never);
  };

  const onCount = rows.filter((r) => r.on).length;
  return (
    <Card testID="home-coverage-card" style={{ gap: spacing.sm }}>
      <View style={s.titleRow}>
        <View style={s.iconWell}><ShieldCheck size={16} color={colors.brand} /></View>
        <Text style={s.title}>Coverage at a glance</Text>
      </View>
      <Text style={s.count} testID="home-coverage-count">{onCount} of {rows.length} key protections on{onCount < rows.length ? " — reduced coverage" : ""}</Text>
      <View style={s.pills}>
        {rows.map((r) => (
          <Pressable key={r.id} testID={`home-coverage-${r.id}`} accessibilityRole="button" disabled={busyId === r.id} onPress={() => void press(r.id, r.on)}>
            <Pill tone={r.on ? "resting" : "growling"} label={`${GATE_PERMISSIONS[r.id].title.replace(/ Gate$/, "")}: ${r.on ? "On" : busyId === r.id ? "Opening…" : GATE_PERMISSIONS[r.id].pendingLabel}`} />
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
