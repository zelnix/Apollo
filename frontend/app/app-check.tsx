// Gate 7 — Check This App. Works from what the user tells Apollo (name, source, purpose, permissions,
// what was happening around the install) plus any Security-SDK findings. Never pretends to read other apps.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markCheckDone } from "@/src/store/checkCompletion";
import { apiPost } from "@/src/api/client";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { analyseApp, APP_PERMISSIONS, APP_PURPOSES, APP_SOURCES, PERMISSION_INFO, type AppAnalysis, type AppNetwork, type AppPermission, type AppPurpose, type AppSource } from "@/src/domain/appAnalysis";
import { SCENT_WINDOW_MS } from "@/src/domain/threatScent";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { AppDeviceSdk, sdkPermissionsToApp } from "@/src/security/appDeviceSdk";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { openDeviceSettings } from "@/src/utils/deviceSettings";
import { goBackOrHome } from "@/src/utils/navigation";

type Reputation = { remote_access_tool: string | null; known_security_vendor: string | null; impersonates_brand: string | null; official_store: boolean; note: string };
type Remote = { reputation: Reputation; hosts: { host: string; verdict: "clean" | "malicious" | "unknown" }[]; explanation: { summary: string; why: string[]; recommendation: string } | null };
const LINKED_CATEGORIES = new Set(["call", "message", "link", "website", "known_threat"]);

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, minHeight: 40, justifyContent: "center" },
  chipOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  chipWarn: { borderColor: c.growling, backgroundColor: c.growlingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  verdict: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  permRow: { gap: 2, paddingVertical: spacing.xs },
}));

