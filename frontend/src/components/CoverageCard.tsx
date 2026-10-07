// Compact "coverage at a glance" card for Home — mirrors the end-of-setup recap so people can
// re-check their key protections anytime. Shows the permission/connection Gates (Site, Text, Call,
// Email) as On / pending pills with an "X of Y on" line. Tapping a pill opens that Gate. Reads live
// health state; does not change any Gate's architecture or enforcement.
import { useRouter } from "expo-router";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React from "react";
import { AppState, Pressable, Text, View } from "react-native";

import { Card, Pill } from "@/src/components/ui";
import { GATE_ORDER, GATE_PERMISSIONS, gateAppliesToPlatform, type GatePermId } from "@/src/domain/gatePermissions";
import { connectGmailOAuth } from "@/src/domain/gmailConnect";
import { runProtectionHealthCheck } from "@/src/protection/healthCoordinator";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { CallSdk } from "@/src/security/callSdk";
import { MessagingSdk } from "@/src/security/messagingSdk";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const PENDING_STATES = ["permission_needed", "setup_needed"];
const ROUTE: Record<GatePermId, string> = { site: "/(tabs)/guard", text: "/text-guard", call: "/call-guard", email: "/email" };

// Wait for the person to return from a system settings screen, then confirm the real state. Keeps
// polling up to the ceiling; only after a genuine background→active return does it start a short
// grace window (so a transient "active" event can't end the wait before the user has acted).
function waitForForeground(verify: () => Promise<boolean>, ceilingMs = 120_000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false; let backgrounded = false; const started = Date.now(); let deadline = started + ceilingMs; let timer: ReturnType<typeof setTimeout>;
    const finish = (v: boolean) => { if (done) return; done = true; sub.remove(); clearTimeout(timer); resolve(v); };
    const tick = async () => {
      if (done) return;
      try { if (await verify()) { finish(true); return; } } catch { /* transient */ }
      if (!backgrounded && Date.now() - started > 8000) { finish(false); return; }
      if (Date.now() > deadline) { finish(false); return; }
      timer = setTimeout(tick, 1000);
    };
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "background" || st === "inactive") backgrounded = true;
      else if (st === "active" && backgrounded) deadline = Math.min(deadline, Date.now() + 6000);
    });
    timer = setTimeout(tick, 1000);
  });
}

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
  const { deviceId, enableSiteProtection, showToast } = useApollo();
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

  // Tapping an On pill opens the Gate; a pending pill runs that Gate's enable flow right here — Site
  // (VPN consent), Text (notification access), Call (screening role) and Email (Gmail OAuth) — then
  // verifies the real state and refreshes so the pill flips without opening the Gate screen.
  const press = async (id: GatePermId, on: boolean) => {
    if (on) { router.push(ROUTE[id] as never); return; }
    const title = GATE_PERMISSIONS[id].title;
    setBusyId(id);
    try {
      let granted = false;
      if (id === "site") {
        granted = await enableSiteProtection();
      } else if (id === "text") {
        await MessagingSdk.openSmsListenerSettings();
        granted = await waitForForeground(async () => (await MessagingSdk.getMessagingCapabilities()).smsFiltering === "supported");
        await runProtectionHealthCheck("protection_change");
      } else if (id === "call") {
        const r = await CallSdk.requestCallScreeningRole();
        granted = r.held ?? await waitForForeground(async () => (await CallSdk.getCallProtectionCapabilities()).callScreening === "supported");
        await runProtectionHealthCheck("protection_change");
      } else if (id === "email") {
        if (!deviceId) { router.push(ROUTE.email as never); return; }
        granted = (await connectGmailOAuth(deviceId)) === "connected";
        await runProtectionHealthCheck("protection_change");
      }
      showToast(granted ? `${title} is on.` : `${title} isn't on yet — your other protection stays active.`, granted ? "resting" : "growling");
    } catch {
      showToast("Couldn't finish that just now. You can also enable it from the Gate screen.", "growling");
    } finally { setBusyId(null); }
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
