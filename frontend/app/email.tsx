// Gate 1 — Check an Email. Paste a forwarded email (headers included if you have them) or fill From/Subject/Body.
// Read on-device first; links go to the Web gate, account alerts to Account Guard, attachments to Check This File.
import { GateInvestigation } from "@/src/components/GateInvestigation";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Mail from "lucide-react-native/icons/mail";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiDelete, apiGet, apiPost } from "@/src/api/client";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { MessageAssessmentResult } from "@/src/components/MessageAssessmentResult";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { analyseEmail, type EmailAnalysis } from "@/src/domain/emailAnalysis";
import { evaluateLinkGuardFindings, extractAnchorsFromPlainText } from "@/src/domain/linkGuard";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { STATE_RANK } from "@/src/domain/stateMachine";
import { patrolSafeSummary, type InvestigationResult } from "@/src/domain/investigation";
import { redactUserSecrets } from "@/src/domain/privacy";
import { issueContext, openHigginsHandoff } from "@/src/domain/higginsHandoff";
import { dispatchInvestigationAction } from "@/src/domain/investigationActions";
import { type MessageExplanation, type MessageUrlResult, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const GMAIL_STATUS_UI_TIMEOUT_MS = 8000;

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
  const { ready, setupDone, upsertEvent, deviceId, adapterLabel, showToast, scanGmailInbox } = useApollo();
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [raw, setRaw] = useState(params.text ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ a: EmailAnalysis; event: PatrolEvent | null; urls: MessageUrlResult[]; explanation: MessageExplanation | null; assessment: InvestigationResult | null } | null>(null);
  const [verify, setVerify] = useState(false);
  const [tech, setTech] = useState(false);
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [gmailConfigured, setGmailConfigured] = useState(true);
  const [gmailMonitoring, setGmailMonitoring] = useState(false);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [gmailStatusError, setGmailStatusError] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<{ text: string; flagged: number } | null>(null);

  const refreshGmailStatus = useCallback(async () => {
    if (!deviceId) return;
    setGmailConnected(null);
    setGmailStatusError(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Gmail status took too long to answer.")), GMAIL_STATUS_UI_TIMEOUT_MS);
      });
      const response = await Promise.race([
        apiGet<{ connected: boolean; configured: boolean; monitoring_enabled: boolean }>(`/gmail/status?device_id=${deviceId}`),
        timeout,
      ]);
      setGmailConnected(response.connected);
      setGmailConfigured(response.configured);
      setGmailMonitoring(response.monitoring_enabled);
    } catch {
      setGmailConnected(false);
      setGmailStatusError("Apollo couldn't confirm the Gmail connection. Manual email checks remain available.");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [deviceId]);

  useEffect(() => { void refreshGmailStatus(); }, [refreshGmailStatus]);

  // Gmail read-only connect: browser-based OAuth (Web-application client — see backend/services/gmail.py).
  // Native OAuth needs a development/standalone build; this button still works in the web preview.
  const connectGmail = async () => {
    if (!deviceId) return;
    setGmailBusy(true);
    try {
      const redirect = Linking.createURL("/email");
      const { authorization_url } = await apiGet<{ authorization_url: string }>(`/gmail/connect?device_id=${deviceId}&app_redirect=${encodeURIComponent(redirect)}`);
      const res = await WebBrowser.openAuthSessionAsync(authorization_url, redirect);
      if (res.type === "success" && res.url.includes("gmail=connected")) { setGmailConnected(true); setGmailMonitoring(false); showToast("Gmail OAuth connected — monitoring stays off until you enable it.", "resting"); }
      else if (res.type === "success" && res.url.includes("gmail=denied")) showToast("Gmail connection was cancelled.", "neutral");
      else if (res.type !== "cancel" && res.type !== "dismiss") showToast("Couldn't connect Gmail right now.", "growling");
    } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't connect Gmail right now.", "growling"); } finally { setGmailBusy(false); }
  };

  const disconnectGmail = async () => {
    if (!deviceId) return;
    try { await apiDelete(`/gmail/connection?device_id=${deviceId}`); } catch { /* already gone */ }
    setGmailConnected(false); setGmailMonitoring(false); setScanSummary(null);
    showToast("Gmail disconnected.", "neutral");
  };
  const toggleGmailMonitoring = async () => {
    if (!deviceId) return;
    const enabled = !gmailMonitoring;
    await apiPost("/gmail/monitoring", "gmail_monitor", { device_id: deviceId, enabled });
    setGmailMonitoring(enabled); showToast(enabled ? "Ongoing Gmail assessment enabled." : "Ongoing Gmail assessment stopped.", enabled ? "resting" : "neutral");
  };

  const scanInbox = async () => {
    setScanBusy(true); setScanSummary(null);
    try {
      const { checked, flagged } = await scanGmailInbox();
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
      setScanSummary({ text: flagged.length ? `Checked ${plural(checked, "email")} — ${plural(flagged.length, "email")} need${flagged.length === 1 ? "s" : ""} a look.` : `Checked ${plural(checked, "email")} — no concerns were identified within those checks.`, flagged: flagged.length });
      showToast(flagged.length ? `Found ${plural(flagged.length, "email")} needing a look` : "No concerns identified in the checked Gmail messages", flagged.length ? "growling" : "resting");
    } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't scan your inbox right now.", "growling"); } finally { setScanBusy(false); }
  };

  const run = async () => {
    setBusy(true);
    try {
      const safeRaw = redactUserSecrets(raw); const safeSubject = redactUserSecrets(subject);
      if (safeRaw !== raw) setRaw(safeRaw); if (safeSubject !== subject) setSubject(safeSubject);
      let a = analyseEmail(safeRaw, { from, subject: safeSubject });
      let urls: MessageUrlResult[] = []; let explanation: MessageExplanation | null = null; let assessment: InvestigationResult | null = null;
      try {
        const r = await apiPost<{ urls: MessageUrlResult[]; explanation: MessageExplanation | null; assessment: InvestigationResult }>("/message/analyse", "message_check", {
          device_id: deviceId ?? 'local-device', sender: from.trim(), text: `${safeSubject}\n${safeRaw}`, urls: a.urls,
          local_state: a.state, scenario: a.scenario, signals: a.signalLabels.slice(0, 20), claimed_brand: a.claimedBrand, second_opinion: true,
        });
        urls = r.urls; explanation = r.explanation; assessment = r.assessment;
        if (assessment.risk === "warning" && a.state === "resting") a = { ...a, state: "growling", why: [...a.why, "The contextual investigation found unresolved or suspicious details that need verification."] };
        // Email Gate: automatic pre-click assessment — redirect chain + RDAP domain-info (already
        // inside `urls`) plus any display-text-vs-real-destination mismatch recoverable from the
        // plain pasted text. Can only raise state to growling/barking, never biting.
        const guard = evaluateLinkGuardFindings(urls, extractAnchorsFromPlainText(safeRaw));
        if (STATE_RANK[guard.state] > STATE_RANK[a.state]) a = { ...a, state: guard.state, why: [...a.why, ...guard.why] };
        else if (guard.why.length) a = { ...a, why: [...a.why, ...guard.why] };
      } catch { /* offline: on-device result stands */ }
      let event: PatrolEvent | null = null;
      if (a.state !== "resting") {
        event = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "email", state: a.state, status: "active", headline: `Email: ${assessment?.higgins.headline ?? a.title}`, what_happened: patrolSafeSummary(assessment?.higgins.what_was_found[0] ?? a.verdict), why: assessment?.findings.map((finding) => finding.title).slice(0, 6) ?? a.why, what_to_do: assessment?.higgins.next_action ?? a.recommendation, indicator_host: a.lookalikeUrls[0] ? a.lookalikeUrls[0].replace(/^https?:\/\//i, "").split("/")[0] : a.senderDomain, indicator_digest: null, local_indicator: null, verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: a.claimedBrand, scenario: a.scenario, supporting_references: assessment?.sources.filter((source) => source.url).map((source) => ({ label: source.label, url: source.url! })).slice(0, 6) });
        if (event.state !== a.state) a = { ...a, state: event.state, why: event.why };
      }
      setResult({ a, event, urls, explanation, assessment });
    } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't read that email.", "barking"); } finally { setBusy(false); }
  };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;
  const scent = result?.event?.scent_id ?? result?.event?.event_id ?? "";

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Email Gate</Text>
        <Pressable testID="email-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="email-scroll">
        {!result ? (
          <>
            {gmailConfigured ? (
              <Card testID="email-gmail-card" style={{ gap: spacing.sm }}>
                <SectionTitle>Connect Gmail (optional)</SectionTitle>
                {gmailConnected === null ? (
                  <View testID="email-gmail-checking" style={s.row}>
                    <Body>Checking connection…</Body>
                    <ActivityIndicator color={colors.brand} />
                  </View>
                ) : gmailConnected ? (
                  <>
                    <View style={s.chips}><Pill tone="resting" label="Gmail OAuth connected — read-only" testID="email-gmail-connected" /></View>
                    <Button testID="email-gmail-scan" label={scanBusy ? "Assessing recent Gmail…" : "Assess recent Gmail"} icon={scanBusy ? <ActivityIndicator color={colors.onBrandPrimary} /> : undefined} onPress={() => void scanInbox()} disabled={scanBusy || gmailBusy} />
                    <Button testID="email-gmail-monitoring" variant="secondary" label={gmailMonitoring ? "Stop ongoing Gmail monitoring" : "Enable ongoing Gmail monitoring"} onPress={() => void toggleGmailMonitoring()} disabled={scanBusy || gmailBusy} />
                    <Body testID="email-gmail-monitoring-status">{gmailMonitoring ? "Monitoring requested. Gates shows Active only after a fresh successful monitor check." : "Ongoing monitoring is off."}</Body>
                    {scanSummary ? (
                      <>
                        <Body testID="email-gmail-scan-summary">{scanSummary.text}</Body>
                        {scanSummary.flagged ? <Button testID="email-gmail-view-patrol" variant="secondary" label="View in Patrol" onPress={() => router.push("/(tabs)/patrol")} /> : null}
                      </>
                    ) : null}
                    <Button testID="email-gmail-disconnect" variant="ghost" label="Disconnect Gmail" onPress={() => void disconnectGmail()} disabled={scanBusy || gmailBusy} />
                  </>
                ) : (
                  <>
                    {gmailStatusError ? <Body testID="email-gmail-status-error">{gmailStatusError}</Body> : null}
                    <Body testID="email-gmail-policy">Connecting Gmail uses Google&apos;s read-only OAuth consent. Apollo never asks for or stores your Gmail username or password. Recent messages are used for the assessment, then discarded; only summaries and safe references may enter Patrol.</Body>
                    <Button testID="email-gmail-connect" variant="secondary" icon={gmailBusy ? <ActivityIndicator color={colors.brand} /> : <Mail size={18} color={colors.onSurface} />} label={gmailBusy ? "Opening Google…" : "Connect Gmail read-only"} onPress={() => void connectGmail()} disabled={gmailBusy || !deviceId} />
                    {gmailStatusError ? <Button testID="email-gmail-status-retry" variant="ghost" label="Check connection again" onPress={() => void refreshGmailStatus()} disabled={!deviceId} /> : null}
                  </>
                )}
              </Card>
            ) : null}
            <Body testID="email-processing-scope">Submitting this email authorises one assessment of its sender, body and links. Apollo does not retain the full email; provider-side retention follows configured services.</Body>
            <TextInput testID="email-from" style={s.input} value={from} onChangeText={setFrom} placeholder="From (e.g. CommBank <alerts@cb-secure.top>)" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
            <TextInput testID="email-subject" style={s.input} value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={colors.muted} autoCorrect={false} />
            <TextInput testID="email-body" style={[s.input, { minHeight: 140 }]} value={raw} onChangeText={setRaw} placeholder="Paste the email (or the whole forwarded message with headers)…" placeholderTextColor={colors.muted} multiline textAlignVertical="top" autoCapitalize="none" autoCorrect={false} />
            <Button testID="email-run" label={busy ? "Sniffing…" : "Check this email"} onPress={() => void run()} disabled={busy || !(raw.trim() || from.trim() || subject.trim())} />
            <Button testID="email-check-screenshot" variant="secondary" label="Assess an email screenshot" onPress={() => router.push({ pathname: "/message", params: { openScreenshot: "1", source: "email" } })} />
            <Body testID="email-preview-disclaimer">Preview note: choose the email screenshot manually. Apollo cannot read or retrieve a message from another app&apos;s notification preview.</Body>
          </>
        ) : a ? (
          <>
            {result.assessment ? <MessageAssessmentResult assessment={result.assessment} state={a.state} testIDPrefix="email"
              submittedLabel="Email investigated" submittedTitle={a.parsed.fromAddress || from || "Sender not supplied"} submittedText={`${a.parsed.subject ?? subject}\n${a.parsed.body || raw}`.trim()}
              onPrimaryAction={() => dispatchInvestigationAction(result.assessment!.higgins.action_kind, {
                showVerification: () => setVerify(true), showCallingGuidance: () => setVerify(true), openAccount: () => router.push({ pathname: "/account", params: { text: `${a.parsed.subject ?? ""}\n${a.parsed.body}`.trim().slice(0, 3000), scent } }),
                clearSubmittedCopy: () => { setRaw(""); setFrom(""); setSubject(""); showToast("The copy submitted to Apollo was cleared from this screen. The original email was not deleted.", "neutral"); }, showReview: () => setTech(true),
              })} /> : <Card testID="email-result" style={{ borderColor: toneColor(colors, a.state), gap: spacing.sm }}>
              <View style={s.chips}><Pill tone={a.state} label={STATE_NAME[a.state]} testID="email-state" /><Pill tone="neutral" label={a.scenario} testID="email-scenario" />{a.claimedBrand ? <Pill tone="neutral" label={`Claims: ${a.claimedBrand}`} testID="email-brand" /> : null}</View>
              <Text style={s.why}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.label} testID="email-title">{a.title}</Text>
              <Text style={s.verdict} testID="email-verdict">{a.verdict}</Text>
              <SectionTitle>Why?</SectionTitle>
              {a.why.map((w, i) => <Text key={i} style={s.why} testID={`email-why-${i}`}>• {w}</Text>)}
              <SectionTitle>What to do</SectionTitle>
              <Text style={s.why} testID="email-recommendation">{a.recommendation}</Text>
              {a.signalLabels.length ? <View style={s.chips}>{a.signalLabels.map((l) => <Pill key={l} tone="neutral" label={l} />)}</View> : null}
            </Card>}
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
                <Body testID="email-attachment-limitation">Apollo only found the attachment name in the pasted email. The file itself was not transferred. File Gate will ask you to select the actual attachment before inspecting its contents.</Body>
                <Button testID="email-check-file" variant="secondary" label="Check the file with Apollo" onPress={() => router.push({ pathname: "/file", params: { source: "email" } })} accessibilityLabel="Open File Gate to select and inspect the attachment" accessibilityHint="The actual attachment must be selected before Apollo can inspect it." />
              </Card>
            ) : null}
            <Card style={{ gap: spacing.sm }} testID="email-actions">
              {a.handoff.account ? <Button testID="email-check-account" variant={a.state === "barking" ? "warning" : "secondary"} label="It's about my account — Account Gate" onPress={() => router.push({ pathname: "/account", params: { text: `${a.parsed.subject ?? ""}\n${a.parsed.body}`.trim().slice(0, 3000), scent } })} /> : null}
              <Button testID="email-verify-sender" variant="secondary" label="Show me how to check the sender" onPress={() => setVerify(true)} />
              {result.explanation ? <><Text style={s.label}>Higgins&apos;s plain-language assessment</Text><Body testID="email-second-opinion">{result.explanation.summary}</Body></> : null}
              {result.event ? <RecoveryFlow event={result.event} kinds={["clicked", "password", "code", "money", "card", "info", "download"]} linkToCheck={a.urls[0] ?? null} testID="email-recovery" /> : null}
              <GateInvestigation submission={result} testID="email-ask" label="Ask Higgins about this email" autoStart={false} context={issueContext({ gate: "email", issue_summary: a.title, assessment_state: a.state, findings: a.why.slice(0, 6).map((summary) => ({ summary, provenance: "inferred", status: "uncertain" })), uncertainty: ["The sender was not independently authenticated."], confirmed_protective_actions: [], user_reported_actions: [], original_evidence: [{ kind: "text", value: `From: ${from}\nSubject: ${subject}\n\n${raw}`, label: "submitted email" }, ...(result.explanation ? [{ kind: "text" as const, value: `Apollo email check already performed (reuse; do not repeat the same lookups):\n${JSON.stringify(result.explanation).slice(0, 8000)}`, label: "apollo email check" }] : [])] })} question="What should I do about this email?" />
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
