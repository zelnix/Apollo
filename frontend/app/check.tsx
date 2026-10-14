import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { Image as ExpoImage } from "expo-image";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import Camera from "lucide-react-native/icons/camera";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import Globe from "lucide-react-native/icons/globe";
import Link2 from "lucide-react-native/icons/link-2";
import Search from "lucide-react-native/icons/search";
import Shield from "lucide-react-native/icons/shield";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
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
import { CheckToolHeader } from "@/src/components/CheckToolHeader";
import { useScreenshotAccess } from "@/src/hooks/useScreenshotAccess";
import { extractUrl } from "@/src/share/classifyShare";
import { getShareIntake } from "@/src/share/shareIntake";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  // ── Header ──
  header: { paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  linkIconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.brandTint ?? "#E0ECFF", alignItems: "center", justifyContent: "center" },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  headerSub: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary, marginTop: 2 },
  // ── Scroll ──
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  // ── Protected environment card ──
  envCard: { flexDirection: "row", backgroundColor: "#EBF3FF", borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, alignItems: "flex-start" },
  envIconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#D6E5FC", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  envTextWrap: { flex: 1, gap: 4 },
  envTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brand },
  envDesc: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  // ── URL input ──
  urlCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, gap: spacing.sm },
  urlIconWell: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  urlInput: { flex: 1, minHeight: 52, fontFamily: fonts.text, fontSize: 15, color: c.onSurface, paddingVertical: spacing.md },
  pasteBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  // ── Primary CTA ──
  ctaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary, borderRadius: radius.lg, paddingVertical: 16, paddingHorizontal: spacing.xl, gap: spacing.sm, minHeight: 56 },
  ctaBtnDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onBrandPrimary },
  // ── Action cards ──
  actionCard: { flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, alignItems: "center", borderWidth: 1, borderColor: c.border },
  actionIconWell: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  screenshotIconBg: { backgroundColor: "#E6F4EA" },
  inspectIconBg: { backgroundColor: "#EDE7F6" },
  actionContent: { flex: 1, gap: 4 },
  actionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  actionDesc: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  // ── Privacy card ──
  privacyCard: { flexDirection: "row", backgroundColor: "#EBF3FF", borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, alignItems: "flex-start" },
  privacyIconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#D6E5FC", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  privacyTextWrap: { flex: 1, gap: 4 },
  privacyTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brand },
  privacyDesc: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  learnMore: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand, marginTop: 4 },
  // ── Legacy styles kept for result/page-assess views ──
  headline: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, letterSpacing: -0.3 },
  sub: { fontFamily: fonts.display, fontSize: 13, color: c.onSurfaceSecondary, letterSpacing: 1, textTransform: "uppercase", marginTop: spacing.sm },
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
  const [pageGateScreening, setPageGateScreening] = useState<ScreeningResult | null>(null);
  const [pendingPageScreenshot, setPendingPageScreenshot] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [privacySheetOpen, setPrivacySheetOpen] = useState(false);

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
      const screening = await screenImage(asset.uri, "investigation_evidence");
      setPageGateScreening(screening);
      setPendingPageScreenshot({ uri: asset.uri, name: asset.fileName ?? "page-screenshot.jpg", type: asset.mimeType ?? "image/jpeg" });
    } catch (error) { setPageError(error instanceof Error ? error.message : "Could not screen that screenshot."); }
  };

  const handlePageGateComplete = async (result: GateResult) => {
    setPageGateScreening(null);
    const file = pendingPageScreenshot;
    setPendingPageScreenshot(null);
    if (result.decision === "withheld") { setPageScreenshotUri(null); return; }
    if (result.decision === "text_only" && result.text) {
      setPageError("Page analysis requires the screenshot image. Choose 'Send redacted image' or crop manually.");
      return;
    }
    if (!deviceId || !file) return;
    if (!result.imageUri) {
      setPageError("Privacy screening did not produce a sanitised image. The original cannot be sent.");
      setPageScreenshotUri(null);
      return;
    }
    try {
      const signals = await apiUpload<PageSignals>("/page/extract", "page_extract",
        { device_id: deviceId, url_hint: input.trim(), sanitization_status: "approved", sanitization_receipt_id: result.receipt?.receiptId ?? "", sanitization_digest: result.receipt?.imageDigest ?? "" },
        { uri: result.imageUri, name: file.name, type: file.type });
      await applyPageSignals(signals, "Higgins extracted visible page signals; Apollo's local rules made the assessment.");
    } catch (error) { setPageError(error instanceof Error ? error.message : "Could not assess that screenshot."); }
  };

  const handlePageGateCancel = () => {
    setPageGateScreening(null);
    setPendingPageScreenshot(null);
    setPageScreenshotUri(null);
  };
  const photoAccess = useScreenshotAccess(launchPagePicker);

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
  const params = useLocalSearchParams<{ url?: string; source?: string; sharedIntakeId?: string; scent?: string }>();
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
    try { setOutcome(await checkLink(value, params.scent || undefined)); } finally { setBusy(false); }
  }, [checkLink, params.scent]);

  useEffect(() => {
    if (sharedUrl && ready && setupDone && !autoRan.current) { autoRan.current = true; void run(String(sharedUrl)); }
  }, [sharedUrl, ready, setupDone, run]);

  if (ready && !setupDone) return <Redirect href="/onboarding" />;
  const paste = async () => { const t = await Clipboard.getStringAsync(); if (t) setInput(t.trim()); };
  const sourceLabel = params.source === "share" ? "Shared into Apollo" : params.source === "clipboard" ? "From your clipboard" : params.source === "link" ? "Opened via link" : null;

  // ── RESULT VIEW (preserved exactly) ──
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
      testID: "check-save", variant: "ghost",
      label: saved ? "Saved \u2713 \u2014 View saved checks" : "Save this check",
      onPress: () => {
        if (saved) { router.push("/saved-checks"); return; }
        if (!liveEvent || !outcome) return;
        void saveCheck({
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          gate: "link", title: liveEvent.headline ?? outcome.decision.headline,
          subject: outcome.local.host || input.trim() || "link",
          state: liveEvent.state, stateName: STATE_NAME[liveEvent.state],
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
          investigationContext={liveEvent ? { ...contextFromEvent(liveEvent, gateForCategory(liveEvent.category)), original_evidence: [...(input.trim() ? [{ kind: "url" as const, value: input.trim(), label: "checked link" }] : [])] } : undefined}
          investigationQuestion={askPrompt}
          submissionId={outcome.submissionId}
          eventId={liveEvent?.event_id ?? null}
          actions={actions}
        />
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

  // ── INPUT VIEW — approved mock-up layout ──
  const hasValidUrl = input.trim().length > 4;

  return (
    <View style={s.root}>
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <CheckToolHeader
          title="Check Website Link"
          info={{ title: "About website link checking", body: [
            "Paste or share any URL and Apollo will inspect the destination page, check it against known threat databases, and have Higgins explain the result.",
            "Apollo checks domain reputation, SSL certificates, redirect chains and page content. The link is visited in a sandboxed environment — your device never loads the page directly.",
            "A completed check does not guarantee a website is safe. Results reflect what Apollo was able to verify at the time of the check.",
          ] }}
          testID="check"
        />
      </View>

      <KeyboardAwareScrollView
        testID="check-scroll"
        contentContainerStyle={[s.scrollContent, { paddingTop: spacing.lg, paddingBottom: insets.bottom + 100 }]}
        bottomOffset={24}
      >
        {/* ── Protected environment card ── */}
        <View style={s.envCard} testID="check-env-card">
          <View style={s.envIconWell}>
            <Shield size={20} color={colors.brand} />
          </View>
          <View style={s.envTextWrap}>
            <Text style={s.envTitle}>Opened in a protected environment</Text>
            <Text style={s.envDesc}>Apollo checks links in a secure, isolated sandbox to help protect you from harmful websites, scams and tracking.</Text>
          </View>
        </View>

        {/* ── URL input ── */}
        <View style={s.urlCard}>
          <View style={s.urlIconWell}>
            <Link2 size={16} color={colors.muted} />
          </View>
          <TextInput
            testID="check-url-input"
            style={s.urlInput}
            value={input}
            onChangeText={setInput}
            placeholder="Paste a website link, e.g. https://example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void run(input)}
          />
          <Pressable testID="check-paste-button" accessibilityRole="button" accessibilityLabel="Paste from clipboard" onPress={() => void paste()} style={s.pasteBtn}>
            <ClipboardPaste size={20} color={colors.onSurfaceSecondary} />
          </Pressable>
        </View>

        {sourceLabel ? <Pill tone="neutral" label={sourceLabel} testID="check-source-pill" /> : null}

        {/* ── Primary CTA ── */}
        <Pressable
          testID="check-submit-button"
          accessibilityRole="button"
          accessibilityLabel="Check with Apollo"
          disabled={!deviceId || busy || !hasValidUrl}
          onPress={() => void run(input)}
          style={({ pressed }) => [s.ctaBtn, (!deviceId || busy || !hasValidUrl) && s.ctaBtnDisabled, { opacity: pressed && hasValidUrl ? 0.85 : 1 }]}
        >
          {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Search size={20} color={colors.onBrandPrimary} />}
          <Text style={s.ctaText}>{!deviceId ? "Preparing Apollo…" : busy ? "Checking…" : "Check with Apollo"}</Text>
        </Pressable>

        {!deviceId ? <Body testID="check-device-preparing">Apollo is registering this device before online reputation checks.</Body> : null}

        {/* ── Assess page screenshot card ── */}
        <Pressable testID="check-page-screenshot" accessibilityRole="button" onPress={() => void photoAccess.start()} style={({ pressed }) => [s.actionCard, { opacity: pressed ? 0.85 : 1 }]}>
          <View style={[s.actionIconWell, s.screenshotIconBg]}>
            <Camera size={22} color="#2E7D32" />
          </View>
          <View style={s.actionContent}>
            <Text style={s.actionTitle}>Assess page screenshot</Text>
            <Text style={s.actionDesc}>Apollo will load the link in a protected environment and capture a screenshot, so you can see what the page looks like without visiting it yourself.</Text>
          </View>
          <ChevronRight size={20} color={colors.muted} />
        </Pressable>

        {/* ── Inspect page safely card ── */}
        <Pressable testID="check-page-crawl" accessibilityRole="button" onPress={() => void crawlPage()} disabled={!input.trim()} style={({ pressed }) => [s.actionCard, (!input.trim()) && { opacity: 0.5 }, { opacity: pressed && input.trim() ? 0.85 : 1 }]}>
          <View style={[s.actionIconWell, s.inspectIconBg]}>
            <Globe size={22} color="#6A1B9A" />
          </View>
          <View style={s.actionContent}>
            <Text style={s.actionTitle}>Inspect page safely</Text>
            <Text style={s.actionDesc}>Open the website in a protected, isolated environment so Apollo can examine its content and identify potential risks without exposing your normal browser.</Text>
          </View>
          <ChevronRight size={20} color={colors.muted} />
        </Pressable>

        {/* ── Page analysis results ── */}
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
              {page.phoneToAvoid ? <Pill tone="barking" label={`Don\u2019t call ${page.phoneToAvoid}`} testID="check-page-phone" /> : null}
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

        {/* ── Privacy card ── */}
        <View style={s.privacyCard} testID="check-privacy-card">
          <View style={s.privacyIconWell}>
            <ShieldCheck size={20} color={colors.brand} />
          </View>
          <View style={s.privacyTextWrap}>
            <Text style={s.privacyTitle}>Your privacy is protected</Text>
            <Text style={s.privacyDesc}>Website checks use Apollo&apos;s protected environment to reduce exposure to suspicious sites.</Text>
            <Pressable accessibilityRole="button" onPress={() => setPrivacySheetOpen(true)}>
              <Text style={s.learnMore}>Learn more</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAwareScrollView>

      <ScreenshotPermissionSheet prefix="check" visible={!!photoAccess.permission} canAskAgain={photoAccess.permission?.canAskAgain ?? true}
        checking={photoAccess.checking} onContinue={() => void photoAccess.continueAccess()} onClose={photoAccess.close} />

      {pageGateScreening && (
        <ImagePrivacyGate
          visible={!!pageGateScreening}
          screening={pageGateScreening}
          onComplete={(r) => void handlePageGateComplete(r)}
          onCancel={handlePageGateCancel}
        />
      )}

      <Sheet visible={privacySheetOpen} onClose={() => setPrivacySheetOpen(false)} title="How Apollo protects your privacy" testID="privacy-sheet">
        <Body>When you check a website link, Apollo fetches and analyses the page using a server-side sandboxed environment. Your device does not load the page directly.</Body>
        <Body>The page content is processed temporarily and discarded after the check. Apollo does not store copies of the websites you check.</Body>
        <Body>Screenshots captured through &quot;Assess page screenshot&quot; are processed with on-device privacy screening before any data leaves your device.</Body>
        <Body>Reputation checks are performed against independent threat databases. Apollo never shares your browsing activity, search history, or personal information with these services.</Body>
        <Body>Remaining risk: No sandbox provides absolute isolation. Apollo reduces exposure but cannot guarantee that a website cannot detect it is being inspected.</Body>
        <Button testID="privacy-sheet-close" variant="ghost" label="Done" onPress={() => setPrivacySheetOpen(false)} />
      </Sheet>
    </View>
  );
}
