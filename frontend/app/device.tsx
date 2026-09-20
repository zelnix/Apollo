// Gate 7 — Check My Device. Shows only what this platform/build can truthfully see, plus what the user
// reports. Produces a device security status (Protected / Review / Action / Recovery) — never a "full scan".
import { Redirect, useRouter } from "expo-router";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markCheckDone } from "@/src/store/checkCompletion";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { assessDevice, deriveDeviceSecurityChanges, DEVICE_STATUS, EMPTY_SIGNALS, SELF_REPORT, type DeviceFinding, type DevicePlatform, type DeviceSecurityChange, type DeviceSignals, type SelfReport } from "@/src/domain/deviceAnalysis";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { AppDeviceSdk } from "@/src/security/appDeviceSdk";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { openDeviceSettings, type SettingsTarget } from "@/src/utils/deviceSettings";
import { goBackOrHome } from "@/src/utils/navigation";
import { storage } from "@/src/utils/storage";
import { issueContext, openHigginsHandoff } from "@/src/domain/higginsHandoff";

const TARGET: Record<string, SettingsTarget> = { D01: "apps", D01b: "apps", D02: "security", D03: "security", D04: "vpn", D05: "accessibility", D06: "apps", D07: "apps", D08: "unknown_sources", D09: "overlay", D10: "notification_access", D11: "developer" };
const DEVICE_SNAPSHOT_KEY = "apollo.device.signals.v1";
const SEVERITY_RANK: Record<DeviceFinding["severity"], number> = { high: 2, review: 1, info: 0 };

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
  const { ready, setupDone, upsertEvent, deviceId, adapterLabel, showToast, protection, permissions, verifyNow } = useApollo();
  const platform: DevicePlatform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  const [signals, setSignals] = useState<DeviceSignals>(EMPTY_SIGNALS(platform));
  const [self, setSelf] = useState<SelfReport>({});
  const [event, setEvent] = useState<PatrolEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(true);
  const [changes, setChanges] = useState<DeviceSecurityChange[]>([]);
  const [settingsGuidance, setSettingsGuidance] = useState<string | null>(null);
  const refreshDevice = useCallback(async (notify = false) => {
    setChecking(true);
    try {
      const [nextSignals, recent, previousRaw] = await Promise.all([AppDeviceSdk.getDeviceSecuritySignals(platform), AppDeviceSdk.getRecentAppSecurityEvents(), storage.getItem<string | null>(DEVICE_SNAPSHOT_KEY, null), verifyNow()]);
      const previous = previousRaw ? JSON.parse(previousRaw) as DeviceSignals : null;
      const observedChanges = deriveDeviceSecurityChanges(previous, nextSignals);
      setSignals(nextSignals);
      setChanges([...recent, ...observedChanges].filter((item, index, all) => all.findIndex((candidate) => candidate.eventType === item.eventType && candidate.appName === item.appName) === index));
      await storage.setItem(DEVICE_SNAPSHOT_KEY, JSON.stringify(nextSignals));
      void markCheckDone("device");
      if (notify) showToast("Device Gate checked the signals this platform exposes.", "neutral");
    } catch {
      if (notify) showToast("Device Gate couldn't refresh every signal. The visible limits are listed below.", "growling");
    } finally { setChecking(false); }
  }, [platform, showToast, verifyNow]);
  useEffect(() => { void refreshDevice(false); }, [refreshDevice]);
  const context = useMemo(() => ({
    protection: protection ? { requested: protection.requested, operational: protection.operational, degradedReason: protection.degradedReason,
      permissionIssues: permissions.filter((permission) => permission.status === "denied" || permission.status === "blocked").map((permission) => permission.title), checkedAt: protection.checkedAt } : null,
    recentChanges: changes,
  }), [changes, permissions, protection]);
  const result = useMemo(() => assessDevice(signals, self, context), [signals, self, context]);
  const meta = DEVICE_STATUS[result.status];
  const anySelf = Object.values(self).some(Boolean);

  const save = async () => {
    setSaving(true);
    try {
      const ev = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "device", state: result.state, status: "active", headline: `Device: ${meta.title}`, what_happened: result.summary, why: result.findings.map((f) => `${f.title}: ${f.plain}`), what_to_do: result.recoverySteps[0] ?? result.findings[0]?.action ?? "Review the items Apollo listed.", indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: null, scenario: result.findings[0]?.id ?? "D00" });
      setEvent(ev);
      showToast("Saved to Patrol. Apollo will stay with you.", "neutral");
    } finally { setSaving(false); }
  };
  const open = (f: DeviceFinding) => {
    const dynamic: SettingsTarget | null = f.id.includes("vpn_change") ? "vpn" : f.id.includes("profile_change") ? "security" : f.id.includes("service_enabled") ? "accessibility" : null;
    if (platform === "web") setSettingsGuidance(`${f.title}: ${f.settings}`);
    else void openDeviceSettings(dynamic ?? TARGET[f.id] ?? (f.id === "D12" || f.id === "D13" ? "vpn" : "apps"), f.settings, (m) => showToast(m, "neutral"));
  };
  const firstAction = [...result.findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0] ?? null;

  if (ready && !setupDone) return <Redirect href="/" />;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Device Gate</Text>
        <Pressable testID="device-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="device-scroll">
        <Body testID="device-gate-scope">Device Gate checks existing apps with visible sensitive access, current security settings and Apollo&apos;s own protection health—not only recent installs. It does not continuously scan every dormant app, and app capabilities are not proof of malicious behaviour.</Body>
        <Card testID="device-status" style={{ borderColor: toneColor(colors, result.state), gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><ShieldCheck size={22} color={toneColor(colors, result.state)} /><Pill tone={result.state} label={STATE_NAME[result.state]} testID="device-state" /></View>
          <Text style={s.statusTitle} testID="device-status-title">{meta.title}</Text>
          <Text style={s.why}>{STATE_LABEL[result.state]}</Text>
          <Text style={s.why} testID="device-summary">{result.summary}</Text>
          <Body>{meta.meaning}</Body>
        </Card>
        {settingsGuidance ? <Card testID="device-settings-guidance" style={{ gap: spacing.sm }}><SectionTitle>Settings steps</SectionTitle><Body>{settingsGuidance}</Body><Button testID="device-settings-guidance-close" variant="ghost" label="Hide instructions" onPress={() => setSettingsGuidance(null)} /></Card> : null}

        <Card testID="device-protection-health" style={{ gap: spacing.sm, borderColor: result.protectionHealth.status === "active" ? colors.resting : result.protectionHealth.status === "unavailable" ? colors.border : colors.growling }}>
          <View style={s.row}><SectionTitle>Apollo protection health</SectionTitle><Pill testID="device-protection-health-status" tone={result.protectionHealth.status === "active" ? "resting" : result.protectionHealth.status === "unavailable" ? "unknown" : "growling"} label={result.protectionHealth.status === "active" ? "Active" : result.protectionHealth.status === "off" ? "Off" : result.protectionHealth.status === "needs_attention" ? "Needs attention" : "Unavailable"} /></View>
          <Text style={s.label} testID="device-protection-health-title">{result.protectionHealth.title}</Text>
          <Body testID="device-protection-health-detail">{result.protectionHealth.detail}</Body>
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
                  <Button testID={`device-open-${f.id}`} variant={f.severity === "high" ? "danger" : "secondary"} label={platform === "web" ? "Show Settings steps" : "Open Settings"} onPress={() => open(f)} />
                  {f.handoff === "app" ? <Button testID={`device-app-${f.id}`} variant="ghost" label="Check this app" onPress={() => router.push("/app-check")} /> : null}
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        <Card testID="device-higgins" style={{ gap: spacing.sm, borderColor: colors.navyBorder }}>
          <SectionTitle>Higgins</SectionTitle>
          <Body testID="device-higgins-explanation">{firstAction ? `${firstAction.title} is the first item to review. ${firstAction.action}` : "Apollo did not identify a meaningful concern within the signals this platform exposes. The visibility limits below still apply."}</Body>
          {firstAction ? <Button testID="device-higgins-open-settings" label={platform === "web" ? "Show relevant Settings steps" : "Open relevant Settings"} onPress={() => open(firstAction)} /> : null}
          <Button testID="device-higgins-recheck" variant="secondary" icon={<RefreshCw size={17} color={colors.brand} />} label={checking ? "Checking again…" : "I changed it — check again"} onPress={() => void refreshDevice(true)} disabled={checking} />
          <Body testID="device-higgins-tampering-rule">Apollo reports suspected tampering only when a specific high-confidence configuration or permission change was observed. A stopped service or missing permission alone is a protection gap, not proof of tampering.</Body>
        </Card>

        <Card style={{ gap: spacing.sm }} testID="device-self-report">
          <SectionTitle>Tell Higgins what you&apos;ve noticed</SectionTitle>
          <Body>{platform === "ios" ? "iPhone doesn't let any app inspect other apps or profiles, so Higgins uses your report alongside Apollo's available device checks." : signals.thirdPartyAccessibilityServices === null ? "This build can't read these device settings automatically yet — tell Higgins what you've seen." : "Higgins keeps your report distinct from results Apollo observed through available device checks."}</Body>
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
          <Button testID="device-ask" variant="ghost" label="Ask Higgins about my device" onPress={() => openHigginsHandoff(router, issueContext({ gate: "device", issue_summary: meta.title, assessment_state: result.state, findings: result.findings.slice(0, 6).map((finding) => ({ summary: `${finding.title}: ${finding.plain}`, provenance: "observed", status: finding.severity === "high" ? "warning" : "uncertain" })), uncertainty: result.cannotSee, confirmed_protective_actions: [], user_reported_actions: Object.keys(self).filter((key) => self[key as keyof SelfReport]) }), anySelf ? "What should I do first?" : "How do I keep my phone secure?")} />
        </Card>
      </ScrollView>
    </View>
  );
}
