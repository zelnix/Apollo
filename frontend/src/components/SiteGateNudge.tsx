// Gentle home reminder shown only while Site Gate is awaiting VPN permission (Android, reduced
// coverage). It never alarms — other protection is already active — and offers a one-tap enable
// using the same instant-flip path as Settings/Gates. Dismissible for the session.
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import React, { useState } from "react";
import { Platform, Text, View } from "react-native";

import { Body, Button, Card } from "@/src/components/ui";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  title: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
}));

export function SiteGateNudge() {
  const s = useStyles();
  const { colors } = useTheme();
  const { enableSiteProtection, showToast } = useApollo();
  const health = useProtectionHealth();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const siteGate = health.gates.find((gate) => gate.id === "site");
  const awaitingPermission = siteGate?.capability.automatic?.state === "permission_needed";
  if (Platform.OS !== "android" || !awaitingPermission || dismissed) return null;

  const enable = async () => {
    setBusy(true);
    try {
      const granted = await enableSiteProtection();
      showToast(granted ? "Site Gate is on." : "Site Gate needs VPN permission. Your other protection stays active.", granted ? "resting" : "growling");
      if (granted) setDismissed(true);
    } catch {
      showToast("Android could not open the VPN permission screen. Try again shortly.", "growling");
    } finally { setBusy(false); }
  };

  return (
    <Card style={{ gap: spacing.sm, borderColor: colors.growling }} testID="site-gate-nudge">
      <View style={s.row}>
        <ShieldAlert size={20} color={colors.growling} />
        <Text style={[s.title, { flex: 1 }]} testID="site-gate-nudge-title">Finish turning on Site Gate</Text>
      </View>
      <Body testID="site-gate-nudge-line">Site Gate can block dangerous websites once you allow the VPN permission. Your other protection is already active — this just adds website filtering.</Body>
      <Button testID="site-gate-nudge-enable" variant="secondary" label={busy ? "Turning on…" : "Turn on Site Gate"} disabled={busy} onPress={() => void enable()} />
      <Button testID="site-gate-nudge-dismiss" variant="ghost" label="Not now" onPress={() => setDismissed(true)} />
    </Card>
  );
}
