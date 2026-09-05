// Gate 8 — Account Guard dashboard + Check Account Alert. Paste or describe a login/MFA/reset/breach alert;
// Apollo distinguishes "something suspicious happened" from "your account is compromised". Never asks for passwords.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import KeyRound from "lucide-react-native/icons/key-round";
import X from "lucide-react-native/icons/x";
import React, { useMemo, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { ACCOUNT_PROVIDERS, ALERT_KINDS, analyseAccountAlert, type AccountAnalysis, type AccountProvider, type AlertKind } from "@/src/domain/accountAnalysis";
import { SCENT_WINDOW_MS } from "@/src/domain/threatScent";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { NetworkAccountSdk } from "@/src/security/networkAccountSdk";
import { type RecoveryKind, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

type Remote = { urls: { url: string; host: string; verdict: "clean" | "malicious" | "unknown"; official: boolean }[]; explanation: { summary: string; why: string[]; recommendation: string } | null };
type Breach = { status: "not_configured" | "clear" | "found" | "unavailable"; breaches: { name: string; date: string; data: string[] }[]; password_exposed: boolean; detail: string };
const RISK_LABEL = { low: "Low takeover risk", elevated: "Elevated takeover risk", high: "High takeover risk", very_high: "Very high takeover risk" } as const;
const BANK_RE = /commbank|westpac|anz|nab|bank/i;

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, minHeight: 40, justifyContent: "center" },
  chipOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  chipNo: { borderColor: c.barking, backgroundColor: c.barkingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  verdict: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  statTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface },
}));