export default function CheckApp() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string; source?: AppSource; scent?: string }>();
  const { ready, setupDone, upsertEvent, resolveEvent, deviceId, adapterLabel, showToast, events } = useApollo();
  const [name, setName] = useState(params.name ?? "");
  const [developer, setDeveloper] = useState("");
  const [source, setSource] = useState<AppSource>(params.source ?? "not_sure");
  const [purpose, setPurpose] = useState<AppPurpose>("other");
  const [perms, setPerms] = useState<AppPermission[]>([]);
  const [ctx, setCtx] = useState({ promptedByCaller: false, promptedByMessageOrSite: false, intentional: false, accessGrantedNow: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ a: AppAnalysis; event: PatrolEvent | null; remote: Remote | null; linked: PatrolEvent | null } | null>(null);
  const [tech, setTech] = useState(false);
  const [permSheet, setPermSheet] = useState<AppPermission | null>(null);
  const [sdkVisible, setSdkVisible] = useState(false);
  useEffect(() => { void AppDeviceSdk.getAppDeviceCapabilities().then((c) => setSdkVisible(c.appPermissions === "supported")); }, []);

  // Threat Scent: non-resting events from other gates inside the window (call → link → download → install).
  const recentLinked = useMemo(() => { const now = Date.now(); return events.filter((e) => e.state !== "resting" && LINKED_CATEGORIES.has(e.category) && now - Date.parse(e.occurred_at) <= SCENT_WINDOW_MS); }, [events]);

  const run = async () => {
    setBusy(true);
    try {
    void markCheckDone("app");
      let network: AppNetwork | null = null;
      const sdk = await AppDeviceSdk.getInstalledAppAssessment(name.trim());
      if (sdk?.network) network = sdk.network;
      // Phase A: observed facts from the native SDK override guesses — install source when the person wasn't sure,
      // and the app's actual permissions (plus remote-access capability) are added to what they ticked.
      const observedSource: AppSource = sdk && source === "not_sure" ? sdk.installSource : source;
      const observedPerms: AppPermission[] = sdk ? Array.from(new Set([...perms, ...sdkPermissionsToApp(sdk.permissions), ...(sdk.remoteAccessCapability ? ["screen_share" as const] : [])])) : perms;
      if (sdk) { setSource(observedSource); setPerms(observedPerms); }
      const context = { ...ctx, recentScentCategories: recentLinked.map((e) => e.category) };
      let a = analyseApp({ name: name.trim(), developer: developer.trim() || undefined, source: observedSource, purpose, permissions: observedPerms, context, network });
      let remote: Remote | null = null;
      try {
        remote = await apiPost<Remote>("/app/analyse", "app_check", { device_id: deviceId ?? "local-device", name: name.trim().slice(0, 120), developer: developer.trim().slice(0, 120) || null, source: observedSource, purpose, permissions: observedPerms, hosts: network?.hosts.slice(0, 10) ?? [], local_state: a.state, scenario: a.scenario, second_opinion: true });
        const bad = remote.hosts.filter((h) => h.verdict === "malicious").length;
        if (bad && !network?.blockedMalicious) a = analyseApp({ name: name.trim(), developer: developer.trim() || undefined, source: observedSource, purpose, permissions: observedPerms, context, network: { blockedMalicious: bad, unknownHosts: network?.unknownHosts ?? 0, hosts: network?.hosts ?? [] } });
      } catch { /* offline: on-device engine is authoritative */ }
      let event: PatrolEvent | null = null;
      const linked = recentLinked.find((e) => (ctx.promptedByCaller && e.category === "call") || (ctx.promptedByMessageOrSite && e.category !== "call")) ?? (a.remoteCapable || a.scenario === "A16" ? recentLinked[0] : null) ?? null;
      if (a.state !== "resting") {
        event = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "app", state: a.state, status: "active", headline: `App: ${a.title}`, what_happened: a.verdict, why: a.why, what_to_do: a.recommendation, indicator_host: null, indicator_digest: null, local_indicator: a.technical[0], verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: a.claimedBrand, scenario: a.scenario, scent_id: params.scent || linked?.scent_id || linked?.event_id || null });
        if (event.state !== a.state) a = { ...a, state: event.state, why: event.why };
      }
      setResult({ a, event, remote, linked });
    } finally { setBusy(false); }
  };
  const settingsFor = (a: AppAnalysis) => (a.permissionNotes.some((n) => n.id === "accessibility" && !n.expected) ? (["accessibility", "Settings → Accessibility"] as const) : (["apps", "Settings → Apps → the app"] as const));

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;
  const canRun = name.trim().length > 0 && !busy;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check this app</Text>
        <Pressable testID="app-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="app-scroll">
        {!result ? (
          <>
            <Body>Apollo doesn&apos;t judge an app by its name. It looks at what the app can do, where it came from, and what was happening when you installed it. {sdkVisible ? "On this device Apollo can read the install source and permissions of known remote-access apps (AnyDesk, TeamViewer and similar). For any other app, tell it what you see in Settings — Apollo can't list your apps." : "On this build Apollo can't read other apps' permissions — tell it what you see in Settings."}</Body>
            <Text style={s.label}>App name</Text>
            <TextInput testID="app-name" style={s.input} value={name} onChangeText={setName} placeholder="e.g. Bank Security Update" placeholderTextColor={colors.muted} autoCapitalize="words" autoCorrect={false} />
            <Text style={s.label}>Developer (if shown)</Text>
            <TextInput testID="app-developer" style={s.input} value={developer} onChangeText={setDeveloper} placeholder="Optional" placeholderTextColor={colors.muted} autoCapitalize="words" autoCorrect={false} />
            <Text style={s.label}>Where did it come from?</Text>
            <View style={s.chips}>{APP_SOURCES.map((o) => <Pressable key={o.id} testID={`app-source-${o.id}`} accessibilityRole="button" onPress={() => setSource(o.id)} style={[s.chip, source === o.id && s.chipOn]}><Text style={s.chipText}>{o.label}</Text></Pressable>)}</View>
            <Text style={s.label}>What does it say it does?</Text>
            <View style={s.chips}>{APP_PURPOSES.map((o) => <Pressable key={o.id} testID={`app-purpose-${o.id}`} accessibilityRole="button" onPress={() => setPurpose(o.id)} style={[s.chip, purpose === o.id && s.chipOn]}><Text style={s.chipText}>{o.label}</Text></Pressable>)}</View>
            <Text style={s.label}>What can it access? (Settings → Apps → Permissions)</Text>
            <View style={s.chips}>{APP_PERMISSIONS.map((p) => <Pressable key={p} testID={`app-perm-${p}`} accessibilityRole="button" onPress={() => setPerms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))} onLongPress={() => setPermSheet(p)} style={[s.chip, perms.includes(p) && s.chipWarn]}><Text style={s.chipText}>{PERMISSION_INFO[p].label}</Text></Pressable>)}</View>
            <Body>Hold a permission to see what it means.</Body>
            <Text style={s.label}>What was happening around the install?</Text>
            <View style={s.row}><Text style={[s.why, { flex: 1 }]}>Someone on a phone call told me to install it</Text><Switch testID="app-ctx-caller" value={ctx.promptedByCaller} onValueChange={(v) => setCtx((c) => ({ ...c, promptedByCaller: v }))} trackColor={{ true: colors.growling, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
            <View style={s.row}><Text style={[s.why, { flex: 1 }]}>A message, website or download led me to it</Text><Switch testID="app-ctx-message" value={ctx.promptedByMessageOrSite} onValueChange={(v) => setCtx((c) => ({ ...c, promptedByMessageOrSite: v }))} trackColor={{ true: colors.growling, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
            <View style={s.row}><Text style={[s.why, { flex: 1 }]}>I sought this app out myself (e.g. I called my own IT provider)</Text><Switch testID="app-ctx-intentional" value={ctx.intentional} onValueChange={(v) => setCtx((c) => ({ ...c, intentional: v }))} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
            <View style={s.row}><Text style={[s.why, { flex: 1 }]}>Someone is connected to / controlling my phone through it</Text><Switch testID="app-ctx-access" value={ctx.accessGrantedNow} onValueChange={(v) => setCtx((c) => ({ ...c, accessGrantedNow: v }))} trackColor={{ true: colors.barking, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
            {recentLinked.length ? <Card style={{ gap: spacing.xs, borderColor: colors.growling }} testID="app-scent-notice"><Text style={s.label}>Threat Scent</Text><Body>Apollo saw {recentLinked.length} suspicious event{recentLinked.length > 1 ? "s" : ""} in the last 30 minutes ({[...new Set(recentLinked.map((e) => e.category))].join(", ")}). An app installed now will be assessed as part of that sequence.</Body></Card> : null}
            <Button testID="app-run" label={busy ? "Sniffing…" : "Check this app"} onPress={() => void run()} disabled={!canRun} />
          </>
        ) : a ? (
          <>
            <Card testID="app-result" style={{ borderColor: toneColor(colors, a.state), gap: spacing.sm }}>
              <View style={s.chips}><Pill tone={a.state} label={STATE_NAME[a.state]} testID="app-state" /><Pill tone="neutral" label={a.scenario} testID="app-scenario" />{a.remoteCapable ? <Pill tone="barking" label="Remote access capable" testID="app-remote-pill" /> : null}</View>
              <Text style={s.why}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.label} testID="app-title">{a.title}</Text>
              <Text style={s.verdict} testID="app-verdict">{a.verdict}</Text>
              <SectionTitle>Why Apollo is looking at it</SectionTitle>
              {a.why.map((w, i) => <Text key={i} style={s.why} testID={`app-why-${i}`}>• {w}</Text>)}
              {result.linked ? <Text style={s.why} testID="app-linked">• Connected to: {result.linked.headline} (Threat Scent).</Text> : null}
              <SectionTitle>Recommendation</SectionTitle>
              <Text style={s.why} testID="app-recommendation">{a.recommendation}</Text>
            </Card>
            <Card style={{ gap: spacing.xs }} testID="app-access">
              <SectionTitle>Access</SectionTitle>
              {a.permissionNotes.length ? a.permissionNotes.map((n) => (
                <Pressable key={n.id} testID={`app-access-${n.id}`} accessibilityRole="button" onPress={() => setPermSheet(n.id)} style={s.permRow}>
                  <View style={s.row}><Text style={s.label}>{n.label}</Text><Pill tone={n.expected ? "resting" : "growling"} label={n.expected ? "Fits purpose" : "More than it needs"} /></View>
                  <Text style={s.why}>{n.plain}</Text>
                </Pressable>
              )) : <Body>No sensitive permissions selected.</Body>}
            </Card>
            <Card style={{ gap: spacing.xs }} testID="app-network">
              <SectionTitle>Network</SectionTitle>
              {result.remote?.hosts.length ? result.remote.hosts.map((h) => <View key={h.host} style={s.row}><Text style={[s.why, { flex: 1 }]} numberOfLines={1}>{h.host}</Text><Pill tone={h.verdict === "malicious" ? "biting" : h.verdict === "clean" ? "resting" : "ears_up"} label={h.verdict === "malicious" ? "Blocked — dangerous" : h.verdict} /></View>)
                : <Body>{sdkVisible ? "No connections from this app have been seen yet." : "App-to-network behaviour isn't visible on this build. Apollo's Connection Guard still blocks known-dangerous destinations device-wide."}</Body>}
            </Card>
            {result.remote ? (
              <Card style={{ gap: spacing.xs }} testID="app-reputation">
                <SectionTitle>Reputation</SectionTitle>
                <Body testID="app-reputation-note">{result.remote.reputation.note}</Body>
                {result.remote.explanation ? <><Text style={s.label}>Apollo&apos;s plain-language take</Text><Body testID="app-second-opinion">{result.remote.explanation.summary}</Body>{result.remote.explanation.why.map((w, i) => <Body key={i}>• {w}</Body>)}</> : null}
              </Card>
            ) : null}
            <Card style={{ gap: spacing.sm }} testID="app-actions">
              {a.state !== "resting" ? <Button testID="app-open-settings" variant={a.state === "barking" ? "danger" : "primary"} label={a.state === "barking" ? "Remove / open Settings" : "Open Settings"} onPress={() => void openDeviceSettings(settingsFor(a)[0], settingsFor(a)[1], (m) => showToast(m, "neutral"))} /> : null}
              {a.permissionNotes.length ? <Button testID="app-review-perms" variant="secondary" label="Review permissions" onPress={() => void openDeviceSettings("apps", "Settings → Apps → the app → Permissions", (m) => showToast(m, "neutral"))} /> : null}
              {a.stayWithMe && result.event ? <RecoveryFlow event={result.event} kinds={["remote", "banking_during_access", "password", "code", "accessibility"]} testID="app-recovery" /> : result.event ? <RecoveryFlow event={result.event} kinds={["remote", "accessibility", "profile", "password", "banking_during_access", "money"]} testID="app-recovery" /> : null}
              <Button testID="app-tell-why" variant="secondary" label="Tell me why" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { context: `App check: ${a.title}. State: ${STATE_NAME[a.state]}. ${a.technical.join("; ")}`, prompt: "Why is Apollo worried about this app and what should I do?" } })} />
              <Button testID="app-tech" variant="ghost" label="View technical details" onPress={() => setTech(true)} />
              {result.event ? <Button testID="app-keep" variant="ghost" label="Keep app — I trust it" onPress={() => { void resolveEvent(result.event!); setResult({ ...result, event: { ...result.event!, status: "resolved" } }); }} /> : null}
              {result.event ? <Button testID="app-report" variant="ghost" label="Report a mistake" onPress={async () => { try { await apiPost("/feedback", "feedback", { device_id: deviceId ?? "local-device", event_id: result.event!.event_id, kind: "false_positive", state: result.event!.state, host: null, sources: ["app_device_engine"], note: "" }); showToast("Thanks — a human will review this.", "neutral"); } catch { showToast("Couldn't send right now. Apollo kept a note locally.", "neutral"); } }} /> : null}
              <Button testID="app-again" variant="ghost" label="Check another app" onPress={() => { setResult(null); setName(""); setDeveloper(""); setPerms([]); }} />
            </Card>
          </>
        ) : null}
      </KeyboardAwareScrollView>
      <Sheet visible={tech} onClose={() => setTech(false)} title="Technical details" testID="app-tech-sheet">
        {a?.technical.map((t, i) => <Body key={i} testID={`app-tech-${i}`}>{t}</Body>)}
        <Body>Automatic install monitoring, permission reading and app-to-network correlation need the native Security SDK (Android). iOS never exposes other apps&apos; permissions to any app — Apollo won&apos;t pretend otherwise.</Body>
        <Button testID="app-tech-close" variant="ghost" label="Done" onPress={() => setTech(false)} />
      </Sheet>
      <Sheet visible={!!permSheet} onClose={() => setPermSheet(null)} title={permSheet ? PERMISSION_INFO[permSheet].label : ""} testID="app-perm-sheet">
        {permSheet ? <Body testID="app-perm-plain">{PERMISSION_INFO[permSheet].plain}</Body> : null}
        <Body>Permissions alone don&apos;t decide risk. Apollo compares them with what the app claims to do, where it came from and what happened around the install.</Body>
        <Button testID="app-perm-close" variant="ghost" label="Done" onPress={() => setPermSheet(null)} />
      </Sheet>
    </View>
  );
}
