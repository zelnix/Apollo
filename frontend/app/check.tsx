import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { Image as ExpoImage } from "expo-image";
import ImageIcon from "lucide-react-native/icons/image";
import Globe from "lucide-react-native/icons/globe";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost, apiUpload } from "@/src/api/client";
import { CheckResultScreen } from "@/src/components/CheckResultScreen";
import { EventActions } from "@/src/components/EventActions";
import { contextFromEvent, gateForCategory } from "@/src/domain/higginsHandoff";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { ScreenshotPermissionSheet } from "@/src/components/ScreenshotPermissionSheet";
import { ImagePrivacyGate, type GateResult } from "@/src/components/ImagePrivacyGate";
import { screenImage, type ScreeningResult } from "@/src/domain/imagePrivacy";
import { Body, Button, Pill, Card, toneColor } from "@/src/components/ui";
import { buildLinkCheckResult } from "@/src/domain/linkCheckResultAdapter";
import { verifyWebsite } from "@/src/domain/brand";
import { analysePage, type PageAnalysis, type PageSignals } from "@/src/domain/pageAnalysis";
import { STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { saveCheck } from "@/src/store/savedCheckStore";
import { useApollo, type CheckOutcome } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { InfoButton } from "@/src/components/InfoButton";
import { useScreenshotAccess } from "@/src/hooks/useScreenshotAccess";
import { extractUrl } from "@/src/share/classifyShare";
import { getShareIntake } from "@/src/share/shareIntake";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  subtitle: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary, marginBottom: spacing.xs },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xl },
  inputWrap: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", paddingLeft: spacing.lg, paddingRight: spacing.sm },
  input: { flex: 1, minHeight: 52, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  paste: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headline: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, letterSpacing: -0.3 },
  sub: { fontFamily: fonts.display, fontSize: 13, color: c.onSurfaceSecondary, letterSpacing: 1, textTransform: "uppercase", marginTop: spacing.sm },
  bullet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  hint: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  sourceRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: 4 },
  preview: { width: "100%", height: 180, borderRadius: radius.md, backgroundColor: c.surfaceTertiary },
}));

