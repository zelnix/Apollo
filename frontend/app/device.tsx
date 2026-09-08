// Gate 7 — Check My Device. Shows only what this platform/build can truthfully see, plus what the user
// reports. Produces a device security status (Protected / Review / Action / Recovery) — never a "full scan".
import { Redirect, useRouter } from "expo-router";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markCheckDone } from "@/src/store/checkCompletion";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { assessDevice, DEVICE_STATUS, EMPTY_SIGNALS, SELF_REPORT, type DeviceFinding, type DevicePlatform, type DeviceSignals, type SelfReport } from "@/src/domain/deviceAnalysis";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { AppDeviceSdk } from "@/src/security/appDeviceSdk";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { openDeviceSettings, type SettingsTarget } from "@/src/utils/deviceSettings";
import { goBackOrHome } from "@/src/utils/navigation";

const TARGET: Record<string, SettingsTarget> = { D01: "apps", D01b: "apps", D02: "security", D03: "security", D04: "vpn", D05: "accessibility", D06: "apps", D07: "apps", D08: "unknown_sources", D09: "overlay", D10: "notification_access", D11: "developer" };

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  statusTitle: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  step: { flexDirection: "row", gap: spacing.sm },
  num: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brandPrimary, width: 20 },
}));

export default function CheckDevice() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, upsertEvent, deviceId, adapterLabel, showToast } = useApollo();
  const platform: DevicePlatform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  const [signals, setSignals] = useState<DeviceSignals>(EMPTY_SIGNALS(platform));
  const [self, setSelf] = useState<SelfReport>({});
  const [event, setEvent] = useState<PatrolEvent | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void AppDeviceSdk.getDeviceSecuritySignals(platform).then(setSignals); }, [platform]);
  const result = useMemo(() => assessDevice(signals, self), [signals, self]);
  const meta = DEVICE_STATUS[result.status];
  const anySelf = Object.values(self).some(Boolean);

  const save = async () => {
    setSaving(true);
    try {
    void markCheckDone("device");
      const ev = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "device", state: result.state, status: "active", headline: `Device: ${meta.title}`, what_happened: result.summary, why: result.findings.map((f) => `${f.title}: ${f.plain}`), what_to_do: result.recoverySteps[0] ?? result.findings[0]?.action ?? "Review the items Apollo listed.", indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: null, scenario: result.findings[0]?.id ?? "D00" });
      setEvent(ev);
      showToast("Saved to Patrol. Apollo will stay with you.", "neutral");
    } finally { setSaving(false); }
  };
  const open = (f: DeviceFinding) => void openDeviceSettings(TARGET[f.id] ?? "apps", f.settings, (m) => showToast(m, "neutral"));

  if (ready && !setupDone) return <Redirect href="/" />;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check my device</Text>
        <Pressable testID="device-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="device-scroll">
        <Card testID="device-status" style={{ borderColor: toneColor(colors, result.state), gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><ShieldCheck size={22} color={toneColor(colors, result.state)} /><Pill tone={result.state} label={STATE_NAME[result.state]} testID="device-state" /></View>
          <Text style={s.statusTitle} testID="device-status-title">{meta.title}</Text>
          <Text style={s.why}>{STATE_LABEL[result.state]}</Text>
          <Text style={s.why} testID="device-summary">{result.summary}</Text>
          <Body>{meta.meaning}</Body>
        </Card>

        {result.recoverySteps.length ? (
          <Card style={{ gap: spacing.sm, borderColor: colors.barking }} testID="device-recovery">
            <SectionTitle>Stay with me — do these in order</SectionTitle>
            {result.recoverySteps.map((st, i) => <View key={i} style={s.step}><Text style={s.num}>{i + 1}</Text><Text style={[s.why, { flex: 1 }]} testID={`device-recovery-step-${i}`}>{st}</Text></View>)}
            <Body>Apollo can&apos;t tell whether anything was taken — only that the access was risky. Don&apos;t assume the worst, but do the steps.</Body>
          </Card>
        ) : null}

        {result.findings.length ? (
          <View style={{ gap: spacing.md }}>
            <SectionTitle>What deserves attention</SectionTitle>
            {result.findings.map((f) => (
              <Card key={f.id} style={{ gap: spacing.xs, borderColor: toneColor(colors, f.severity === "high" ? "barking" : f.severity === "review" ? "growling" : "ears_up") }} testID={`device-finding-${f.id}`}>
                <View style={s.row}><Text style={[s.label, { flex: 1 }]}>{f.title}</Text><Pill tone={f.severity === "high" ? "barking" : f.severity === "review" ? "growling" : "ears_up"} label={f.severity === "high" ? "High risk" : f.severity === "review" ? "Review" : "Good to know"} /></View>
                <Text style={s.why}>{f.plain}</Text>
                <Text style={s.label}>What to do</Text>
                <Text style={s.why}>{f.action}</Text>
                <Body>{f.settings}</Body>
                <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                  <Button testID={`device-open-${f.id}`} variant={f.severity === "high" ? "danger" : "secondary"} label="Open Settings" onPress={() => open(f)} />
                  {f.handoff === "app" ? <Button testID={`device-app-${f.id}`} variant="ghost" label="Check this app" onPress={() => router.push("/app-check")} /> : null}
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        <Card style={{ gap: spacing.sm }} testID="device-self-report">
          <SectionTitle>Tell Apollo what you&apos;ve noticed</SectionTitle>
          <Body>{platform === "ios" ? "iPhone doesn't let any app inspect other apps or profiles, so Apollo relies on what you tell it." : signals.thirdPartyAccessibilityServices === null ? "This build can't read device settings automatically yet — tell Apollo what you've seen." : "Apollo adds what you tell it to what the Security SDK can see."}</Body>
          {SELF_REPORT.filter((o) => !(platform === "ios" && o.id === "unknownSourcesOn")).map((o) => (
            <View key={o.id} style={s.row}><Text style={[s.why, { flex: 1 }]}>{o.label}</Text><Switch testID={`device-self-${o.id}`} value={!!self[o.id]} onValueChange={(v) => setSelf((c) => ({ ...c, [o.id]: v }))} trackColor={{ true: o.id === "managementExpected" ? colors.resting : colors.growling, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
          ))}
        </Card>

        <Card style={{ gap: spacing.xs }} testID="device-cannot-see">
          <SectionTitle>What Apollo can&apos;t see here</SectionTitle>
          {result.cannotSee.length ? result.cannotSee.map((c, i) => <Body key={i} testID={`device-cannot-${i}`}>• {c}</Body>) : <Body>Everything listed above was read from the device.</Body>}
          <Body>Apollo shows only what it can verify. It never guesses at a full forensic scan.</Body>
        </Card>

        <Card style={{ gap: spacing.sm }} testID="device-actions">
          {result.status !== "protected" && !event ? <Button testID="device-save" label={saving ? "Saving…" : "Save to Patrol & stay with me"} onPress={() => void save()} disabled={saving} /> : null}
          {event ? <RecoveryFlow event={event} kinds={["remote", "banking_during_access", "accessibility", "profile", "password", "code"]} testID="device-recovery-flow" /> : null}
          <Button testID="device-check-app" variant="secondary" label="Check a specific app" onPress={() => router.push("/app-check")} />
          <Button testID="device-ask" variant="ghost" label="Ask Higgins about my device" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { context: `Device check: ${meta.title}. ${result.summary} Findings: ${result.findings.map((f) => f.title).join("; ") || "none"}. Self-reported: ${Object.keys(self).filter((k) => self[k as keyof SelfReport]).join(", ") || "nothing"}.`, prompt: anySelf ? "What should I do first?" : "How do I keep my phone secure?" } })} />
        </Card>
      </ScrollView>
    </View>
  );
}
