// Vision Gate — "Show Apollo"
// Photograph or upload something suspicious. Apollo investigates supported security indicators
// using existing capabilities. Higgins explains evidence, uncertainty and recommended action.
//
// Privacy: All images go through screenImage() → ImagePrivacyGate (redaction → approval) before
// any external transmission. The original photograph is never retained or transmitted unapproved.

import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Camera from "lucide-react-native/icons/camera";
import ImageIcon from "lucide-react-native/icons/image";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import CircleCheckBig from "lucide-react-native/icons/circle-check-big";
import Info from "lucide-react-native/icons/info";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import Eye from "lucide-react-native/icons/eye";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiUpload } from "@/src/api/client";
import { getDeviceIdentity } from "@/src/auth/deviceIdentity";
import { ImagePrivacyGate, type GateResult } from "@/src/components/ImagePrivacyGate";
import { screenImage, type ScreeningResult } from "@/src/domain/imagePrivacy";
import { Body, Button, Card, Pill } from "@/src/components/ui";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { useApollo } from "@/src/store/ApolloContext";
import type { ApolloState, PatrolEvent } from "@/src/domain/types";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

// ── Types ──

interface VisionResult {
  image_type: string;
  description: string;
  claimed_brand: string;
  confidence: string;
  urls_found: string[];
  phone_numbers_found: string[];
  email_addresses_found: string[];
  qr_code_present: boolean;
  asks_user_to: string[];
  suspicious_indicators: string[];
  legitimate_indicators: string[];
  payment_details?: { present: boolean; method: string; changed_details_warning: boolean } | null;
  text_content: string;
  checks_performed: { gate: string; type: string; indicator?: string }[];
  findings: { gate: string; type: string; verdict?: string; indicator?: string; detail?: string; threat_types?: string[]; status?: string; assessment?: Record<string, unknown> }[];
  limitations: string[];
  higgins: { headline: string; severity: string; explanation: string; action: string; checks_summary: string };
  investigation_case_id?: string | null;
  gemini_used: boolean;
}

type VisionStage = "pick" | "screening" | "investigating" | "result" | "error";

// ── Fix 6: Gate-to-plain-English capability name translation ──
// Uses the approved user-facing capability names from the protection areas.
const GATE_DISPLAY_NAME: Record<string, string> = {
  "Link Gate": "Websites & Links",
  "Site Gate": "Websites & Links",
  "Text Gate": "Messages & Calls",
  "Call Gate": "Messages & Calls",
  "Email Gate": "Email & Accounts",
  "Account Gate": "Email & Accounts",
  "App Gate": "Apps & Files",
  "File Gate": "Apps & Files",
  "Device Gate": "Device & Internet",
  "Internet Gate": "Device & Internet",
  "Vision Gate": "Vision",
  // Also handle lowercase or code-style names from backend
  "link_gate": "Websites & Links",
  "site_gate": "Websites & Links",
  "text_gate": "Messages & Calls",
  "call_gate": "Messages & Calls",
  "email_gate": "Email & Accounts",
  "account_gate": "Email & Accounts",
  "app_gate": "Apps & Files",
  "file_gate": "Apps & Files",
  "device_gate": "Device & Internet",
  "internet_gate": "Device & Internet",
  "vision_gate": "Vision",
};

function translateGateName(rawGate: string): string {
  return GATE_DISPLAY_NAME[rawGate] ?? rawGate.replace(/_/g, " ");
}

// ── Fix 4: Map severity to the correct ApolloState string ──
function severityToState(severity: string | undefined): ApolloState {
  switch (severity) {
    case "high": return "barking";
    case "medium": return "growling";
    default: return "resting";
  }
}

