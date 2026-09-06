// Gate 1 — Check an Email. Paste a forwarded email (headers included if you have them) or fill From/Subject/Body.
// Read on-device first; links go to the Web gate, account alerts to Account Guard, attachments to Check This File.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { analyseEmail, type EmailAnalysis } from "@/src/domain/emailAnalysis";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { type MessageExplanation, type MessageUrlResult, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  verdict: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
}));

export default function CheckEmail() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string }>();
  const { ready, setupDone, upsertEvent, deviceId, adapterLabel, showToast } = useApollo();
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [raw, setRaw] = useState(params.text ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ a: EmailAnalysis; event: PatrolEvent | null; urls: MessageUrlResult[]; explanation: MessageExplanation | null } | null>(null);
  const [verify, setVerify] = useState(false);
  const [tech, setTech] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      let a = analyseEmail(raw, { from, subject });
      let urls: MessageUrlResult[] = []; let explanation: MessageExplanation | null = null;
      try {
        const r = await apiPost<{ urls: MessageUrlResult[]; explanation: MessageExplanation | null }>("/message/analyse", "message_check", {
          device_id: deviceId ?? "local-device", sender: (a.parsed.fromAddress ?? a.parsed.fromName ?? "").slice(0, 80), text: `${a.parsed.subject ?? ""}\n${a.parsed.body}`.trim().slice(0, 4000) || "(no body)", urls: a.urls.slice(0, 10),
          local_state: a.state, scenario: a.scenario, signals: a.signalLabels.slice(0, 20), claimed_brand: a.claimedBrand, second_opinion: true,
        });
        urls = r.urls; explanation = r.explanation;
        const bad = urls.find((u) => u.verdict === "malicious");
        if (bad && a.state !== "barking") a = { ...a, state: "barking", why: [...a.why, `The link (${bad.host}) is confirmed dangerous by Apollo's threat intelligence.`] };
      } catch { /* offline: on-device result stands */ }
      let event: PatrolEvent | null = null;
      if (a.state !== "resting") {
        event = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "email", state: a.state, status: "active", headline: `Email: ${a.title}`, what_happened: a.verdict, why: a.why, what_to_do: a.recommendation, indicator_host: a.lookalikeUrls[0] ? a.lookalikeUrls[0].replace(/^https?:\/\//i, "").split("/")[0] : a.senderDomain, indicator_digest: null, local_indicator: a.parsed.subject, verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: a.claimedBrand, scenario: a.scenario });
        if (event.state !== a.state) a = { ...a, state: event.state, why: event.why };
      }
      setResult({ a, event, urls, explanation });
    } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't read that email.", "barking"); } finally { setBusy(false); }
  };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;
  const scent = result?.event?.scent_id ?? result?.event?.event_id ?? "";

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check an email</Text>
        <Pressable testID="email-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="email-scroll">
        {!result ? (
          <>
            <Body>Forward the email to yourself and paste it here — including the From / Subject lines if you can — or fill the fields. Apollo reads it on your phone first; only the text and links you paste are checked for reputation. Apollo never reads your inbox.</Body>
            <TextInput testID="email-from" style={s.input} value={from} onChangeText={setFrom} placeholder="From (e.g. CommBank <alerts@cb-secure.top>)" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
            <TextInput testID="email-subject" style={s.input} value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={colors.muted} autoCorrect={false} />
            <TextInput testID="email-body" style={[s.input, { minHeight: 140 }]} value={raw} onChangeText={setRaw} placeholder="Paste the email (or the whole forwarded message with headers)…" placeholderTextColor={colors.muted} multiline textAlignVertical="top" autoCapitalize="none" autoCorrect={false} />
            <Button testID="email-run" label={busy ? "Sniffing…" : "Check this email"} onPress={() => void run()} disabled={busy || !(raw.trim() || from.trim() || subject.trim())} />
          </>
        ) : a ? (
          <>
            <Card testID="email-result" style={{ borderColor: toneColor(colors, a.state), gap: spacing.sm }}>
              <View style={s.chips}><Pill tone={a.state} label={STATE_NAME[a.state]} testID="email-state" /><Pill tone="neutral" label={a.scenario} testID="email-scenario" />{a.claimedBrand ? <Pill tone="neutral" label={`Claims: ${a.claimedBrand}`} testID="email-brand" /> : null}</View>
              <Text style={s.why}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.label} testID="email-title">{a.title}</Text>
              <Text style={s.verdict} testID="email-verdict">{a.verdict}</Text>
              <SectionTitle>Why?</SectionTitle>
              {a.why.map((w, i) => <Text key={i} style={s.why} testID={`email-why-${i}`}>• {w}</Text>)}
              <SectionTitle>What to do</SectionTitle>
              <Text style={s.why} testID="email-recommendation">{a.recommendation}</Text>
              {a.signalLabels.length ? <View style={s.chips}>{a.signalLabels.map((l) => <Pill key={l} tone="neutral" label={l} />)}</View> : null}
            </Card>
            <Card style={{ gap: spacing.xs }} testID="email-sender">
              <SectionTitle>Who sent it</SectionTitle>
              <Body testID="email-sender-line">{a.parsed.fromName ? `${a.parsed.fromName} ` : ""}{a.parsed.fromAddress ? `<${a.parsed.fromAddress}>` : "(no address given)"}</Body>
              {a.senderDomain ? <Pill tone={a.claimedBrand && a.scenario !== "E11" && /E01|E07/.test(a.scenario) ? "barking" : a.scenario === "E11" ? "resting" : "neutral"} label={a.scenario === "E11" ? `${a.senderDomain} — official` : /E01|E07/.test(a.scenario) ? `${a.senderDomain} — not ${a.claimedBrand}'s domain` : a.senderDomain} testID="email-sender-domain" /> : null}
              {a.parsed.replyTo ? <Body>Replies go to: {a.parsed.replyTo}</Body> : null}
            </Card>
            {a.urls.length ? (
              <Card style={{ gap: spacing.sm }} testID="email-links">
                <SectionTitle>Links in the email</SectionTitle>
                {a.urls.map((u, i) => { const r = result.urls.find((x) => x.url === u || x.host === u.replace(/^https?:\/\//i, "").split("/")[0]); const off = a.lookalikeUrls.includes(u); return (
                  <View key={u} style={s.row}><View style={{ flex: 1 }}><Text style={s.why} numberOfLines={1}>{u}</Text><Pill tone={r?.verdict === "malicious" ? "biting" : off ? "growling" : r?.verdict === "clean" ? "resting" : "neutral"} label={r?.verdict === "malicious" ? "Confirmed dangerous" : off ? `Not ${a.claimedBrand}'s site` : r?.verdict === "clean" ? "No known threat" : "Unchecked"} /></View><Button testID={`email-check-link-${i}`} variant="secondary" label="Check" onPress={() => router.push({ pathname: "/check", params: { url: u.startsWith("http") ? u : `https://${u}`, source: "email" } })} /></View>); })}
              </Card>
            ) : null}
            {a.parsed.attachments.length ? (
              <Card style={{ gap: spacing.xs }} testID="email-attachments">
                <SectionTitle>Attachments mentioned</SectionTitle>
                {a.parsed.attachments.map((at) => <View key={at} style={s.row}><Text style={[s.why, { flex: 1 }]} numberOfLines={1}>{at}</Text><Pill tone={a.riskyAttachments.includes(at) ? "barking" : "neutral"} label={a.riskyAttachments.includes(at) ? "Risky type" : "Document"} /></View>)}
                <Button testID="email-check-file" variant="secondary" label="Check the file with Apollo" onPress={() => router.push("/file")} />
              </Card>
            ) : null}
            <Card style={{ gap: spacing.sm }} testID="email-actions">
              {a.handoff.account ? <Button testID="email-check-account" variant={a.state === "barking" ? "warning" : "secondary"} label="It's about my account — Account Guard" onPress={() => router.push({ pathname: "/account", params: { text: `${a.parsed.subject ?? ""}\n${a.parsed.body}`.trim().slice(0, 3000), scent } })} /> : null}
              <Button testID="email-verify-sender" variant="secondary" label="Verify sender safely" onPress={() => setVerify(true)} />
              {result.explanation ? <><Text style={s.label}>Apollo&apos;s plain-language take</Text><Body testID="email-second-opinion">{result.explanation.summary}</Body></> : null}
              {result.event ? <RecoveryFlow event={result.event} kinds={["clicked", "password", "code", "money", "card", "info", "download"]} linkToCheck={a.urls[0] ?? null} testID="email-recovery" /> : null}
              <Button testID="email-ask" variant="ghost" label="Tell me more (Ask Higgins)" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { context: `Email check: ${a.title}. State: ${STATE_NAME[a.state]}. ${a.technical.join("; ")}`, prompt: "What should I do about this email?" } })} />
              <Button testID="email-tech" variant="ghost" label="View technical details" onPress={() => setTech(true)} />
              <Button testID="email-again" variant="ghost" label="Check another email" onPress={() => { setResult(null); setRaw(""); setFrom(""); setSubject(""); }} />
            </Card>
          </>
        ) : null}
      </KeyboardAwareScrollView>
      <Sheet visible={verify} onClose={() => setVerify(false)} title="Verify the sender safely" testID="email-verify-sheet">
        <Body testID="email-verify-text">{a?.verifySender}</Body>
        <Button testID="email-verify-close" variant="ghost" label="Done" onPress={() => setVerify(false)} />
      </Sheet>
      <Sheet visible={tech} onClose={() => setTech(false)} title="Technical details" testID="email-tech-sheet">
        {a?.technical.map((t, i) => <Body key={i} testID={`email-tech-${i}`}>{t}</Body>)}
        <Button testID="email-tech-close" variant="ghost" label="Done" onPress={() => setTech(false)} />
      </Sheet>
    </View>
  );
}
