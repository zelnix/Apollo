// Network Guard dashboard + Check This Network. Only platform-reported facts drive
// the verdict; the user adds context (home/work/public, expected network name, whether they turned the VPN on).
// The unimplemented native SDK contract has been removed — all observations come from
// the platform network snapshot (connection type, Wi-Fi security, captive portal, VPN flags).
import { Redirect, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import Wifi from "lucide-react-native/icons/wifi";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markCheckDone } from "@/src/store/checkCompletion";
import { CheckResultScreen } from "@/src/components/CheckResultScreen";
import { CheckHistoryCard } from "@/src/components/CheckHistoryCard";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { saveCheck } from "@/src/store/savedCheckStore";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { GateAbout } from "@/src/components/GateAbout";
import { buildNetworkCheckResult } from "@/src/domain/networkCheckResultAdapter";
import { contextFromEvent, gateForCategory } from "@/src/domain/higginsHandoff";
import { analyseNetwork, NETWORK_CONTEXTS, type NetworkAnalysis, type NetworkContext } from "@/src/domain/networkAnalysis";
import { SCENT_WINDOW_MS } from "@/src/domain/threatScent";
import { STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { InfoButton } from "@/src/components/InfoButton";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, minHeight: 40, justifyContent: "center" },
  chipOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  verdict: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  statTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface },
}));

