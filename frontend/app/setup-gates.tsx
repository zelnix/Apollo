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
import { ActivityIndicator, AppState, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { ApolloLogo } from "@/src/components/ApolloLogo";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
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

export default function SetupGates() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId, storage, enableSiteProtection, showToast } = useApollo();

  const [steps, setSteps] = useState<GatePermId[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recap, setRecap] = useState<{ id: GatePermId; on: boolean }[] | null>(null);
  const leaving = useRef(false);

  // After permissions/platform setup, onboarding proceeds to Higgins First Check (spec §4) BEFORE the
  // normal all-clear experience — never straight to Home.
  const goHome = useCallback(() => { if (leaving.current) return; leaving.current = true; router.replace("/first-check"); }, [router]);

  // Read a Gate's REAL on/pending state. Returns null when the Gate isn't applicable here
  // (unsupported platform, or Email not configured) so it's left out of setup and the recap.
  const readGateOn = useCallback(async (id: GatePermId): Promise<boolean | null> => {
    if (id === "site") { const v = (await securityAdapter.getProtectionPermissions()).find((p) => p.id === "vpn_config"); return v ? v.status === "granted" : null; }
    if (id === "text") { const c = (await MessagingSdk.getMessagingCapabilities()).smsFiltering; return c === "unsupported" ? null : c === "supported"; }
    if (id === "call") { const c = (await CallSdk.getCallProtectionCapabilities()).callScreening; return c === "unsupported" ? null : c === "supported"; }
    if (id === "email") { if (!deviceId) return null; const st = await apiGet<{ connected: boolean; configured: boolean }>(`/gmail/status?device_id=${deviceId}`); return st.configured ? st.connected : null; }
    return null;
  }, [deviceId]);

  // Build the list of Gates that still need action on this device/platform.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const needs: GatePermId[] = [];
      for (const id of GATE_ORDER) {
        if (!gateAppliesToPlatform(id)) continue;
        try { if ((await readGateOn(id)) === false) needs.push(id); } catch { /* can't tell — skip; Gate screen stays available */ }
      }
      if (!cancelled) { setSteps(needs); if (needs.length === 0) goHome(); }
    })();
    return () => { cancelled = true; };
  }, [readGateOn, goHome]);

  const snooze = useCallback(async (id: GatePermId) => {
    await storage.setItem(gateSnoozeKey(id), new Date(Date.now() + GATE_SNOOZE_MS).toISOString());
  }, [storage]);

  // End of setup — compute the "what's on / what's pending" recap from real state (not assumptions).
  const finish = useCallback(async () => {
    const rows: { id: GatePermId; on: boolean }[] = [];
    for (const id of GATE_ORDER) {
      if (!gateAppliesToPlatform(id)) continue;
      try { const on = await readGateOn(id); if (on !== null) rows.push({ id, on }); } catch { /* skip */ }
    }
    if (rows.length === 0) { goHome(); return; }
    setRecap(rows);
  }, [readGateOn, goHome]);

  const advance = useCallback(() => {
    setIdx((i) => {
      const next = i + 1;
      if (!steps || next >= steps.length) { void finish(); return i; }
      return next;
    });
  }, [steps, finish]);

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
        const r = await CallSdk.requestCallScreeningRole();
        granted = r.held ?? await waitForForeground(async () => (await CallSdk.getCallProtectionCapabilities()).callScreening === "supported");
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
  const skipRest = async () => { if (steps) for (let i = idx; i < steps.length; i++) await snooze(steps[i]); await finish(); };

  if (recap !== null) {
    const onCount = recap.filter((r) => r.on).length;
    return (
      <View style={s.root} testID="setup-gates-recap">
        <View style={[s.content, { paddingTop: insets.top }]}>
          <View style={{ gap: spacing.sm }}>
            <ApolloLogo size={72} />
            <Text style={s.eyebrow}>You&apos;re set up</Text>
            <Text style={s.title} testID="setup-gates-recap-title">{onCount === recap.length ? "Apollo is fully on" : "Protection active — reduced coverage"}</Text>
            <Text style={s.progress} testID="setup-gates-recap-count">{onCount} of {recap.length} Gates on</Text>
          </View>
          <Card style={{ gap: spacing.sm }} testID="setup-gates-recap-list">
            {recap.map((r) => (
              <View key={r.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }} testID={`setup-gates-recap-${r.id}`}>
                <Text style={[s.why, { flex: 1 }]}>{GATE_PERMISSIONS[r.id].title}</Text>
                <Pill tone={r.on ? "resting" : "growling"} label={r.on ? "On" : GATE_PERMISSIONS[r.id].pendingLabel} testID={`setup-gates-recap-${r.id}-pill`} />
              </View>
            ))}
          </Card>
          {onCount < recap.length ? <Body style={{ color: colors.muted }}>You can turn on anything marked pending anytime from its Gate screen or Settings.</Body> : null}
        </View>
        <View style={[s.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Button testID="setup-gates-recap-done" label="Go to Apollo" onPress={goHome} icon={<ShieldCheck size={18} color={colors.onBrandPrimary} />} />
        </View>
      </View>
    );
  }

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