// ── Styles ──

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing["3xl"] },
  backBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 44 },
  backText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brand },
  header: { paddingHorizontal: spacing.xl, gap: spacing.sm, paddingTop: spacing.md },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  headerBody: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
  pickRow: { flexDirection: "row", gap: spacing.md },
  pickCard: { flex: 1, alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg, minHeight: 120 },
  pickLabel: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface, textAlign: "center" },
  pickDesc: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary, textAlign: "center" },
  progressCard: { alignItems: "center", gap: spacing.md, paddingVertical: spacing["2xl"] },
  progressText: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface, textAlign: "center" },
  progressBody: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary, textAlign: "center", maxWidth: 300 },
  resultSection: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  sectionBody: { fontFamily: fonts.text, fontSize: 14, lineHeight: 21, color: c.onSurfaceSecondary },
  findingRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.xs },
  findingLabel: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  findingDetail: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  limitRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.xs },
  limitText: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.muted, flex: 1 },
  higginsCard: { gap: spacing.sm, borderWidth: 1 },
  higginsHeadline: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 24, color: c.onSurface },
  higginsExplanation: { fontFamily: fonts.text, fontSize: 14, lineHeight: 21, color: c.onSurfaceSecondary },
  higginsAction: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 22, color: c.onSurface },
  indicatorPills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  errorCard: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
  errorText: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.barking, textAlign: "center" },
}));