export default function CheckAccount() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string; scent?: string }>();
  const { ready, setupDone, upsertEvent, resolveEvent, deviceId, adapterLabel, showToast, events } = useApollo();
  const [kind, setKind] = useState<AlertKind>("mfa_prompt");
  const [provider, setProvider] = useState<AccountProvider>("other");
  const [text, setText] = useState(params.text ?? "");
  const [sender, setSender] = useState("");
  const [initiated, setInitiated] = useState<boolean | null>(null);
  const [flags, setFlags] = useState({ repeated: false, enteredPassword: false, enteredCode: false, unusualLocation: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ a: AccountAnalysis; event: PatrolEvent | null; remote: Remote | null; linked: PatrolEvent | null } | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [breach, setBreach] = useState<Breach | null>(null);
  const [tech, setTech] = useState(false);

  const openAccount = events.filter((e) => e.category === "account" && e.status === "active" && e.state !== "resting");
  const recentLinked = useMemo(() => { const now = Date.now(); return events.filter((e) => e.state !== "resting" && ["message", "website", "link", "call", "app", "connection"].includes(e.category) && now - Date.parse(e.occurred_at) <= SCENT_WINDOW_MS); }, [events]);
  const dashTone = openAccount.some((e) => e.state === "barking") ? "barking" : openAccount.length ? "growling" : "resting";

  const run = async () => {
    setBusy(true);
    try {
      const prov = ACCOUNT_PROVIDERS.find((p) => p.id === provider)!;
      const linked = recentLinked.find((e) => e.claimed_brand && ((prov.brand && e.claimed_brand.toLowerCase().includes(prov.brand.toLowerCase())) || (provider === "bank" && BANK_RE.test(e.claimed_brand)))) ?? (initiated === false || flags.enteredCode || flags.enteredPassword ? recentLinked[0] ?? null : null);
      const input = { kind, provider, text: text.trim() || undefined, sender: sender.trim() || undefined, userInitiated: initiated, ...flags, recentScentCategories: (linked ? recentLinked : []).map((e) => e.category), recentScentBrand: linked?.claimed_brand ?? null };
      let a = analyseAccountAlert(input);
      let remote: Remote | null = null;
      try {
        remote = await apiPost<Remote>("/account/analyse", "account_check", { device_id: deviceId ?? "local-device", kind, provider, sender: sender.trim().slice(0, 80), text: text.trim().slice(0, 4000), urls: a.urls.slice(0, 10), local_state: a.state, scenario: a.scenario, second_opinion: true });
        const bad = remote.urls.find((u) => u.verdict === "malicious");
        if (bad && a.state !== "barking") a = { ...a, state: "barking", why: [...a.why, `The link (${bad.host}) is confirmed dangerous by Apollo's threat intelligence.`], handoff: "web" };
      } catch { /* offline: on-device engine is authoritative */ }
      let event: PatrolEvent | null = null;
      if (a.state !== "resting") {
        event = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "account", state: a.state, status: "active", headline: `Account: ${a.title}${a.providerLabel !== "Other / not sure" ? ` — ${a.providerLabel}` : ""}`, what_happened: a.verdict, why: a.why, what_to_do: a.recommendation, indicator_host: a.suspiciousUrls[0] ? a.suspiciousUrls[0].replace(/^https?:\/\//i, "").split("/")[0] : null, indicator_digest: null, local_indicator: text.trim().slice(0, 200) || null, verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: a.claimedBrand, scenario: a.scenario, scent_id: params.scent || linked?.scent_id || linked?.event_id || null });
        if (event.state !== a.state) a = { ...a, state: event.state, why: event.why };
        void NetworkAccountSdk.submitAccountSecurityEvent({ kind, provider, state: a.state });
      }
      setResult({ a, event, remote, linked });
    } finally { setBusy(false); }
  };
  const checkBreach = async () => {
    try { setBreach(await apiPost<Breach>("/account/breach", "breach_check", { device_id: deviceId ?? "local-device", identifier: identifier.trim() })); }
    catch (e) { showToast(e instanceof Error ? e.message : "Couldn't reach the breach service.", "neutral"); }
  };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;
  const recovery = (a?.recoveryKinds.length ? a.recoveryKinds : ["password", "code", "mfa_approved", "locked_out"]) as RecoveryKind[];

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Account Guard</Text>
        <Pressable testID="account-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="account-scroll">
        <Card testID="account-dashboard" style={{ gap: spacing.sm, borderColor: toneColor(colors, dashTone) }}>
          <View style={s.row}><View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><KeyRound size={20} color={toneColor(colors, dashTone)} /><Text style={s.statTitle} testID="account-dashboard-title">{openAccount.length ? `${openAccount.length} account${openAccount.length > 1 ? "s" : ""} need${openAccount.length > 1 ? "" : "s"} attention` : "All good"}</Text></View><Pill tone={dashTone} label={STATE_NAME[dashTone]} /></View>
          <Body>{openAccount.length ? "Review the items below through the official app or website — never through the alert itself." : "No unresolved account-security issues."}</Body>
          {openAccount.slice(0, 3).map((e) => (
            <View key={e.event_id} style={s.row} testID={`account-open-${e.event_id}`}>
              <View style={{ flex: 1 }}><Text style={s.label} numberOfLines={1}>{e.headline.replace(/^Account: /, "")}</Text><Body>{e.what_to_do}</Body></View>
              <Button testID={`account-review-${e.event_id}`} variant="secondary" label="Review" onPress={() => router.push({ pathname: "/patrol/[id]", params: { id: e.event_id } })} />
            </View>
          ))}
        </Card>

        {!result ? (
          <>
            <SectionTitle>Check an account alert</SectionTitle>
            <Body>Paste or describe a login prompt, MFA request, password-reset or security email. Apollo never asks for your password — don&apos;t paste one.</Body>
            <Text style={s.label}>What did you receive?</Text>
            <View style={s.chips}>{ALERT_KINDS.map((o) => <Pressable key={o.id} testID={`account-kind-${o.id}`} accessibilityRole="button" onPress={() => setKind(o.id)} style={[s.chip, kind === o.id && s.chipOn]}><Text style={s.chipText}>{o.label}</Text></Pressable>)}</View>
            <Text style={s.label}>Which service?</Text>
            <View style={s.chips}>{ACCOUNT_PROVIDERS.map((o) => <Pressable key={o.id} testID={`account-provider-${o.id}`} accessibilityRole="button" onPress={() => setProvider(o.id)} style={[s.chip, provider === o.id && s.chipOn]}><Text style={s.chipText}>{o.label}</Text></Pressable>)}</View>
            <Text style={s.label}>Did you just log in, request or make this change yourself?</Text>
            <View style={s.chips}>
              {([["yes", "Yes, that was me", true], ["no", "No, I didn't", false], ["unsure", "Not sure", null]] as const).map(([id, label, v]) => <Pressable key={id} testID={`account-initiated-${id}`} accessibilityRole="button" onPress={() => setInitiated(v)} style={[s.chip, initiated === v && (v === false ? s.chipNo : s.chipOn)]}><Text style={s.chipText}>{label}</Text></Pressable>)}
            </View>
            <Text style={s.label}>Paste the alert text (optional)</Text>
            <TextInput testID="account-text" style={[s.input, { minHeight: 96 }]} value={text} onChangeText={setText} placeholder="e.g. Unusual sign-in activity detected. Verify now: https://…" placeholderTextColor={colors.muted} multiline textAlignVertical="top" autoCapitalize="none" autoCorrect={false} />
            <TextInput testID="account-sender" style={s.input} value={sender} onChangeText={setSender} placeholder="Sender (email address or number, optional)" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
            <View style={s.row}><Text style={[s.why, { flex: 1 }]}>I&apos;ve had several of these prompts in a row</Text><Switch testID="account-flag-repeated" value={flags.repeated} onValueChange={(v) => setFlags((f) => ({ ...f, repeated: v }))} trackColor={{ true: colors.barking, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
            <View style={s.row}><Text style={[s.why, { flex: 1 }]}>The login was from a place or device that makes no sense</Text><Switch testID="account-flag-location" value={flags.unusualLocation} onValueChange={(v) => setFlags((f) => ({ ...f, unusualLocation: v }))} trackColor={{ true: colors.growling, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
            <View style={s.row}><Text style={[s.why, { flex: 1 }]}>I entered my password on a page I&apos;m now unsure about</Text><Switch testID="account-flag-password" value={flags.enteredPassword} onValueChange={(v) => setFlags((f) => ({ ...f, enteredPassword: v }))} trackColor={{ true: colors.barking, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
            <View style={s.row}><Text style={[s.why, { flex: 1 }]}>I typed or read out a verification code</Text><Switch testID="account-flag-code" value={flags.enteredCode} onValueChange={(v) => setFlags((f) => ({ ...f, enteredCode: v }))} trackColor={{ true: colors.barking, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
            {recentLinked.length ? <Card style={{ gap: spacing.xs, borderColor: colors.growling }} testID="account-scent-notice"><Text style={s.label}>Threat Scent</Text><Body>Apollo saw {recentLinked.length} suspicious event{recentLinked.length > 1 ? "s" : ""} in the last 30 minutes{recentLinked[0].claimed_brand ? ` (about ${recentLinked[0].claimed_brand})` : ""}. An account alert now will be assessed as part of that sequence.</Body></Card> : null}
            <Button testID="account-run" label={busy ? "Sniffing…" : "Check this alert"} onPress={() => void run()} disabled={busy} />
          </>
        ) : a ? (
          <>
            <Card testID="account-result" style={{ borderColor: toneColor(colors, a.state), gap: spacing.sm }}>
              <View style={s.chips}><Pill tone={a.state} label={STATE_NAME[a.state]} testID="account-state" /><Pill tone="neutral" label={a.scenario} testID="account-scenario" /><Pill tone={a.takeoverRisk === "low" ? "resting" : a.takeoverRisk === "elevated" ? "growling" : "barking"} label={RISK_LABEL[a.takeoverRisk]} testID="account-risk" /></View>
              <Text style={s.why}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.label} testID="account-title">{a.title}</Text>
              <Text style={s.verdict} testID="account-verdict">{a.verdict}</Text>
              <SectionTitle>Why?</SectionTitle>
              {a.why.map((w, i) => <Text key={i} style={s.why} testID={`account-why-${i}`}>• {w}</Text>)}
              {result.linked ? <Text style={s.why} testID="account-linked">• Connected to: {result.linked.headline} (Threat Scent). These events may be connected — do not approve the login request.</Text> : null}
              <SectionTitle>What to do</SectionTitle>
              <Text style={s.why} testID="account-recommendation">{a.recommendation}</Text>
            </Card>
            {a.urls.length ? (
              <Card style={{ gap: spacing.sm }} testID="account-links">
                <SectionTitle>Links in the alert</SectionTitle>
                {a.urls.map((u, i) => { const r = result.remote?.urls.find((x) => x.url === u || x.host === u.replace(/^https?:\/\//i, "").split("/")[0]); const sus = a.suspiciousUrls.includes(u); return (
                  <View key={u} style={s.row}><View style={{ flex: 1 }}><Text style={s.why} numberOfLines={1}>{u}</Text><Pill tone={r?.verdict === "malicious" ? "biting" : sus ? "growling" : "resting"} label={r?.verdict === "malicious" ? "Confirmed dangerous" : sus ? `Not ${a.providerLabel === "Other / not sure" ? "a known official" : `${a.providerLabel}'s`} domain` : "Official domain"} /></View><Button testID={`account-check-link-${i}`} variant="secondary" label="Check" onPress={() => router.push({ pathname: "/check", params: { url: u.startsWith("http") ? u : `https://${u}`, source: "account" } })} /></View>); })}
              </Card>
            ) : null}
            <Card style={{ gap: spacing.sm }} testID="account-actions">
              <Text style={s.label}>Go in through the front door</Text>
              <Body testID="account-open-official">{a.openOfficial}</Body>
              {result.event ? <RecoveryFlow event={result.event} kinds={recovery} testID="account-recovery" /> : null}
              {result.remote?.explanation ? <><Text style={s.label}>Apollo&apos;s plain-language take</Text><Body testID="account-second-opinion">{result.remote.explanation.summary}</Body></> : null}
              <Button testID="account-ask" variant="secondary" label="Tell me more" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { context: `Account alert check: ${a.title} (${a.providerLabel}). State: ${STATE_NAME[a.state]}. ${a.technical.join("; ")}`, prompt: "What should I do about this account alert?" } })} />
              <Button testID="account-tech" variant="ghost" label="View technical details" onPress={() => setTech((t) => !t)} />
              {tech ? a.technical.map((t, i) => <Body key={i} testID={`account-tech-${i}`}>{t}</Body>) : null}
              {result.event ? <Button testID="account-resolve" variant="ghost" label="I've secured it — mark handled" onPress={() => { void resolveEvent(result.event!); setResult({ ...result, event: { ...result.event!, status: "resolved" } }); }} /> : null}
              {result.event ? <Button testID="account-report" variant="ghost" label="Report a mistake" onPress={async () => { try { await apiPost("/feedback", "feedback", { device_id: deviceId ?? "local-device", event_id: result.event!.event_id, kind: "false_positive", state: result.event!.state, host: result.event!.indicator_host, sources: ["identity_account_engine"], note: "" }); showToast("Thanks — a human will review this.", "neutral"); } catch { showToast("Couldn't send right now.", "neutral"); } }} /> : null}
              <Button testID="account-again" variant="ghost" label="Check another alert" onPress={() => { setResult(null); setText(""); setSender(""); setFlags({ repeated: false, enteredPassword: false, enteredCode: false, unusualLocation: false }); setInitiated(null); }} />
            </Card>
          </>
        ) : null}

        <Card style={{ gap: spacing.sm }} testID="account-breach">
          <SectionTitle>Has this email appeared in a breach?</SectionTitle>
          <Body>Sent once to the breach service, never stored by Apollo. Exposure isn&apos;t a takeover — it&apos;s a reason to tighten up.</Body>
          <TextInput testID="account-breach-id" style={s.input} value={identifier} onChangeText={setIdentifier} placeholder="you@example.com" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          <Button testID="account-breach-run" variant="secondary" label="Check breach exposure" onPress={() => void checkBreach()} disabled={identifier.trim().length < 3} />
          {breach ? (
            <View style={{ gap: spacing.xs }} testID="account-breach-result">
              <Pill tone={breach.status === "found" ? (breach.password_exposed ? "growling" : "ears_up") : breach.status === "clear" ? "resting" : "unknown"} label={breach.status === "found" ? (breach.password_exposed ? "Passwords exposed" : "Appears in a breach") : breach.status === "clear" ? "Not found" : breach.status === "not_configured" ? "Not connected" : "Unavailable"} testID="account-breach-status" />
              <Body testID="account-breach-detail">{breach.detail}</Body>
              {breach.breaches.slice(0, 5).map((b) => <Body key={b.name}>• {b.name} ({b.date}) — {b.data.join(", ")}</Body>)}
              {breach.status === "found" ? <Body>{breach.password_exposed ? "Change that password everywhere you used it, and turn on two-factor authentication." : "Expect targeted phishing. Turn on two-factor authentication and don't reuse passwords."}</Body> : null}
            </View>
          ) : null}
        </Card>
        <Card style={{ gap: spacing.xs }} testID="account-cannot-see">
          <SectionTitle>What Apollo can and can&apos;t see</SectionTitle>
          <Body>Apollo can&apos;t read your email or notifications automatically, and never stores passwords. It works from what you paste or describe, plus authorised integrations (none connected on this build).</Body>
        </Card>
      </KeyboardAwareScrollView>
    </View>
  );
}
