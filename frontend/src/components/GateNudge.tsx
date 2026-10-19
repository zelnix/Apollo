// Gentle Home reminder for any Gate awaiting an explicit permission or account connection (reduced
// coverage). Shows ONE pending Gate at a time using shared copy, offers a one-tap enable, and
// "Not now" snoozes it ~3 days so it resurfaces gently rather than nagging. Never alarms — other
// protection stays active. Does not change any Gate's architecture or enforcement.
import { useRouter } from "expo-router";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Body, Button, Card } from "@/src/components/ui";
import { GATE_ORDER, GATE_PERMISSIONS, GATE_SNOOZE_MS, gateAppliesToPlatform, gateSnoozeKey, type GatePermId } from "@/src/domain/gatePermissions";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const PENDING_STATES = ["permission_needed", "setup_needed"];

const useStyles = makeStyles((c) => ({
  title: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
}));

export function GateNudge() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { enableSiteProtection, showToast, storage } = useApollo();
  const health = useProtectionHealth();
  const [snoozes, setSnoozes] = useState<Partial<Record<GatePermId, number>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSnoozed, setJustSnoozed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map: Partial<Record<GatePermId, number>> = {};
      for (const id of GATE_ORDER) {
        const raw = await storage.getItem(gateSnoozeKey(id), null);
        const parsed = raw ? Date.parse(raw) : NaN;
        if (Number.isFinite(parsed)) map[id] = parsed;
      }
      if (!cancelled) setSnoozes(map);
    })();
    return () => { cancelled = true; };
  }, [storage]);

  if (snoozes === null) return null;

  const now = Date.now();
  const pendingId = GATE_ORDER.find((id) => {
    if (!gateAppliesToPlatform(id)) return false;
    if ((snoozes[id] ?? 0) > now) return false;
    const gate = health.gates.find((g) => g.id === id);
    return !!gate && PENDING_STATES.includes(gate.capability.automatic?.state ?? "");
  });

  if (justSnoozed) {
    return (
      <Card style={{ gap: spacing.sm, borderColor: colors.navyBorder }} testID="gate-nudge-snoozed">
        <Body testID="gate-nudge-snoozed-line">Okay — we&apos;ll remind you in a few days. You can turn this on anytime from Protection or Settings.</Body>
      </Card>
    );
  }
  if (!pendingId) return null;

  const copy = GATE_PERMISSIONS[pendingId];

  const enable = async () => {
    setBusy(true);
    try {
      if (pendingId === "site") {
        const granted = await enableSiteProtection();
        showToast(granted ? "Website protection is on." : "Website protection needs VPN permission. Your other protection stays active.", granted ? "resting" : "growling");
      } else if (copy.route) {
        router.push(copy.route as never);
      }
    } catch {
      showToast("Couldn't open that just now. Try again shortly.", "growling");
    } finally { setBusy(false); }
  };

  const snooze = async () => {
    setSnoozes((m) => ({ ...(m ?? {}), [pendingId]: Date.now() + GATE_SNOOZE_MS }));
    setJustSnoozed(true);
    setTimeout(() => setJustSnoozed(false), 2800);
    await storage.setItem(gateSnoozeKey(pendingId), new Date(Date.now() + GATE_SNOOZE_MS).toISOString());
  };

  return (
    <Card style={{ gap: spacing.sm, borderColor: colors.growling }} testID="gate-nudge">
      <View style={s.row}>
        <ShieldAlert size={20} color={colors.growling} />
        <Text style={[s.title, { flex: 1 }]} testID="gate-nudge-title">Finish turning on {copy.title}</Text>
      </View>
      <Body testID="gate-nudge-line">{copy.short} {copy.pendingLabel === "Not connected" ? "Connect it" : "Allow it"} whenever you're ready — your other protection is already active.</Body>
      <Button testID="gate-nudge-enable" variant="secondary" label={busy ? "Opening…" : copy.enableLabel} disabled={busy} onPress={() => void enable()} />
      <Button testID="gate-nudge-dismiss" variant="ghost" label="Not now" onPress={() => void snooze()} />
    </Card>
  );
}