export default function VisionScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { upsertEvent } = useApollo();

  const [stage, setStage] = useState<VisionStage>("pick");
  const [showPrivacyGate, setShowPrivacyGate] = useState(false);
  const [screening, setScreening] = useState<ScreeningResult | null>(null);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState("Preparing your image...");

  // ── Shared: screen image then show privacy gate ──

  const screenAndShow = useCallback(async (uri: string) => {
    setStage("screening");
    setProgressMessage("Screening your image locally...");
    try {
      const screeningResult = await screenImage(uri, "investigation_evidence");
      if (screeningResult.status === "withheld") {
        setError("This image could not be processed safely. " + screeningResult.screeningSummary);
        setStage("error");
        return;
      }
      setScreening(screeningResult);
      setShowPrivacyGate(true);
    } catch {
      setError("Image screening failed. Please try again.");
      setStage("error");
    }
  }, []);

  // ── Image capture / pick ──

  const takePhoto = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") return;
      const picked = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.9,
      });
      if (!picked.canceled && picked.assets?.[0]?.uri) {
        await screenAndShow(picked.assets[0].uri);
      }
    } catch {
      setError("Camera is not available right now. Please try again.");
      setStage("error");
    }
  }, [screenAndShow]);

  const pickImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") return;
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.9,
      });
      if (!picked.canceled && picked.assets?.[0]?.uri) {
        await screenAndShow(picked.assets[0].uri);
      }
    } catch {
      setError("Could not open photo library. Please try again.");
      setStage("error");
    }
  }, [screenAndShow]);

  // ── Fix 7: Create a Patrol event from the Vision investigation result ──

  const createPatrolEvent = useCallback(async (res: VisionResult, mode: "image" | "text_only"): Promise<void> => {
    const state = severityToState(res.higgins?.severity);
    const threatIndicators = res.findings.filter(
      (f) => f.verdict === "malicious" || f.verdict === "suspicious",
    );
    const now = new Date().toISOString();
    const indicatorHost = threatIndicators.find((f) => f.indicator)?.indicator ?? null;

    const event: PatrolEvent = {
      event_id: `vision_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      device_id: "local",
      category: "protection",
      state,
      status: threatIndicators.length > 0 ? "active" : "resolved",
      headline: res.higgins?.headline || "Visual investigation",
      what_happened: res.higgins?.explanation || res.description || "Apollo investigated an image you showed it.",
      why: res.suspicious_indicators.length > 0 ? res.suspicious_indicators : [],
      what_to_do: res.higgins?.action || "No action required.",
      indicator_host: indicatorHost,
      indicator_digest: null,
      verified_block: false,
      evidence_provenance: "local_device",
      adapter_label: mode === "text_only" ? "Vision (text)" : "Vision",
      occurred_at: now,
      resolved_at: threatIndicators.length > 0 ? null : now,
      background: false,
      claimed_brand: res.claimed_brand || null,
      trust_allowed: false,
    };

    await upsertEvent(event);

    // Also record in check history (fix 4: state is a plain string)
    void recordCheck("vision", {
      at: now,
      state,
      summary: res.higgins?.headline || (mode === "text_only" ? "Visual investigation (text only)" : "Visual investigation"),
    });
  }, [upsertEvent]);

  // ── Privacy Gate complete → investigate ──

  const onGateComplete = useCallback(async (gateResult: GateResult) => {
    setShowPrivacyGate(false);
    setScreening(null);

    if (gateResult.decision === "withheld") {
      // User chose to withhold the image entirely
      setStage("pick");
      return;
    }

    setStage("investigating");
    setProgressMessage("Apollo is investigating...");

    try {
      // Fix 3: Use the actual device ID, not the bearer token
      const identity = await getDeviceIdentity();
      if (!identity) throw new Error("Device not registered");

      // Fix 1: Align with SanitizationDecision contract
      // "sanitised_image" = redacted image approved, "no_sensitive" = unredacted image approved
      const hasImage =
        (gateResult.decision === "sanitised_image" || gateResult.decision === "no_sensitive") &&
        gateResult.imageUri;
      const extractedText = gateResult.text || "";

      if (hasImage) {
        // Send privacy-screened image + text to backend
        setProgressMessage("Checking for security indicators...");
        const fields: Record<string, string> = {
          device_id: identity.deviceId,                                     // Fix 3: actual device ID
          extracted_text: extractedText,
          sanitization_status: gateResult.decision,                         // Fix 1: actual decision value
          sanitization_receipt_id: gateResult.receipt?.receiptId || "",      // Fix 2: correct field name
          sanitization_digest: gateResult.receipt?.imageDigest || "",        // Fix 2: correct field name
        };
        const response = await apiUpload<VisionResult>(
          "/vision/investigate",
          "vision_investigate",
          fields,
          { uri: gateResult.imageUri!, name: "vision.jpg", type: "image/jpeg" },
        );
        setResult(response);
        setStage("result");
        // Fix 7: Create Patrol event from investigation result
        void createPatrolEvent(response, "image");
      } else {
        // Text-only mode (image withheld, OCR text approved)
        setProgressMessage("Checking extracted text for security indicators...");
        const fields: Record<string, string> = {
          device_id: identity.deviceId,                                     // Fix 3: actual device ID
          extracted_text: extractedText,
          sanitization_status: "text_only",
        };
        // Use apiUpload without a file — the backend accepts Form data with optional file
        const response = await apiUpload<VisionResult>(
          "/vision/investigate",
          "vision_investigate",
          fields,
          null,
        );
        setResult(response);
        setStage("result");
        // Fix 7: Create Patrol event from investigation result
        void createPatrolEvent(response, "text_only");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Investigation failed. Please try again.");
      setStage("error");
    }
  }, [createPatrolEvent]);

  const onGateCancel = useCallback(() => {
    setShowPrivacyGate(false);
    setScreening(null);
    setStage("pick");
  }, []);

  const reset = useCallback(() => {
    setStage("pick");
    setShowPrivacyGate(false);
    setScreening(null);
    setResult(null);
    setError(null);
  }, []);

  // ── Severity color ── (Fix 5: use existing theme colors only)
  const severityColor = useMemo(() => {
    if (!result) return colors.brand;
    switch (result.higgins?.severity) {
      case "high": return colors.barking;
      case "medium": return colors.growlingText;
      default: return colors.resting;
    }
  }, [result, colors]);

  const severityBorder = useMemo(() => {
    if (!result) return colors.border;
    switch (result.higgins?.severity) {
      case "high": return colors.barkingTint;
      case "medium": return colors.growlingTint;     // Fix: growlingBorder doesn't exist → growlingTint
      default: return colors.restingTint;             // Fix: restingBorder doesn't exist → restingTint
    }
  }, [result, colors]);

  // ── Render ──

  return (
    <View style={s.root} testID="vision-screen">
      <View style={{ paddingTop: insets.top }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (stage === "result" || stage === "error") ? reset() : router.back()}
          style={s.backBtn}
          testID="vision-back"
        >
          <ChevronLeft size={20} color={colors.brand} />
          <Text style={s.backText}>{(stage === "result" || stage === "error") ? "New check" : "Back"}</Text>
        </Pressable>
      </View>

      {/* Privacy Gate modal */}
      {screening ? (
        <ImagePrivacyGate
          visible={showPrivacyGate}
          screening={screening}
          onComplete={onGateComplete}
          onCancel={onGateCancel}
        />
      ) : null}

      <ScrollView
        testID="vision-scroll"
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
      >
        {/* ── Pick Stage ── */}
        {stage === "pick" ? (
          <>
            <View style={s.header}>
              <Text style={s.headerTitle} testID="vision-title">Show Apollo</Text>
              <Text style={s.headerBody}>
                See something suspicious? Show Apollo.{"\n"}
                Take a photo or choose an image and ask: &quot;Is this safe?&quot;
              </Text>
            </View>

            <View style={s.pickRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take a photo"
                testID="vision-take-photo"
                onPress={takePhoto}
                style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.78 : 1 }]}
              >
                <Card style={s.pickCard}>
                  <Camera size={32} color={colors.brand} />
                  <Text style={s.pickLabel}>Take a photo</Text>
                  <Text style={s.pickDesc}>Photograph something suspicious with your camera</Text>
                </Card>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose an image"
                testID="vision-pick-image"
                onPress={pickImage}
                style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.78 : 1 }]}
              >
                <Card style={s.pickCard}>
                  <ImageIcon size={32} color={colors.brand} />
                  <Text style={s.pickLabel}>Choose image</Text>
                  <Text style={s.pickDesc}>Select from your photo library or shared images</Text>
                </Card>
              </Pressable>
            </View>

            {/* QR Code link preserved */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan a QR code"
              testID="vision-scan-qr"
              onPress={() => router.push("/scan")}
              style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}
            >
              <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <Eye size={22} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={s.pickLabel}>Scan a QR code</Text>
                  <Text style={[s.pickDesc, { textAlign: "left" }]}>See where a code leads before opening anything.</Text>
                </View>
              </Card>
            </Pressable>
          </>
        ) : null}

        {/* ── Screening Stage ── */}
        {stage === "screening" ? (
          <Card style={s.progressCard} testID="vision-screening">
            <ActivityIndicator size="large" color={colors.brand} />
            <Text style={s.progressText}>Screening your image</Text>
            <Text style={s.progressBody}>Apollo is checking the image locally on your device before sending anything.</Text>
          </Card>
        ) : null}

        {/* ── Investigating Stage ── */}
        {stage === "investigating" ? (
          <Card style={s.progressCard} testID="vision-investigating">
            <ActivityIndicator size="large" color={colors.brand} />
            <Text style={s.progressText}>{progressMessage}</Text>
            <Text style={s.progressBody}>
              Apollo is analysing what you showed it and checking any security indicators.{"\n"}
              This may take a moment.
            </Text>
          </Card>
        ) : null}

        {/* ── Result Stage ── */}
        {stage === "result" && result ? (
          <>
            {/* Higgins' recommendation — always first */}
            <Card style={[s.higginsCard, { borderColor: severityBorder }]} testID="vision-higgins">
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                {result.higgins?.severity === "high" ? (
                  <TriangleAlert size={22} color={colors.barking} />
                ) : result.higgins?.severity === "medium" ? (
                  <TriangleAlert size={22} color={colors.growlingText} />
                ) : (
                  <ShieldCheck size={22} color={colors.resting} />
                )}
                <Text style={[s.higginsHeadline, { color: severityColor, flex: 1 }]} testID="vision-higgins-headline">{result.higgins?.headline}</Text>
              </View>
              <Text style={s.higginsExplanation} testID="vision-higgins-explanation">{result.higgins?.explanation}</Text>
              <Text style={s.higginsAction} testID="vision-higgins-action">{result.higgins?.action}</Text>
            </Card>

            {/* What Apollo recognised */}
            <View style={s.resultSection} testID="vision-recognised">
              <Text style={s.sectionTitle}>What Apollo recognised</Text>
              <Text style={s.sectionBody}>
                {result.description || "Apollo could not clearly identify the content of this image."}
              </Text>
              <View style={s.indicatorPills}>
                {result.claimed_brand ? <Pill tone="neutral" label={`Claims to be: ${result.claimed_brand}`} /> : null}
                {result.image_type ? <Pill tone="neutral" label={result.image_type.replace(/_/g, " ")} /> : null}
              </View>
            </View>

            {/* What Apollo checked — Fix 6: use plain-English capability names */}
            {result.checks_performed.length > 0 ? (
              <View style={s.resultSection} testID="vision-checked">
                <Text style={s.sectionTitle}>What Apollo checked</Text>
                {result.checks_performed.map((check, i) => (
                  <View key={`check-${i}`} style={s.findingRow}>
                    <CircleCheckBig size={16} color={colors.resting} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.findingLabel}>{translateGateName(check.gate)}: {check.type.replace(/_/g, " ")}</Text>
                      {check.indicator ? <Text style={s.findingDetail}>{check.indicator}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* What Apollo found — Fix 6: use plain-English capability names */}
            {result.findings.length > 0 ? (
              <View style={s.resultSection} testID="vision-findings">
                <Text style={s.sectionTitle}>What Apollo found</Text>
                {result.findings.map((finding, i) => {
                  const isThreat = finding.verdict === "malicious" || finding.verdict === "suspicious";
                  return (
                    <View key={`finding-${i}`} style={s.findingRow}>
                      {isThreat ? <TriangleAlert size={16} color={colors.barking} /> : <Info size={16} color={colors.muted} />}
                      <View style={{ flex: 1 }}>
                        <Text style={[s.findingLabel, isThreat ? { color: colors.barking } : undefined]}>
                          {translateGateName(finding.gate)}: {finding.type.replace(/_/g, " ")}
                        </Text>
                        {finding.verdict ? <Text style={s.findingDetail}>Verdict: {finding.verdict}</Text> : null}
                        {finding.detail ? <Text style={s.findingDetail}>{finding.detail}</Text> : null}
                        {finding.indicator ? <Text style={s.findingDetail}>{finding.indicator}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Suspicious indicators from visual analysis */}
            {result.suspicious_indicators.length > 0 ? (
              <View style={s.resultSection} testID="vision-suspicious">
                <Text style={s.sectionTitle}>Suspicious indicators</Text>
                <Text style={[s.sectionBody, { fontStyle: "italic" }]}>
                  These are visual observations from AI analysis, not verified security evidence.
                </Text>
                {result.suspicious_indicators.map((indicator, i) => (
                  <View key={`susp-${i}`} style={s.findingRow}>
                    <TriangleAlert size={14} color={colors.growlingText} />
                    <Text style={[s.findingDetail, { flex: 1 }]}>{indicator}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Magnum DI investigation — linked to coordinator case */}
            {result.investigation_case_id ? (
              <View style={s.resultSection} testID="vision-investigation">
                <Text style={s.sectionTitle}>Extended investigation</Text>
                <Text style={s.sectionBody}>
                  Apollo has started a deeper investigation using public sources and security databases. This runs in the background and may take a moment.
                </Text>
                <Button
                  testID="vision-view-investigation"
                  label="Open in Higgins"
                  variant="ghost"
                  onPress={() => router.push({ pathname: "/(tabs)/ask", params: { resumeCaseId: result.investigation_case_id! } })}
                />
              </View>
            ) : null}

            {/* What Apollo couldn't verify */}
            {result.limitations.length > 0 ? (
              <View style={s.resultSection} testID="vision-limitations">
                <Text style={s.sectionTitle}>What Apollo couldn&apos;t verify</Text>
                {result.limitations.map((limitation, i) => (
                  <View key={`limit-${i}`} style={s.limitRow}>
                    <Info size={14} color={colors.muted} />
                    <Text style={s.limitText}>{limitation}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Actions */}
            <View style={{ gap: spacing.sm }}>
              <Button testID="vision-check-another" label="Check another image" variant="secondary" onPress={reset} />
            </View>
          </>
        ) : null}

        {/* ── Error Stage ── */}
        {stage === "error" ? (
          <>
            <Card style={s.errorCard} testID="vision-error">
              <TriangleAlert size={28} color={colors.barking} />
              <Text style={s.errorText}>Investigation failed</Text>
              <Body>{error || "Something went wrong. Please try again."}</Body>
            </Card>
            <Button testID="vision-try-again" label="Try again" onPress={reset} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