export default function CheckLink() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { checkLink, events, ready, setupDone, deviceId, showToast, recordPageAnalysis } = useApollo();
  const [verify, setVerify] = useState(false);
  const [report, setReport] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [tech, setTech] = useState(false);
  const [saved, setSaved] = useState(false);
  const [page, setPage] = useState<PageAnalysis | null>(null);
  const [pageEvent, setPageEvent] = useState<PatrolEvent | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageHigginsNote, setPageHigginsNote] = useState<string | null>(null);
  const [pageScreenshotUri, setPageScreenshotUri] = useState<string | null>(null);
  // ── Privacy Gate state for page screenshots ──
  const [pageGateScreening, setPageGateScreening] = useState<ScreeningResult | null>(null);
  const [pendingPageScreenshot, setPendingPageScreenshot] = useState<{ uri: string; name: string; type: string } | null>(null);

  const applyPageSignals = async (signals: PageSignals, note: string | null) => {
    const analysis = analysePage(signals, input);
    setPage(analysis); setPageHigginsNote(note); setPageEvent(await recordPageAnalysis(analysis, pageEvent));
  };
  const launchPagePicker = async () => {
    if (!deviceId) return;
    try {
      setPageError(null);
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 0.9 });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      setPageScreenshotUri(asset.uri);
      // ── On-device privacy screening before any transmission ──
      const screening = await screenImage(asset.uri, "investigation_evidence");
      setPageGateScreening(screening);
      setPendingPageScreenshot({ uri: asset.uri, name: asset.fileName ?? "page-screenshot.jpg", type: asset.mimeType ?? "image/jpeg" });
    } catch (error) { setPageError(error instanceof Error ? error.message : "Could not screen that screenshot."); }
  };

  const handlePageGateComplete = async (result: GateResult) => {
    setPageGateScreening(null);
    const file = pendingPageScreenshot;
    setPendingPageScreenshot(null);
    if (result.decision === "withheld") {
      setPageScreenshotUri(null);
      return;
    }
    if (result.decision === "text_only" && result.text) {
      // Text-only: cannot run visual page analysis without an image
      setPageError("Page analysis requires the screenshot image. Choose 'Send redacted image' or crop manually.");
      return;
    }
    if (!deviceId || !file) return;
    try {
      const uploadUri = result.imageUri ?? file.uri;
      const signals = await apiUpload<PageSignals>("/page/extract", "page_extract",
        { device_id: deviceId, url_hint: input.trim(), sanitization_status: "approved" },
        { uri: uploadUri, name: file.name, type: file.type });
      await applyPageSignals(signals, "Higgins extracted visible page signals; Apollo's local rules made the assessment.");
    } catch (error) { setPageError(error instanceof Error ? error.message : "Could not assess that screenshot."); }
  };

  const handlePageGateCancel = () => {
    setPageGateScreening(null);
    setPendingPageScreenshot(null);
    setPageScreenshotUri(null);
  };
  const photoAccess = useScreenshotAccess(launchPagePicker);
  // Gate 3 Phase C: Apollo fetches the page itself (SSRF-safe, backend-only) instead of a screenshot.
  // Manual/opt-in, coexists with "Add a screenshot of the page" above — the content is checked and
  // discarded server-side, never stored (see routers/analysis.py page_crawl).
  const crawlPage = async () => {
    if (!deviceId || !input.trim()) return;
    try {
      setPageError(null);
      const result = await apiPost<{ signals: PageSignals | null; higgins_note: string | null; error: string | null; error_detail: string | null }>("/page/crawl", "page_crawl", { device_id: deviceId, url: input.trim() });
      if (!result.signals) throw new Error(result.error_detail ?? "Apollo could not inspect that page.");
      await applyPageSignals(result.signals, result.higgins_note);
    } catch (error) { setPageError(error instanceof Error ? error.message : "Could not inspect that page."); }
  };
  const sendFeedback = async (kind: "false_positive" | "override", ev: { event_id: string; state: string; indicator_host: string | null }, sources: string[]) => {
    await apiPost("/feedback", "feedback", { device_id: deviceId, event_id: ev.event_id, kind, state: ev.state, host: ev.indicator_host, sources, note: "" });
  };
  const params = useLocalSearchParams<{ url?: string; source?: string; sharedIntakeId?: string }>();
  const shared = getShareIntake(params.sharedIntakeId);
  const sharedUrl = shared?.webUrl || extractUrl(shared?.text) || params.url || "";
  const [input, setInput] = useState(String(sharedUrl));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const autoRan = useRef(false);

  const liveEvent = outcome?.event ? events.find((e) => e.event_id === outcome.event!.event_id) ?? outcome.event : null;
  const state = liveEvent?.state ?? outcome?.decision.state;

  const run = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setBusy(true); setOutcome(null);
    try { setOutcome(await checkLink(value)); } finally { setBusy(false); }
  }, [checkLink]);

  // Shared / deep-linked / clipboard links run automatically once setup is complete.
  useEffect(() => {
    if (sharedUrl && ready && setupDone && !autoRan.current) { autoRan.current = true; void run(String(sharedUrl)); }
  }, [sharedUrl, ready, setupDone, run]);

  if (ready && !setupDone) return <Redirect href="/onboarding" />;
  const paste = async () => { const t = await Clipboard.getStringAsync(); if (t) setInput(t.trim()); };
  const sourceLabel = params.source === "share" ? "Shared into Apollo" : params.source === "clipboard" ? "From your clipboard" : params.source === "link" ? "Opened via link" : null;

  // UNIVERSAL CHECK RESULT — when the manual check has produced an outcome, the entire screen
  // becomes the shared Check Result (ONE Higgins paragraph, ONE items list, ONE actions row). No
  // duplicate verdict cards, no auto-asked follow-up questions. Technical evidence stays in the
  // "Full investigation details" expand.
  if (outcome && state) {
    const model = buildLinkCheckResult({ outcome, liveEvent, rawInput: input });
    const askPrompt = `About the link I just checked (${model.subject}). ${model.headline} Can you walk me through what Apollo found and what I should do?`;
    const actions: { label: string; onPress: () => void; testID: string; variant?: "primary" | "secondary" | "ghost" }[] = [];
    if (liveEvent && (liveEvent.state === "biting" || liveEvent.state === "barking" || liveEvent.state === "growling" || liveEvent.state === "ears_up")) {
      actions.push({ testID: "check-verify-website", variant: "ghost", label: "Show me how to check the website", onPress: () => setVerify(true) });
    }
    actions.push({ testID: "check-tech-details", variant: "ghost", label: liveEvent?.state === "biting" ? "What happened? / Deep technical details" : "Deep technical details", onPress: () => setTech(true) });
    if (liveEvent && liveEvent.state !== "resting") {
      actions.push({ testID: "check-report-mistake", variant: "ghost", label: "Report mistake", onPress: () => setReport(true) });
    }
    actions.push({
      testID: "check-save",
      variant: "ghost",
      label: saved ? "Saved ✓ — View saved checks" : "Save this check",
      onPress: () => {
        if (saved) { router.push("/saved-checks"); return; }
        if (!liveEvent || !outcome) return;
        void saveCheck({
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          gate: "link",
          title: liveEvent.headline ?? outcome.decision.headline,
          subject: outcome.local.host || input.trim() || "link",
          state: liveEvent.state,
          stateName: STATE_NAME[liveEvent.state],
          summary: liveEvent.what_happened ?? outcome.decision.what_happened,
          recommendation: liveEvent.what_to_do ?? outcome.decision.what_to_do,
          sections: [
            { title: "Why", lines: liveEvent.why ?? outcome.decision.why },
            { title: "Intelligence", lines: outcome?.intel ? outcome.intel.sources.map((x) => `${x.name} = ${x.status}`) : [] },
            { title: "Confidence", lines: [outcome.decision.confidence] },
          ],
        }).then(() => { setSaved(true); showToast("Saved. Find it under Saved checks.", "neutral"); });
      },
    });

    return (
      <>
        <CheckResultScreen
          result={model}
          onAskHiggins={() => router.push({
            pathname: "/(tabs)/ask",
            params: {
              context: liveEvent ? JSON.stringify({ ...contextFromEvent(liveEvent, gateForCategory(liveEvent.category)), original_evidence: [...(input.trim() ? [{ kind: "url" as const, value: input.trim(), label: "checked link" }] : [])] }) : "",
              prompt: askPrompt,
            },
          })}
          actions={actions}
        />
        {/* Recovery flow stays available for non-resting results — rendered via a Sheet below. */}
        {liveEvent && liveEvent.state !== "resting" ? (
          <RecoveryFlow event={liveEvent} kinds={["clicked", "password", "card", "code", "download", "app", "called"]} testID="check-recovery" />
        ) : null}
        <Sheet visible={verify} onClose={() => setVerify(false)} title="Verify website" testID="verify-website-sheet">
          {(() => { const v = outcome?.local.host ? verifyWebsite(outcome.local.host, outcome.decision.claimed_brand) : null; return v ? (
            <>
              <Pill tone={v.matches === true ? "resting" : v.matches === false ? "barking" : "unknown"} label={v.title} testID="verify-website-title" />
              {v.lines.map((l, i) => <Body key={i} testID={`verify-website-line-${i}`}>{l}</Body>)}
              <Body>Apollo compares against an independently maintained list of official domains — never information from the page itself.</Body>
            </>
          ) : null; })()}
          <Button testID="verify-website-close" variant="ghost" label="Done" onPress={() => setVerify(false)} />
        </Sheet>
        <Sheet visible={tech} onClose={() => setTech(false)} title="Deep technical details" testID="tech-details-sheet">
          {outcome ? (
            <>
              <Body>Checked: {outcome.local.normalizedUrl ?? outcome.local.input}</Body>
              {outcome.intel?.final_url ? <Body>Final destination: {outcome.intel.final_url}</Body> : null}
              <Body>On-device score: {outcome.local.score}/100 ({outcome.local.level}). Signals: {outcome.local.signals.map((x) => x.code).join(", ") || "none"}.</Body>
              <Body>Intelligence: {outcome.intel ? outcome.intel.sources.map((x) => `${x.name} = ${x.status}`).join("; ") : "unavailable"}. Verdict: {outcome.intel?.verdict ?? "n/a"}. Coverage: {outcome.intel?.coverage ?? "none"}.</Body>
              <Body>Adapter: {liveEvent?.adapter_label}. Verified block: {liveEvent?.verified_block ? "yes" : "no"}. Event: {liveEvent?.event_id.slice(0, 8)}…</Body>
            </>
          ) : null}
          <Button testID="tech-details-close" variant="ghost" label="Done" onPress={() => setTech(false)} />
        </Sheet>
        <Sheet visible={report} onClose={() => setReport(false)} title="Report a mistake" testID="report-sheet">
          <Body>Think Apollo got this wrong? Your report includes the event, Apollo&apos;s decision, the domain and which intelligence sources responded — nothing else. A human reviews it; one report never whitelists a site for everyone.</Body>
          {reportError ? <Body testID="report-error">{reportError}</Body> : null}
          <Button testID="report-send" label={reportBusy ? "Sending…" : reportError ? "Retry report" : "Send report"} disabled={reportBusy} onPress={() => { if (!liveEvent) return; setReportBusy(true); setReportError(null); void sendFeedback("false_positive", liveEvent, outcome?.intel?.sources.map((x) => x.name) ?? []).then(() => { setReport(false); showToast("Thanks — report sent for review.", "resting"); }).catch(() => setReportError("The report was not sent. Check your connection and retry." )).finally(() => setReportBusy(false)); }} />
          <Button testID="report-cancel" variant="ghost" label="Cancel" onPress={() => setReport(false)} />
        </Sheet>
      </>
    );
  }

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
          <Text style={s.title}>Link Gate</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <InfoButton info={{ title: "About Link Gate", body: ["Paste or share any URL and Apollo will inspect the destination page, check it against known threat databases, and have Higgins explain the result.", "Apollo checks domain reputation, SSL certificates, redirect chains and page content. The link is visited in a sandboxed environment — your device never loads the page directly."] }} testID="check-info" />
          <Pressable testID="check-close" accessibilityRole="button" accessibilityLabel="Close" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
        </View>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={16}>
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" testID="check-scroll">
          <Text style={s.subtitle}>Paste any URL and Apollo will inspect it in a sandbox.</Text>
          <View style={s.inputWrap}>
            <TextInput
              testID="check-url-input"
              style={s.input}
              value={input}
              onChangeText={setInput}
              placeholder="Paste a link, e.g. https://example.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => run(input)}
            />
            <Pressable testID="check-paste-button" accessibilityLabel="Paste" onPress={paste} style={s.paste}><ClipboardPaste size={20} color={colors.onSurfaceSecondary} /></Pressable>
          </View>
          {sourceLabel ? <Pill tone="neutral" label={sourceLabel} testID="check-source-pill" /> : null}
          <Button testID="check-submit-button" label={!deviceId ? "Preparing Apollo…" : busy ? "Checking…" : "Check with Apollo"} onPress={() => run(input)} disabled={!deviceId || busy || !input.trim()} icon={busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : undefined} />
          {!deviceId ? <Body testID="check-device-preparing">Apollo is registering this device before online reputation checks.</Body> : null}
          <Button testID="check-page-screenshot" variant="secondary" label="Assess page screenshot" icon={<ImageIcon size={18} color={colors.onSurface} />} onPress={() => void photoAccess.start()} />
          <Button testID="check-page-crawl" variant="secondary" label="Inspect page safely" icon={<Globe size={18} color={colors.onSurface} />} onPress={() => void crawlPage()} disabled={!input.trim()} />
          {pageError ? <Card testID="check-page-error"><Body>{pageError}</Body></Card> : null}
          {page ? (
            <Animated.View entering={FadeInDown.duration(350)}>
              <Card testID="check-page-card" style={{ borderColor: toneColor(colors, page.state), gap: spacing.sm }}>
                {pageScreenshotUri ? <ExpoImage testID="check-page-screenshot-preview" source={{ uri: pageScreenshotUri }} style={s.preview} contentFit="contain" accessibilityLabel="Page screenshot selected for investigation" /> : null}
                <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", alignItems: "center" }}>
                  <Pill tone={page.state} label={STATE_NAME[page.state]} testID="check-page-state" />
                  <Pill tone="neutral" label={page.title} testID="check-page-scenario" />
                  <Pill tone="neutral" label="Shared with Apollo for analysis" />
                </View>
                <Text style={s.headline} testID="check-page-verdict">{page.verdict}</Text>
                {page.why.map((w, i) => <Body key={i} testID={`check-page-why-${i}`}>• {w}</Body>)}
                <Body testID="check-page-recommendation">{page.recommendation}</Body>
                {page.phoneToAvoid ? <Pill tone="barking" label={`Don't call ${page.phoneToAvoid}`} testID="check-page-phone" /> : null}
                {pageHigginsNote ? (
                  <View style={{ gap: 2 }}>
                    <Text style={s.sub}>Higgins&apos;s take</Text>
                    <Body testID="check-page-higgins-note">{pageHigginsNote}</Body>
                  </View>
                ) : null}
                {!outcome && pageEvent ? <View style={{ marginTop: spacing.sm, gap: spacing.sm }}><EventActions event={events.find((e) => e.event_id === pageEvent.event_id) ?? pageEvent} originalEvidence={input.trim() ? [{ kind: "url", value: input.trim(), label: "checked link" }] : []} /><RecoveryFlow event={pageEvent} kinds={["clicked", "password", "card", "code", "download", "app", "called"]} testID="page-recovery" /></View> : null}
              </Card>
            </Animated.View>
          ) : null}

          {/* Universal Check Result is rendered via the early-return branch above when outcome
           *  exists. This entry view only ever shows the input + action buttons + page-assess
           *  previews — no competing verdict cards. */}
        </ScrollView>
      </KeyboardAvoidingView>

      <ScreenshotPermissionSheet prefix="check" visible={!!photoAccess.permission} canAskAgain={photoAccess.permission?.canAskAgain ?? true}
        checking={photoAccess.checking} onContinue={() => void photoAccess.continueAccess()} onClose={photoAccess.close} />

      {/* ── Image Privacy Gate — screens every screenshot before transmission ── */}
      {pageGateScreening && (
        <ImagePrivacyGate
          visible={!!pageGateScreening}
          screening={pageGateScreening}
          onComplete={(r) => void handlePageGateComplete(r)}
          onCancel={handlePageGateCancel}
        />
      )}
    </View>
  );
}
