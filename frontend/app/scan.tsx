// Gate 5 — Scan with Apollo. Decode → Sniff → Preview → Action. Nothing opens automatically.
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { Redirect, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useRef, useState } from "react";
import { Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { assessScan, classifyPayload, SCAN_CONTEXTS, type ScanAssessment, type ScanContext, type ScanPayload } from "@/src/domain/scanPayload";
import { STATE_LABEL, STATE_NAME, STATE_RANK_ORDER, type PatrolEvent } from "@/src/domain/types";
import { useApollo, type CheckOutcome } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  cam: { height: 260, borderRadius: radius.lg, overflow: "hidden", backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  camHint: { position: "absolute", bottom: spacing.md, left: 0, right: 0, textAlign: "center", fontFamily: fonts.textMedium, color: c.onSurface, fontSize: 14 },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  chipOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  preview: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  mono: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
}));

export default function Scan() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, checkLink, upsertEvent, deviceId, adapterLabel, showToast } = useApollo();
  const [perm, requestPerm] = useCameraPermissions();
  const [camOn, setCamOn] = useState(false);
  const [manual, setManual] = useState("");
  const [context, setContext] = useState<ScanContext>("other");
  const [payload, setPayload] = useState<ScanPayload | null>(null);
  const [assess, setAssess] = useState<ScanAssessment | null>(null);
  const [web, setWeb] = useState<CheckOutcome | null>(null);
  const [event, setEvent] = useState<PatrolEvent | null>(null);
  const [sniffing, setSniffing] = useState(false);
  const lock = useRef(false);

  const startCamera = async () => {
    if (perm?.granted) { setCamOn(true); return; }
    if (perm && !perm.canAskAgain) { showToast("Camera access is off. Allow it in Settings to scan codes.", "growling"); void Linking.openSettings(); return; }
    const r = await requestPerm();
    if (r.granted) setCamOn(true); else showToast("Apollo only uses the camera while you scan — nothing is recorded.", "neutral");
  };

  const handle = async (raw: string, ctx = context) => {
    if (lock.current || !raw.trim()) return;
    lock.current = true; setCamOn(false); setSniffing(true); setWeb(null); setEvent(null);
    const p = classifyPayload(raw); const a = assessScan(p, ctx);
    setPayload(p); setAssess(a);
    try {
      if ((p.type === "url" || p.type === "payment") && p.url) {
        const out = await checkLink(p.url);
        setWeb(out);
        // Merge the physical-context findings into the Gate 3 event so it is ONE incident in Patrol / Threat Scent.
        if (out.event && a.why.length && a.state !== "resting") {
          const higher = STATE_RANK_ORDER.indexOf(a.state) > STATE_RANK_ORDER.indexOf(out.event.state) && out.event.state !== "biting";
          setEvent(await upsertEvent({ ...out.event, category: "link", state: higher ? a.state : out.event.state, resolved_at: higher ? null : out.event.resolved_at, status: higher ? "active" : out.event.status, headline: higher ? `QR code: ${a.title}` : out.event.headline, why: [...out.event.why, ...a.why.map((w) => `QR: ${w}`)], what_to_do: higher ? a.recommendation : out.event.what_to_do, claimed_brand: out.event.claimed_brand ?? a.claimedBrand, scenario: "Q" }));
        } else if (out.event) setEvent(out.event);
        else if (a.state !== "resting") setEvent(await mkEvent(p, a));
      } else if (a.state !== "resting") setEvent(await mkEvent(p, a));
    } finally { setSniffing(false); lock.current = false; }
  };
  const mkEvent = (p: ScanPayload, a: ScanAssessment) => upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: p.type === "wifi" ? "connection" : "link", state: a.state, status: "active", headline: `QR code: ${a.title}`, what_happened: p.preview, why: a.why, what_to_do: a.recommendation, indicator_host: p.host ?? null, indicator_digest: null, local_indicator: p.raw.slice(0, 200), verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: a.claimedBrand, scenario: "Q" });

  if (ready && !setupDone) return <Redirect href="/" />;
  const finalState = event?.state ?? (web?.decision.state && assess ? (STATE_RANK_ORDER.indexOf(web.decision.state) >= STATE_RANK_ORDER.indexOf(assess.state) ? web.decision.state : assess.state) : assess?.state) ?? null;
  const canOpen = payload?.url && finalState && finalState !== "barking" && finalState !== "biting";

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Scan with Apollo</Text>
        <Pressable testID="scan-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="scan-scroll">
        {!payload ? (
          <>
            <Body>Apollo sniffs the code before your phone follows it. Nothing opens until you say so.</Body>
            <Text style={s.why}>What is this code for?</Text>
            <View style={s.chips}>{SCAN_CONTEXTS.map((o) => <Pressable key={o.id} testID={`scan-context-${o.id}`} accessibilityRole="button" onPress={() => setContext(o.id)} style={[s.chip, context === o.id && s.chipOn]}><Text style={s.chipText}>{o.label}</Text></Pressable>)}</View>
            {camOn && Platform.OS !== "web" ? (
              <View style={s.cam} testID="scan-camera">
                <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => void handle(r.data)} />
                <Text style={s.camHint}>Point your camera at a QR code</Text>
              </View>
            ) : (
              <Button testID="scan-start" label={Platform.OS === "web" ? "Camera scanning needs the phone app" : "Open camera"} onPress={() => void startCamera()} disabled={Platform.OS === "web"} />
            )}
            <SectionTitle>Or paste the code&apos;s contents</SectionTitle>
            <TextInput testID="scan-manual" style={s.input} value={manual} onChangeText={setManual} placeholder="https://…, tel:, WIFI:, bitcoin:…" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
            <Button testID="scan-manual-check" variant="secondary" label="Sniff this code" onPress={() => void handle(manual)} disabled={!manual.trim()} />
            <Body>Camera frames stay on your phone. Only a website address is sent for a reputation check.</Body>
          </>
        ) : (
          <>
            <Card testID="scan-result" style={{ borderColor: toneColor(colors, sniffing ? "sniffing" : finalState ?? "neutral"), gap: spacing.sm }}>
              <View style={s.chips}>
                <Pill tone={sniffing ? "sniffing" : finalState ?? "neutral"} label={sniffing ? "Sniffing…" : STATE_NAME[finalState ?? "resting"]} testID="scan-state" />
                <Pill tone="neutral" label={payload.type.toUpperCase()} testID="scan-type" />
                {web && !sniffing ? <Pill tone="neutral" label="Checked before opening" /> : null}
              </View>
              <Text style={s.preview} testID="scan-preview">{payload.preview}</Text>
              {!sniffing && finalState ? <Text style={s.why}>{STATE_LABEL[finalState]}</Text> : null}
              {!sniffing ? <Text style={s.why} testID="scan-headline">{event?.headline ?? web?.decision.headline ?? assess?.title}</Text> : null}
              {!sniffing ? <>
                <SectionTitle>Why?</SectionTitle>
                {[...(web?.decision.why ?? []), ...(assess?.why ?? [])].map((w, i) => <Text key={i} style={s.why} testID={`scan-why-${i}`}>• {w}</Text>)}
                <SectionTitle>Recommendation</SectionTitle>
                <Text style={s.why} testID="scan-recommendation">{event?.what_to_do ?? web?.decision.what_to_do ?? assess?.recommendation}</Text>
              </> : null}
              <Text style={s.mono} numberOfLines={3} testID="scan-raw">{payload.raw}</Text>
            </Card>
            {!sniffing ? (
              <Card style={{ gap: spacing.sm }} testID="scan-actions">
                {payload.type === "tel" ? <>
                  <Button testID="scan-check-number" label="Check number" onPress={() => router.push({ pathname: "/call", params: { number: payload.phone } })} />
                  <Button testID="scan-call" variant="secondary" label={`Call ${payload.phone}`} onPress={() => void Linking.openURL(payload.raw)} />
                </> : null}
                {canOpen && finalState === "resting" ? <Button testID="scan-open" label="Open website" onPress={() => void Linking.openURL(payload.url!)} /> : null}
                {canOpen && finalState !== "resting" ? <Button testID="scan-open" variant="ghost" label="Open anyway (Apollo recommends not to)" onPress={() => void Linking.openURL(payload.url!)} /> : null}
                {payload.url && !canOpen ? <Body testID="scan-open-blocked">Apollo stopped this destination from opening. Use the organisation&apos;s official app instead.</Body> : null}
                {payload.url ? <Button testID="scan-view-destination" variant="secondary" label="View destination details" onPress={() => router.push({ pathname: "/check", params: { url: payload.url, source: "qr" } })} /> : null}
                {payload.type === "wifi" ? <Body>Connect via your phone&apos;s Wi‑Fi settings if you trust the venue. {payload.wifiSecurity === "open" ? "Avoid banking on this network." : ""}</Body> : null}
                {payload.type === "sms" || payload.type === "mailto" || payload.type === "applink" ? <Button testID="scan-continue" variant="secondary" label="Continue to the app" onPress={() => void Linking.openURL(payload.raw)} /> : null}
                <Button testID="scan-copy" variant="ghost" label="Copy contents" onPress={() => { void Clipboard.setStringAsync(payload.raw); showToast("Copied", "neutral"); }} />
                {event ? <RecoveryFlow event={event} kinds={["clicked", "password", "card", "money", "download", "app"]} testID="scan-recovery" /> : null}
                <Button testID="scan-again" variant="ghost" label="Scan another code" onPress={() => { setPayload(null); setAssess(null); setWeb(null); setEvent(null); setManual(""); }} />
              </Card>
            ) : null}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
