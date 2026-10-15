// Check Website Link — Approved screen implementation.
// Matches the approved mock-up: header, description, URL card,
// gold Check website link CTA, "or" divider, two action cards, recent links.
import * as ImagePicker from "expo-image-picker";
import { Image as ExpoImage } from "expo-image";
import Camera from "lucide-react-native/icons/camera";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import Clock from "lucide-react-native/icons/clock";
import ExternalLink from "lucide-react-native/icons/external-link";
import Link2 from "lucide-react-native/icons/link-2";
import Search from "lucide-react-native/icons/search";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
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
import { CheckToolHeader } from "@/src/components/CheckToolHeader";
import { CheckingModal } from "@/src/components/CheckingModal";
import { useScreenshotAccess } from "@/src/hooks/useScreenshotAccess";
import { extractUrl } from "@/src/share/classifyShare";
import { getShareIntake } from "@/src/share/shareIntake";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  header: { paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },

  // Scroll
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.lg },

  // Description
  description: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },

  // Website link card
  linkCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 0.25, borderColor: c.border },
  linkCardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  linkIconWell: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  linkCardLabel: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  linkInput: { minHeight: 48, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },

  // Gold CTA
  goldBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.gold, borderRadius: radius.lg, paddingVertical: 16, paddingHorizontal: spacing.xl, gap: spacing.md, minHeight: 56 },
  goldBtnDisabled: { opacity: 0.45 },
  goldBtnText: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },

  // Or divider
  orDivider: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  orLine: { flex: 1, height: 1, backgroundColor: c.border },
  orText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.muted },

  // Action cards row
  actionCardsRow: { gap: spacing.md },
  actionCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 0.25, borderColor: c.border },
  actionCardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  actionCardIconWell: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  screenshotIconBg: { backgroundColor: "#E6F4EA" },
  inspectIconBg: { backgroundColor: "#DBEAFE" },
  actionCardTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface, flex: 1 },
  actionCardSub: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  actionCardChevron: { marginLeft: "auto" },

  // Recent links section
  recentSection: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 0.25, borderColor: c.border, overflow: "hidden" },
  recentHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 4 },
  recentHeaderTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recentTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recentClockWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  recentTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  seeAllRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeAllText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  recentSub: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary, marginLeft: 48 },

  // Link row
  linkRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  linkRowIconWell: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  linkRowAlertWell: { backgroundColor: "rgba(217,83,79,0.12)" },
  linkRowSafeWell: { backgroundColor: "#E6F4EA" },
  linkRowContactWell: {},
  linkRowInitial: { fontFamily: fonts.displayBold, fontSize: 18, color: "#FFFFFF" },
  linkRowInfo: { flex: 1, gap: 2 },
  linkRowName: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  linkRowUrl: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary },
  linkRowDateCol: { alignItems: "flex-end", gap: 2, flexShrink: 0 },
  linkRowDate: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  linkRowTime: { fontFamily: fonts.text, fontSize: 13, color: c.muted },

  // Empty recent
  recentEmpty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },

  // Legacy styles kept for result/page-assess views
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

  // ── RESULT VIEW (preserved exactly) ──
  if (outcome && state) {
    const model = buildLinkCheckResult({ outcome, liveEvent, rawInput: input });
    const askPrompt = `About the link I just checked (${model.subject}). ${model.headline} Can you walk me through what Apollo found and what I should do?`;
    const actions: { label: string; onPress: () => void; testID: string; variant?: "primary" | "secondary" | "ghost" }[] = [];
    if (liveEvent && (liveEvent.state === "biting" || liveEvent.state === "barking" || liveEvent.state === "growling" || liveEvent.state === "ears_up")) {
      actions.push({ testID: "check-verify-website", variant: "ghost", label: "Show me how to check the website", onPress: () => setVerify(true) });
    }
    // Deep technical details — only shown when no Magnum DI investigation (Evidence tab covers this).
    if (!liveEvent) {
      actions.push({ testID: "check-tech-details", variant: "ghost", label: "Deep technical details", onPress: () => setTech(true) });
    }
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
              <Body>Adapter: {liveEvent?.adapter_label}. Verified block: {liveEvent?.verified_block ? "yes" : "no"}. Event: {liveEvent?.event_id.slice(0, 8)}{"\u2026"}</Body>
            </>
          ) : null}
          <Button testID="tech-details-close" variant="ghost" label="Done" onPress={() => setTech(false)} />
        </Sheet>
        <Sheet visible={report} onClose={() => setReport(false)} title="Report a mistake" testID="report-sheet">
          <Body>Think Apollo got this wrong? Your report includes the event, Apollo&apos;s decision, the domain and which intelligence sources responded — nothing else. A human reviews it; one report never whitelists a site for everyone.</Body>
          {reportError ? <Body testID="report-error">{reportError}</Body> : null}
          <Button testID="report-send" label={reportBusy ? "Sending\u2026" : reportError ? "Retry report" : "Send report"} disabled={reportBusy} onPress={() => { if (!liveEvent) return; setReportBusy(true); setReportError(null); void sendFeedback("false_positive", liveEvent, outcome?.intel?.sources.map((x) => x.name) ?? []).then(() => { setReport(false); showToast("Thanks \u2014 report sent for review.", "resting"); }).catch(() => setReportError("The report was not sent. Check your connection and retry." )).finally(() => setReportBusy(false)); }} />
          <Button testID="report-cancel" variant="ghost" label="Cancel" onPress={() => setReport(false)} />
        </Sheet>
      </>
    );
  }

  // ── INPUT VIEW — matches approved mock-up ──
  const hasValidUrl = input.trim().length > 4;

  // ── Recent links from Patrol events ──
  const recentLinkEvents = events
    .filter((e) => e.indicator_host)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  // ── Helper: contact initial color ──
  const INITIAL_COLORS = ["#3B82F6", "#F97316", "#EF4444", "#6366F1", "#8B5CF6", "#EC4899", "#14B8A6", "#10B981"];
  const initialColor = (name: string) => INITIAL_COLORS[name.charCodeAt(0) % INITIAL_COLORS.length];

  // ── Helper: extract domain name from host ──
  const domainName = (host: string) => {
    const parts = host.replace(/^www\./, "").split(".");
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  };

  // ── Helper: format date for recent link rows ──
  const formatLinkDate = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = d.toDateString() === yesterday.toDateString();
      const datePart = isToday ? "Today" : isYesterday ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
      return { datePart, timePart };
    } catch { return { datePart: "", timePart: "" }; }
  };

  // ── Tap a recent link → auto-check ──
  const checkRecentLink = (host: string) => {
    const url = host.startsWith("http") ? host : `https://${host}`;
    setInput(url);
    void run(url);
  };

  return (
    <View style={s.root}>
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <CheckToolHeader
          title="Check Website Link"
          info={{ title: "About website link checking", body: [
            "Paste or share any URL and Magnum DI will inspect the destination page, check it against known threat databases, and have Higgins explain the result.",
            "Apollo checks domain reputation, SSL certificates, redirect chains and page content. The link is visited in a sandboxed environment — your device never loads the page directly.",
            "A completed check does not guarantee a website is safe. Results reflect what Apollo was able to verify at the time of the check.",
          ] }}
          testID="check"
        />
      </View>

      <KeyboardAwareScrollView
        testID="check-scroll"
        contentContainerStyle={[s.scrollContent, { paddingTop: spacing.md, paddingBottom: insets.bottom + 100 }]}
        bottomOffset={24}
      >
        {/* ── Description ── */}
        <Text style={s.description}>
          Enter a website link, choose one from your recent links, or take a screenshot.{"\n"}Magnum DI will investigate it for possible scams.
        </Text>

        {/* ── Website Link Card ── */}
        <View style={s.linkCard} testID="check-link-card">
          <View style={s.linkCardHeader}>
            <View style={s.linkIconWell}>
              <Link2 size={22} color="#1D4ED8" />
            </View>
            <Text style={s.linkCardLabel}>Website link</Text>
          </View>
          <TextInput
            testID="check-url-input"
            style={s.linkInput}
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
        </View>

        {/* ── Gold CTA: Check website link ── */}
        <Pressable
          testID="check-submit-button"
          accessibilityRole="button"
          accessibilityLabel="Check website link"
          disabled={!deviceId || busy || !hasValidUrl}
          onPress={() => void run(input)}
          style={({ pressed }) => [s.goldBtn, (!deviceId || busy || !hasValidUrl) && s.goldBtnDisabled, { opacity: pressed && hasValidUrl ? 0.85 : 1 }]}
        >
          <Search size={22} color={colors.onSurface} />
          <Text style={s.goldBtnText}>{!deviceId ? "Preparing Apollo\u2026" : "Check website link"}</Text>
        </Pressable>

        {/* ── Page analysis results (inline) ── */}
        {pageError ? <Card testID="check-page-error"><Body>{pageError}</Body></Card> : null}
        {page ? (
          <Animated.View entering={FadeInDown.duration(350)}>
            <Card testID="check-page-card" style={{ borderColor: toneColor(colors, page.state), gap: spacing.sm }}>
              {pageScreenshotUri ? <ExpoImage testID="check-page-screenshot-preview" source={{ uri: pageScreenshotUri }} style={s.preview} contentFit="contain" accessibilityLabel="Page screenshot selected for investigation" /> : null}
              <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", alignItems: "center" }}>
                <Pill tone={page.state} label={STATE_NAME[page.state]} testID="check-page-state" />
                <Pill tone="neutral" label={page.title} testID="check-page-scenario" />
              </View>
              <Text style={s.headline} testID="check-page-verdict">{page.verdict}</Text>
              {page.why.map((w, i) => <Body key={i} testID={`check-page-why-${i}`}>{"\u2022"} {w}</Body>)}
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

        {/* ── Or divider ── */}
        <View style={s.orDivider}>
          <View style={s.orLine} />
          <Text style={s.orText}>or</Text>
          <View style={s.orLine} />
        </View>

        {/* ── Two action cards ── */}
        <View style={s.actionCardsRow}>
          {/* Take a screenshot */}
          <Pressable
            testID="check-page-screenshot"
            accessibilityRole="button"
            accessibilityLabel="Take a screenshot"
            onPress={() => void photoAccess.start()}
            style={({ pressed }) => [s.actionCard, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.actionCardHeader}>
              <View style={[s.actionCardIconWell, s.screenshotIconBg]}><Camera size={20} color="#2E7D32" /></View>
              <Text style={s.actionCardTitle}>Take a screenshot</Text>
              <ChevronRight size={18} color={colors.muted} />
            </View>
            <Text style={s.actionCardSub}>Select an image from your device or take a new screenshot.</Text>
          </Pressable>

          {/* Open link safely */}
          <Pressable
            testID="check-page-crawl"
            accessibilityRole="button"
            accessibilityLabel="Open link safely"
            onPress={() => void crawlPage()}
            disabled={!input.trim()}
            style={({ pressed }) => [s.actionCard, !input.trim() && { opacity: 0.5 }, { opacity: pressed && input.trim() ? 0.85 : 1 }]}
          >
            <View style={s.actionCardHeader}>
              <View style={[s.actionCardIconWell, s.inspectIconBg]}><ExternalLink size={20} color="#1D4ED8" /></View>
              <Text style={s.actionCardTitle}>Open link safely</Text>
              <ChevronRight size={18} color={colors.muted} />
            </View>
            <Text style={s.actionCardSub}>Apollo will open the link in a protected environment.</Text>
          </Pressable>
        </View>

        {/* ── Recent Links Section ── */}
        <View style={s.recentSection} testID="check-recent-section">
          {/* Header */}
          <View style={s.recentHeader}>
            <View style={s.recentHeaderTop}>
              <View style={s.recentTitleRow}>
                <View style={s.recentClockWell}>
                  <Clock size={18} color={colors.onSurface} />
                </View>
                <Text style={s.recentTitle}>Recent links</Text>
              </View>
              {recentLinkEvents.length > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/patrol")} style={s.seeAllRow} hitSlop={8}>
                  <Text style={s.seeAllText}>See all</Text>
                  <ChevronRight size={16} color={colors.brand} />
                </Pressable>
              ) : null}
            </View>
            <Text style={s.recentSub}>Tap a link to check it with Apollo.</Text>
          </View>

          {/* Link rows */}
          {recentLinkEvents.length > 0 ? (
            recentLinkEvents.map((ev, i) => {
              const host = ev.indicator_host ?? "";
              const name = ev.headline?.replace(/\s*—.*$/, "") || domainName(host);
              const isDangerous = ev.state === "barking" || ev.state === "biting";
              const isSafe = ev.state === "resting";
              const { datePart, timePart } = formatLinkDate(ev.created_at);
              return (
                <Pressable
                  key={ev.event_id}
                  testID={`check-recent-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Check ${host}`}
                  onPress={() => checkRecentLink(host)}
                  style={({ pressed }) => [s.linkRow, { opacity: pressed ? 0.7 : 1 }]}
                >
                  {isDangerous ? (
                    <View style={[s.linkRowIconWell, s.linkRowAlertWell]}>
                      <CircleAlert size={22} color={colors.error} />
                    </View>
                  ) : isSafe ? (
                    <View style={[s.linkRowIconWell, s.linkRowSafeWell]}>
                      <Link2 size={20} color="#2E7D32" />
                    </View>
                  ) : (
                    <View style={[s.linkRowIconWell, s.linkRowContactWell, { backgroundColor: initialColor(host) }]}>
                      <Text style={s.linkRowInitial}>{domainName(host).charAt(0)}</Text>
                    </View>
                  )}
                  <View style={s.linkRowInfo}>
                    <Text style={s.linkRowName} numberOfLines={1}>{name}</Text>
                    <Text style={s.linkRowUrl} numberOfLines={1}>{host.startsWith("http") ? host : `https://${host}`}</Text>
                  </View>
                  <View style={s.linkRowDateCol}>
                    <Text style={s.linkRowDate}>{datePart}</Text>
                    <Text style={s.linkRowTime}>{timePart}</Text>
                  </View>
                  <ChevronRight size={18} color={colors.muted} />
                </Pressable>
              );
            })
          ) : (
            <View style={s.recentEmpty}>
              <Link2 size={28} color={colors.muted} />
              <Body>Your checked links will appear here.</Body>
            </View>
          )}
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

      {/* ── Checking overlay modal ── */}
      <CheckingModal
        visible={busy}
        title="Checking link"
        subject={input.trim() || undefined}
        description={"Looking up reputation data and running\nMagnum DI analysis. This usually takes\na few seconds."}
      />
    </View>
  );
}