export default function CheckNetwork() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, network, capabilities, protection, trustedSsids, trustNetwork, events, upsertEvent, deviceId, adapterLabel, verifyNow, refreshing, showToast } = useApollo();
  const [context, setContext] = useState<NetworkContext>("unknown");
  const [expected, setExpected] = useState("");
  const [vpnTrusted, setVpnTrusted] = useState<boolean | null>(null);
  const [captiveUrl, setCaptiveUrl] = useState("");
  const [result, setResult] = useState<{ submissionId: string; a: NetworkAnalysis; event: PatrolEvent | null } | null>(null);
  const [saved, setSaved] = useState(false);

  const guard = capabilities.find((c) => c.id === "connection_guard");
  const site = capabilities.find((c) => c.id === "site_guard");
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentNet = events.filter((e) => e.category === "connection" && Date.parse(e.occurred_at) >= dayAgo);
  const blocked = recentNet.filter((e) => e.verified_block).length;
  const unresolved = recentNet.filter((e) => e.status === "active" && e.state !== "resting").length;
  const scentCats = useMemo(() => { const now = Date.now(); return events.filter((e) => e.state !== "resting" && (e.category === "app" || e.category === "device") && now - Date.parse(e.occurred_at) <= SCENT_WINDOW_MS).map((e) => e.category); }, [events]);
  const vpnOn = network?.vpnActive === true || network?.type === "vpn";
  // Network Gate watches the live OS connection snapshot — it re-checks on every foreground, network
  // change and periodic sweep, and needs no VPN. It is "monitoring" whenever Apollo has a current,
  // connected network reading; "unknown" only when the platform reveals nothing or the capability is
  // unsupported on this platform (e.g. web).
  const unsupported = guard?.status === "unsupported";
  const monitoring = !unsupported && !!network && Number.isFinite(Date.parse(network.checkedAt)) && network.connected;
  const protectionTone = monitoring ? "resting" : "unknown";
  const protectionTitle = unsupported ? "Not supported on this device" : !network ? "Checking…" : !network.connected ? "Not connected" : "Monitoring this connection";

  const run = async (ctx: NetworkContext = context, existingId?: string | null) => {

    void markCheckDone("network");    const a = analyseNetwork({ status: network, context: ctx, trustedSsids, expectedName: expected, vpnTrusted, apolloVpn: protection?.running === true, captiveUrl, recentScentCategories: scentCats });
    let event: PatrolEvent | null = null;
    // Reuse the id from the current result when the person reclassifies, so changing the
    // network context updates the same Patrol entry instead of creating a new one each tap.
    const eventId = existingId ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
    if (a.state !== "resting") {
      // Network Guard creates a Patrol event from platform-observed network facts only.
      // The persisted Patrol entry must never claim state="biting"/verified_block because no
      // traffic inspection or per-connection enforcement evidence exists in this build.
      // Cap the synced state at "barking" so it can never look like a server-verified block;
      // see the biting invariant in backend/routers/patrol.py::_derive_verified_block.
      const syncedState = a.state === "biting" ? "barking" : a.state;
      event = await upsertEvent({ event_id: eventId, device_id: deviceId ?? "local", category: "connection", state: syncedState, status: "active", headline: `Network: ${a.title}`, what_happened: a.verdict, why: a.why, what_to_do: a.recommendation, indicator_host: captiveUrl.trim() ? captiveUrl.trim().replace(/^https?:\/\//i, "").split("/")[0] : null, indicator_digest: null, local_indicator: a.ssid, verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: syncedState === "ears_up" || syncedState === "growling", claimed_brand: null, scenario: a.scenario });
    } else if (existingId && result?.event && result.event.status === "active") {
      // Reclassifying to a calm context (e.g. Home) clears the earlier unresolved network item.
      await upsertEvent({ ...result.event, status: "resolved", resolved_at: new Date().toISOString() });
    }
    setResult({ submissionId: event?.event_id ?? Crypto.randomUUID(), a, event });
  };

  // Picking a context re-runs the check live when a result is already on screen so the
  // person can classify the network (e.g. mark it Home) straight from the verdict card.
  const pickContext = (id: NetworkContext) => {
    setContext(id);
    if (result) void run(id, result.event?.event_id ?? null);
  };

  const [historyKey, setHistoryKey] = useState(0);
  useEffect(() => { if (result?.a) { void recordCheck("network", { at: new Date().toISOString(), state: result.a.state, summary: result.a.title }); setHistoryKey((k) => k + 1); } }, [result]);
  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;

  // UNIVERSAL CHECK RESULT — when the network check has produced an outcome, the entire screen
  // becomes the shared Check Result. The dashboard stays above; result replaces legacy cards.
  if (result && a) {
    const submissionId = result.event?.event_id ?? `net-${Date.now().toString(36)}`;
    const model = buildNetworkCheckResult({ analysis: a, event: result.event, context, submissionId });
    const askPrompt = `About the network I just checked (${model.subject}). ${model.headline} Can you walk me through what Apollo found and what I should do?`;
    const netActions: { label: string; onPress: () => void; testID: string; variant?: "primary" | "secondary" | "ghost" }[] = [];
    if (a.handoff === "web" && captiveUrl.trim()) {
      netActions.push({ testID: "network-check-portal", variant: "secondary", label: "Check the sign-in page", onPress: () => router.push({ pathname: "/check", params: { url: captiveUrl.trim().startsWith("http") ? captiveUrl.trim() : `https://${captiveUrl.trim()}`, source: "network" } }) });
    }
    if (a.handoff === "app") {
      netActions.push({ testID: "network-check-device", variant: "secondary", label: "Check my device", onPress: () => router.push("/device") });
    }
    if (a.ssid && !trustedSsids.includes(a.ssid) && (a.state === "resting" || a.state === "ears_up") && context !== "public") {
      netActions.push({ testID: "network-trust", variant: "ghost", label: `Trust "${a.ssid}" — it's mine`, onPress: () => void trustNetwork(a.ssid!) });
    }
    netActions.push({ testID: "network-save", variant: "ghost", label: saved ? "Saved \u2713 — View saved checks" : "Save this check", onPress: () => { if (saved) { router.push("/saved-checks"); return; } void saveCheck({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, gate: "network", title: a.title, subject: a.ssid || "This network", state: a.state, stateName: STATE_NAME[a.state], summary: a.verdict, recommendation: a.recommendation, sections: [{ title: "Why Apollo reacted", lines: a.why }, { title: "Technical details", lines: a.technical }, { title: "Reference", lines: [`Scenario: ${a.scenario}`] }] }).then(() => { setSaved(true); showToast("Saved. Find it under Saved checks.", "neutral"); }); } });
    netActions.push({ testID: "network-again", variant: "ghost", label: "Check again", onPress: () => { setResult(null); setSaved(false); } });

    return (
      <CheckResultScreen
        result={model}
        onAskHiggins={() => router.push({
          pathname: "/(tabs)/ask",
          params: {
            context: result.event ? JSON.stringify(contextFromEvent(result.event, gateForCategory(result.event.category))) : "",
            prompt: askPrompt,
          },
        })}
        actions={netActions}
      />
    );
  }

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Internet Gate</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <InfoButton info={{ title: "About Internet Gate", body: ["Apollo monitors your network connection for DNS hijacking, insecure Wi-Fi and known malicious infrastructure.", "On Android with VPN protection enabled, Apollo can inspect DNS queries in real time. On all platforms, Apollo checks your current connection details and warns about known risks."] }} testID="network-info" />
          <Pressable testID="network-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
        </View>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="network-scroll">
        <GateAbout title="What Apollo can see here" testID="network-cannot-see"
          tip="A Wi‑Fi sign-in page asking for your email password or card details, a network name that's almost-but-not-quite the café's, or 'Free Wi‑Fi' with no password in a place you don't recognise.">
          <Body>This build sees only what the platform reports: connection type, Wi‑Fi name (with location permission), captive portal and VPN flags. It cannot read DNS queries, per-app traffic or confirm destination blocking — Apollo won&apos;t pretend otherwise.</Body>
        </GateAbout>
        <Card testID="network-dashboard" style={{ gap: spacing.sm, borderColor: toneColor(colors, protectionTone) }}>
          <View style={s.row}><View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><Wifi size={20} color={toneColor(colors, protectionTone)} /><Text style={s.statTitle} testID="network-protection-title">{protectionTitle}</Text></View><Pill tone={protectionTone} label={monitoring ? "Active" : unsupported ? "Unsupported" : network?.connected === false ? "Offline" : "Checking"} testID="network-protection-pill" /></View>
          <Body testID="network-protection-detail">{unsupported ? (guard?.detail ?? "") : monitoring ? "Apollo is watching this connection. It re-checks when you switch networks or reopen the app, reading the connection type, Wi‑Fi security and captive-portal status the platform reports." : !network?.connected ? "You're offline. Apollo will assess the connection as soon as you reconnect." : "Apollo is reading the current connection…"}</Body>
          <Text style={s.label}>Current network</Text>
          <Body testID="network-current">{!network?.connected ? "Not connected" : network.type === "wifi" ? `Wi‑Fi${network.ssid ? ` “${network.ssid}”` : " (name not revealed)"} · security ${network.wifiSecurity === "unknown" ? "not revealed" : network.wifiSecurity.toUpperCase()}${trustedSsids.includes(network.ssid ?? "") ? " · trusted" : ""}` : network.type === "cellular" ? "Mobile data" : `Connected via ${network.type}`}{vpnOn ? " · VPN on" : ""}</Body>
          <Text style={s.label}>Recent activity (24h)</Text>
          <Body testID="network-recent">{blocked ? `${blocked} confirmed protective block${blocked > 1 ? "s" : ""} · ` : "No confirmed protective blocks · "}{unresolved ? `${unresolved} unresolved network item${unresolved > 1 ? "s" : ""}` : "No unresolved network issues"}</Body>
          {site?.status === "permission_required" ? <Body>Site Gate needs its protection permission. Open Gates and use Restore protection.</Body> : null}
          <Button testID="network-refresh" variant="ghost" label={refreshing ? "Checking…" : "Refresh"} onPress={verifyNow} disabled={refreshing} />
        </Card>

        <SectionTitle>Check this network</SectionTitle>
        <Body>Public Wi‑Fi isn&apos;t automatically dangerous, and Apollo won&apos;t say it is. Tell it a little about where you are.</Body>
        <Text style={s.label}>Where are you?</Text>
        <View style={s.chips}>{NETWORK_CONTEXTS.map((o) => <Pressable key={o.id} testID={`network-ctx-${o.id}`} accessibilityRole="button" onPress={() => pickContext(o.id)} style={[s.chip, context === o.id && s.chipOn]}><Text style={s.chipText}>{o.label}</Text></Pressable>)}</View>

        <Text style={s.label}>Network name the venue advertised (optional)</Text>
        <TextInput testID="network-expected" style={s.input} value={expected} onChangeText={setExpected} placeholder="e.g. Hotel_Guest" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
        {vpnOn ? <View style={s.row}><Text style={[s.why, { flex: 1 }]}>I turned this VPN on myself</Text><Switch testID="network-vpn-trusted" value={vpnTrusted === true} onValueChange={(v) => setVpnTrusted(v ? true : false)} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View> : null}
        {network?.captivePortal ? <><Text style={s.label}>Address of the Wi‑Fi sign-in page (optional)</Text><TextInput testID="network-captive" style={s.input} value={captiveUrl} onChangeText={setCaptiveUrl} placeholder="https://…" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" /></> : null}
        <Button testID="network-run" label="Check this network" onPress={() => void run()} disabled={!network} />
        <CheckHistoryCard gate="network" refreshKey={historyKey} testID="network-history" />
      </KeyboardAwareScrollView>
    </View>
  );
}
