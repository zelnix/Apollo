// Call Guard — pre-answer caller protection. Android: opt-in CallScreeningService
// (ApolloCallScreeningService.kt) rejects numbers on the person's own block list or a number this
// device previously found high-risk; everything else rings normally. iOS: CXCallDirectoryExtension
// (ApolloCallDirectory) provides the same block list to the system Phone app once enabled in
// Settings — Apple gives apps no live per-call callback, so pending on-demand lookups are Android-only.
// "Check this number" and the personal block/allow list work identically on both platforms via the
// backend's IPQualityScore proxy (POST /api/call/risk-check) — see src/store/ApolloContext.checkNumberRisk.
import { useRouter } from "expo-router";
import PhoneOff from "lucide-react-native/icons/phone-off";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PatrolItem } from "@/src/components/PatrolItem";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { STATE_LABEL, STATE_MEANING } from "@/src/domain/types";
import { CallSdk, type CallProtectionCapabilities } from "@/src/security/callSdk";
import { type CallRiskResult, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  iconWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.brand },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", gap: spacing.sm },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  small: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  listRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  listNumber: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface },
}));

export default function CallGuard() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { checkNumberRisk, events, showToast } = useApollo();

  const [caps, setCaps] = useState<CallProtectionCapabilities | null>(null);
  const [lists, setLists] = useState<{ block: string[]; allow: string[]; autoRisky: string[] }>({ block: [], allow: [], autoRisky: [] });
  const [openingSettings, setOpeningSettings] = useState(false);
  const refresh = useCallback(() => {
    void CallSdk.getCallProtectionCapabilities().then(setCaps);
    void CallSdk.getCallBlockAllowList().then(setLists);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") refresh(); });
    return () => sub.remove();
  }, [refresh]);
  const screeningOn = caps?.callScreening === "supported";

  const turnOn = async () => {
    setOpeningSettings(true);
    try {
      const r = await CallSdk.requestCallScreeningRole();
      if (r.opened) {
        showToast(
          Platform.OS === "android" ? "Select Apollo as your call-screening app, then come back." : "Settings opened. Turn on Apollo under Phone › Call Blocking & Identification, then come back.",
          "neutral",
        );
      }
    } finally { setOpeningSettings(false); }
  };

  // Check this number — same risk check the background poll uses for calls with no local signal.
  const [number, setNumber] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CallRiskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    if (!number.trim()) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await checkNumberRisk(number.trim(), country.trim() ? country.trim().toUpperCase() : undefined);
      setResult(r);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check this number."); } finally { setBusy(false); }
  };

  const addEntry = async (num: string, kind: "block" | "allow") => {
    await CallSdk.addCallListEntry(num, kind);
    showToast(kind === "block" ? 'Saved to your local block list. Rejection requires active call screening.' : 'Saved to your local allow list.', 'neutral');
    refresh();
  };
  const removeEntry = async (num: string, kind: "block" | "allow") => {
    await CallSdk.removeCallListEntry(num, kind);
    refresh();
  };

  const recentCalls = events.filter((e) => e.category === "call" && e.state !== "resting").slice(0, 5);

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Call Guard</Text>
        <Pressable testID="callguard-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="callguard-scroll">
        <Body testID="callguard-policy">Submitting a number authorises one reputation lookup. Apollo does not persist the submitted number. Reputation is a warning only; call rejection is separate and never packet-backed Biting.</Body>

        <Card style={{ gap: spacing.sm }} testID="callguard-status-card">
          <View style={s.rowTop}>
            <View style={s.iconWell}><ShieldAlert size={18} color={colors.brand} /></View>
            <Text style={[s.cardTitle, { flex: 1 }]}>Automatic call screening</Text>
            <Pill tone={screeningOn ? "resting" : "growling"} label={screeningOn ? "On" : "Off"} testID="callguard-status" />
          </View>
          {screeningOn ? (
            <Body testID="callguard-status-detail">
              {Platform.OS === "android"
                ? "Apollo is your selected call-screening app. It rejects calls from your block list and numbers it already knows are high-risk — everything else rings normally."
                : "Apollo's call-blocking extension is on. The system Phone app now uses your block list to reject calls before they ring."}
            </Body>
          ) : (
            <>
              <Body testID="callguard-status-detail">
                {Platform.OS === "android"
                  ? "Select Apollo as your call-screening app so it can reject numbers on your block list — and numbers it already knows are high-risk — before they ring. This may replace or sit alongside your carrier's own spam blocking."
                  : Platform.OS === "ios"
                    ? "Turn Apollo on under Settings › Phone › Call Blocking & Identification so the system can use your block list. Apple gives apps no direct link to that screen — Settings will open to Apollo's own page instead."
                    : "Automatic call screening needs a native build — not available in this preview."}
              </Body>
              {Platform.OS === "android" || Platform.OS === "ios" ? (
                <Button testID="callguard-turn-on" variant="secondary" label={openingSettings ? "Opening…" : "Turn on call screening"} onPress={() => void turnOn()} disabled={openingSettings} />
              ) : null}
            </>
          )}
        </Card>

        {recentCalls.length ? (
          <View>
            <SectionTitle>Recently flagged calls</SectionTitle>
            <View testID="callguard-recent">
              {recentCalls.map((e, i) => <PatrolItem key={e.event_id} event={e} isLast={i === recentCalls.length - 1} />)}
            </View>
          </View>
        ) : null}

        <View>
          <SectionTitle>Check this number</SectionTitle>
          <Card style={{ gap: spacing.md }} testID="callguard-check-card">
            <View style={s.row}>
              <TextInput testID="callguard-number" style={[s.input, { flex: 2 }]} value={number} onChangeText={setNumber} placeholder="Phone number, e.g. +1 555 010 1234" placeholderTextColor={colors.muted} keyboardType="phone-pad" />
              <TextInput testID="callguard-country" style={[s.input, { flex: 1 }]} value={country} onChangeText={setCountry} placeholder="Country (US)" placeholderTextColor={colors.muted} autoCapitalize="characters" maxLength={2} />
            </View>
            <Button testID="callguard-check" label={busy ? "Checking…" : "Check caller reputation"} onPress={() => void runCheck()} disabled={busy || !number.trim()} />
            <Text style={s.small} testID="callguard-processing-scope">The number is used for this check, then discarded by Apollo. Provider-side handling follows the configured reputation service policy.</Text>
            <Button testID="callguard-local-block" variant="secondary" label="Add number to local block list" onPress={() => void addEntry(number.trim(), 'block')} disabled={!number.trim()} />
            <Button testID="callguard-local-allow" variant="secondary" label="Add number to local allow list" onPress={() => void addEntry(number.trim(), 'allow')} disabled={!number.trim()} />
          </Card>
        </View>

        {error ? <Card testID="callguard-error"><Body>{error}</Body></Card> : null}
        {busy ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }} testID="callguard-checking">
            <ActivityIndicator color={colors.sniffing} /><View style={{ flex: 1 }}><Text style={s.why}>{STATE_LABEL.sniffing}</Text><Body>{STATE_MEANING.sniffing}</Body></View>
          </Card>
        ) : null}

        {result ? (
          <Card testID="callguard-result" style={{ gap: spacing.sm }}>
            <View style={s.row}>
              <Pill tone={result.decision === "avoid" ? "barking" : result.decision === "review" ? "growling" : "resting"} label={result.decision === "avoid" ? "High risk" : result.decision === "review" ? "Some risk" : "Looks fine"} testID="callguard-decision" />
              {result.source === "not_configured" ? <Pill tone="unknown" label="Provider not configured" /> : null}
            </View>
            <Text style={s.why} testID="callguard-summary">{result.number}{result.fraud_score !== null ? ` — fraud score ${result.fraud_score}/100` : ""}</Text>
            <Text style={s.why} testID="callguard-higgins-headline">{result.higgins.headline}</Text>
            <Body testID="callguard-higgins-response">{result.higgins.exact_response}</Body>
            <Body testID="callguard-higgins-unresolved">Could not establish: {result.higgins.could_not_establish}</Body>
            {result.line_type ? <Text style={s.small}>Line type: {result.line_type}{result.carrier ? ` · ${result.carrier}` : ""}{result.voip ? " · VOIP" : ""}</Text> : null}
            <View style={s.row}>
              <Button testID="callguard-result-block" variant="secondary" label="Add to block list" onPress={() => void addEntry(result.number, "block")} />
              <Button testID="callguard-result-allow" variant="ghost" label="Always allow" onPress={() => void addEntry(result.number, "allow")} />
            </View>
          </Card>
        ) : null}

        <View>
          <SectionTitle>Your block list</SectionTitle>
          <Card testID="callguard-block-list">
            {lists.block.length ? lists.block.map((n) => (
              <View key={n} style={s.listRow}>
                <Text style={s.listNumber}>{n}</Text>
                <Button testID={`callguard-remove-block-${lists.block.indexOf(n)}`} variant="ghost" label="Remove" onPress={() => void removeEntry(n, "block")} />
              </View>
            )) : <Body>No numbers blocked yet.</Body>}
          </Card>
        </View>

        <View>
          <SectionTitle>Always allowed</SectionTitle>
          <Card testID="callguard-allow-list">
            {lists.allow.length ? lists.allow.map((n) => (
              <View key={n} style={s.listRow}>
                <Text style={s.listNumber}>{n}</Text>
                <Button testID={`callguard-remove-allow-${lists.allow.indexOf(n)}`} variant="ghost" label="Remove" onPress={() => void removeEntry(n, "allow")} />
              </View>
            )) : <Body>Nothing here — numbers you mark &quot;always allow&quot; will always ring.</Body>}
          </Card>
        </View>

        <Button testID="callguard-check-live-call" variant="ghost" label="Mid-call? Use Check This Call instead" icon={<PhoneOff size={16} color={colors.brand} />} onPress={() => router.push("/call")} />
      </KeyboardAwareScrollView>
    </View>
  );
}
