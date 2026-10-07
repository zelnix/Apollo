// Setup walkthrough — after the privacy disclosure, Apollo offers each Gate that needs an explicit
// permission or account connection, one at a time, using the SAME consent pattern as Site Guard:
// a dedicated prompt explaining what the Gate does and why the access is needed, with Enable / Not
// now. The real permission/connection state is verified after the system flow returns; a Gate is
// never marked active until confirmed. Declining (or "Not now") never blocks setup — remaining
// protection stays active (reduced coverage) and the Gate can be enabled later from its screen.
// This screen does NOT change any Gate's underlying architecture or enforcement.
import { useRouter } from "expo-router";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { ApolloLogo } from "@/src/components/ApolloLogo";
import { Body, Button, Card, SectionTitle } from "@/src/components/ui";
import { GATE_ORDER, GATE_PERMISSIONS, GATE_SNOOZE_MS, gateAppliesToPlatform, gateSnoozeKey, type GatePermId } from "@/src/domain/gatePermissions";
import { connectGmailOAuth } from "@/src/domain/gmailConnect";
import { CallSdk } from "@/src/security/callSdk";
import { MessagingSdk } from "@/src/security/messagingSdk";
import { securityAdapter } from "@/src/security/securityAdapter";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { flex: 1, paddingHorizontal: spacing.xl, gap: spacing.lg, justifyContent: "center" },
  eyebrow: { fontFamily: fonts.display, fontSize: 13, color: c.restingText, letterSpacing: 1.4, textTransform: "uppercase" },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface, lineHeight: 32 },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm },
  note: { fontFamily: fonts.text, fontSize: 12, color: c.muted, textAlign: "center" },
  progress: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted },
}));

// Wait for the person to return from a system settings screen, then confirm the real state.
// Returns as soon as `verify` is true, shrinks to ~4s after the app regains focus (prompt a quick
// decision without hanging), and never waits past the ceiling.
function waitForForeground(verify: () => Promise<boolean>, ceilingMs = 120_000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false; let deadline = Date.now() + ceilingMs; let timer: ReturnType<typeof setTimeout>;
    const finish = (v: boolean) => { if (done) return; done = true; sub.remove(); clearTimeout(timer); resolve(v); };
    const tick = async () => {
      if (done) return;
      try { if (await verify()) { finish(true); return; } } catch { /* transient */ }
      if (Date.now() > deadline) { finish(false); return; }
      timer = setTimeout(tick, 1000);
    };
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") deadline = Math.min(deadline, Date.now() + 4000); });
    timer = setTimeout(tick, 1000);
  });
}

export default function SetupGates() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId, storage, enableSiteProtection, showToast } = useApollo();

  const [steps, setSteps] = useState<GatePermId[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const leaving = useRef(false);

  const goHome = useCallback(() => { if (leaving.current) return; leaving.current = true; router.replace("/(tabs)/home"); }, [router]);

  // Build the list of Gates that still need action on this device/platform.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const needs: GatePermId[] = [];
      for (const id of GATE_ORDER) {
        if (!gateAppliesToPlatform(id)) continue;
        try {
          if (id === "site") {
            const perms = await securityAdapter.getProtectionPermissions();
            if (perms.find((p) => p.id === "vpn_config")?.status !== "granted") needs.push("site");
          } else if (id === "text") {
            if ((await MessagingSdk.getMessagingCapabilities()).smsFiltering === "permission_required") needs.push("text");
          } else if (id === "call") {
            if ((await CallSdk.getCallProtectionCapabilities()).callScreening === "permission_required") needs.push("call");
          } else if (id === "email") {
            if (!deviceId) continue;
            const status = await apiGet<{ connected: boolean; configured: boolean }>(`/gmail/status?device_id=${deviceId}`);
            if (status.configured && !status.connected) needs.push("email");
          }
        } catch { /* if we can't tell, skip — the Gate screen remains available later */ }
      }
      if (!cancelled) { setSteps(needs); if (needs.length === 0) goHome(); }
    })();
    return () => { cancelled = true; };
  }, [deviceId, goHome]);

  const snooze = useCallback(async (id: GatePermId) => {
    await storage.setItem(gateSnoozeKey(id), new Date(Date.now() + GATE_SNOOZE_MS).toISOString());
  }, [storage]);

  const advance = useCallback(() => {
    setIdx((i) => {
      const next = i + 1;
      if (!steps || next >= steps.length) { goHome(); return i; }
      return next;
    });
  }, [steps, goHome]);

  const current = steps && idx < steps.length ? steps[idx] : null;

  const enable = async () => {
    if (!current) return;
    setBusy(true);
    try {
      let granted = false;
      if (current === "site") {
        granted = await enableSiteProtection();
      } else if (current === "text") {
        await MessagingSdk.openSmsListenerSettings();
        granted = await waitForForeground(async () => (await MessagingSdk.getMessagingCapabilities()).smsFiltering === "supported");
      } else if (current === "call") {
        await CallSdk.requestCallScreeningRole();
        granted = await waitForForeground(async () => (await CallSdk.getCallProtectionCapabilities()).callScreening === "supported");
      } else if (current === "email" && deviceId) {
        granted = (await connectGmailOAuth(deviceId)) === "connected";
      }
      const copy = GATE_PERMISSIONS[current];
      if (granted) { await storage.setItem(gateSnoozeKey(current), ""); showToast(`${copy.title} is on.`, "resting"); }
      else { await snooze(current); showToast(`${copy.title} isn't on yet — you can enable it anytime. We'll remind you in a few days.`, "neutral"); }
    } catch {
      showToast("That didn't open. You can enable this Gate later from its screen.", "growling");
      await snooze(current);
    } finally {
      setBusy(false);
      advance();
    }
  };

  const notNow = async () => { if (current) await snooze(current); advance(); };
  const skipRest = async () => { if (steps) for (let i = idx; i < steps.length; i++) await snooze(steps[i]); goHome(); };

  if (steps === null || current === null) {
    return <View style={[s.root, { alignItems: "center", justifyContent: "center" }]} testID="setup-gates-loading"><ActivityIndicator color={colors.brand} /></View>;
  }

  const copy = GATE_PERMISSIONS[current];
  return (
    <View style={s.root} testID="setup-gates-root">
      <View style={[s.content, { paddingTop: insets.top }]}>
        <View style={{ gap: spacing.sm }}>
          <ApolloLogo size={72} />
          <Text style={s.eyebrow}>Finish setting up</Text>
          <Text style={s.progress} testID="setup-gates-progress">Gate {idx + 1} of {steps.length}</Text>
        </View>
        <Text style={s.title} testID="setup-gates-title">{copy.enableLabel}?</Text>
        <Card style={{ gap: spacing.sm }} testID={`setup-gates-card-${current}`}>
          <SectionTitle>What it does</SectionTitle>
          <Text style={s.why}>{copy.short}</Text>
          <SectionTitle>Why Apollo needs this</SectionTitle>
          <Text style={s.why} testID="setup-gates-why">{copy.why}</Text>
        </Card>
      </View>
      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button testID="setup-gates-enable" label={busy ? "Opening…" : copy.enableLabel} onPress={() => void enable()} disabled={busy} icon={busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <ShieldCheck size={18} color={colors.onBrandPrimary} />} />
        <Button testID="setup-gates-not-now" variant="ghost" label="Not now" onPress={() => void notNow()} disabled={busy} />
        <Text style={s.note}>Skipping keeps Apollo active with reduced coverage — you can turn any Gate on later.</Text>
        {steps.length - idx > 1 ? <Button testID="setup-gates-skip-rest" variant="ghost" label="Skip the rest for now" onPress={() => void skipRest()} disabled={busy} /> : null}
      </View>
    </View>
  );
}
