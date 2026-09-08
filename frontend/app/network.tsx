// Gate 8 — Network Guard dashboard + Check This Network. Only platform-reported facts and SDK events drive
// the verdict; the user adds context (home/work/public, expected network name, whether they turned the VPN on).
import { Redirect, useRouter } from "expo-router";
import Wifi from "lucide-react-native/icons/wifi";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markCheckDone } from "@/src/store/checkCompletion";
import { Body, Button, Card, Pill, SectionTitle, capabilityTone, toneColor } from "@/src/components/ui";
import { CAPABILITY_STATUS_LABEL } from "@/src/domain/capability";
import { analyseNetwork, NETWORK_CONTEXTS, type NetworkAnalysis, type NetworkContext, type NetworkSdkSummary } from "@/src/domain/networkAnalysis";
import { SCENT_WINDOW_MS } from "@/src/domain/threatScent";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { NetworkAccountSdk, summariseNetworkEvents } from "@/src/security/networkAccountSdk";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

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
  const { ready, setupDone, network, capabilities, protection, trustedSsids, trustNetwork, events, upsertEvent, deviceId, adapterLabel, verifyNow, refreshing } = useApollo();
  const [context, setContext] = useState<NetworkContext>("unknown");
  const [expected, setExpected] = useState("");
  const [vpnTrusted, setVpnTrusted] = useState<boolean | null>(null);
  const [captiveUrl, setCaptiveUrl] = useState("");
  const [sdk, setSdk] = useState<NetworkSdkSummary | null>(null);
  const [sdkLive, setSdkLive] = useState(false);
  const [result, setResult] = useState<{ a: NetworkAnalysis; event: PatrolEvent | null } | null>(null);
  const [tech, setTech] = useState(false);
  useEffect(() => {
    void NetworkAccountSdk.getNetworkProtectionCapabilities().then((c) => setSdkLive(c.domainFiltering === "supported"));
    void NetworkAccountSdk.getRecentNetworkEvents().then((ev) => setSdk(ev.length ? summariseNetworkEvents(ev) : null));
  }, []);

  const guard = capabilities.find((c) => c.id === "connection_guard");
  const site = capabilities.find((c) => c.id === "site_guard");
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentNet = events.filter((e) => e.category === "connection" && Date.parse(e.occurred_at) >= dayAgo);
  const blocked = recentNet.filter((e) => e.state === "biting" || e.verified_block).length + (sdk?.blockedMalicious ?? 0);
  const unresolved = recentNet.filter((e) => e.status === "active" && e.state !== "resting").length;
  const scentCats = useMemo(() => { const now = Date.now(); return events.filter((e) => e.state !== "resting" && (e.category === "app" || e.category === "device") && now - Date.parse(e.occurred_at) <= SCENT_WINDOW_MS).map((e) => e.category); }, [events]);
  const vpnOn = network?.vpnActive === true || network?.type === "vpn";
  const protectionTone = !(protection?.requested ?? protection?.running) ? "unknown" : guard?.status === "active" ? "resting" : guard?.status === "permission_required" ? "growling" : "unknown";
  const protectionTitle = !(protection?.requested ?? protection?.running) ? "Protection off" : guard?.status === "active" ? "Active" : guard?.status === "permission_required" ? "Permission required" : guard?.status === "unsupported" ? "Not supported on this device" : "Available";

  const run = async () => {

    void markCheckDone("network");    const a = analyseNetwork({ status: network, context, trustedSsids, expectedName: expected, vpnTrusted, captiveUrl, sdk, recentScentCategories: scentCats });
    let event: PatrolEvent | null = null;
    if (a.state !== "resting") {
      event = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "connection", state: a.state, status: a.state === "biting" ? "blocked" : "active", headline: `Network: ${a.title}`, what_happened: a.verdict, why: a.why, what_to_do: a.recommendation, indicator_host: captiveUrl.trim() ? captiveUrl.trim().replace(/^https?:\/\//i, "").split("/")[0] : null, indicator_digest: null, local_indicator: a.ssid, verified_block: a.state === "biting", adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: a.state === "ears_up" || a.state === "growling", claimed_brand: null, scenario: a.scenario });
    }
    setResult({ a, event });
  };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Network Guard</Text>
        <Pressable testID="network-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="network-scroll">
        <Card testID="network-dashboard" style={{ gap: spacing.sm, borderColor: toneColor(colors, protectionTone) }}>
          <View style={s.row}><View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><Wifi size={20} color={toneColor(colors, protectionTone)} /><Text style={s.statTitle} testID="network-protection-title">{protectionTitle}</Text></View><Pill tone={guard ? capabilityTone(guard.status) : "unknown"} label={guard ? CAPABILITY_STATUS_LABEL[guard.status] : "Unknown"} testID="network-protection-pill" /></View>
          <Body testID="network-protection-detail">{!(protection?.requested ?? protection?.running) ? "Turn protection on in Guard for Apollo to watch connections." : guard?.status === "active" ? (sdkLive ? "Apollo is watching network destinations and blocking confirmed-dangerous ones." : "Apollo assesses the connection the platform reports. Destination blocking needs the native Security SDK — not in this build.") : guard?.detail ?? ""}</Body>
          <Text style={s.label}>Current network</Text>
          <Body testID="network-current">{!network?.connected ? "Not connected" : network.type === "wifi" ? `Wi‑Fi${network.ssid ? ` “${network.ssid}”` : " (name not revealed)"} · security ${network.wifiSecurity === "unknown" ? "not revealed" : network.wifiSecurity.toUpperCase()}${trustedSsids.includes(network.ssid ?? "") ? " · trusted" : ""}` : network.type === "cellular" ? "Mobile data" : `Connected via ${network.type}`}{vpnOn ? " · VPN on" : ""}</Body>
          <Text style={s.label}>Recent activity (24h)</Text>
          <Body testID="network-recent">{blocked ? `${blocked} dangerous connection${blocked > 1 ? "s" : ""} blocked · ` : "No dangerous connections blocked · "}{unresolved ? `${unresolved} unresolved network item${unresolved > 1 ? "s" : ""}` : "No unresolved network issues"}</Body>
          {site?.status === "permission_required" ? <Body>Site Guard needs the network filter permission — grant it in Guard to see website visits.</Body> : null}
          <Button testID="network-refresh" variant="ghost" label={refreshing ? "Checking…" : "Refresh"} onPress={verifyNow} disabled={refreshing} />
        </Card>

        {!result ? (
          <>
            <SectionTitle>Check this network</SectionTitle>
            <Body>Public Wi‑Fi isn&apos;t automatically dangerous, and Apollo won&apos;t say it is. Tell it a little about where you are.</Body>
            <Text style={s.label}>Where are you?</Text>
            <View style={s.chips}>{NETWORK_CONTEXTS.map((o) => <Pressable key={o.id} testID={`network-ctx-${o.id}`} accessibilityRole="button" onPress={() => setContext(o.id)} style={[s.chip, context === o.id && s.chipOn]}><Text style={s.chipText}>{o.label}</Text></Pressable>)}</View>
            <Text style={s.label}>Network name the venue advertised (optional)</Text>
            <TextInput testID="network-expected" style={s.input} value={expected} onChangeText={setExpected} placeholder="e.g. Hotel_Guest" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
            {vpnOn ? <View style={s.row}><Text style={[s.why, { flex: 1 }]}>I turned this VPN on myself</Text><Switch testID="network-vpn-trusted" value={vpnTrusted === true} onValueChange={(v) => setVpnTrusted(v ? true : false)} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View> : null}
            {network?.captivePortal ? <><Text style={s.label}>Address of the Wi‑Fi sign-in page (optional)</Text><TextInput testID="network-captive" style={s.input} value={captiveUrl} onChangeText={setCaptiveUrl} placeholder="https://…" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" /></> : null}
            <Button testID="network-run" label="Check this network" onPress={() => void run()} disabled={!network} />
          </>
        ) : a ? (
          <>
            <Card testID="network-result" style={{ borderColor: toneColor(colors, a.state), gap: spacing.sm }}>
              <View style={s.chips}><Pill tone={a.state} label={STATE_NAME[a.state]} testID="network-state" /><Pill tone="neutral" label={a.scenario} testID="network-scenario" /></View>
              <Text style={s.why}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.label} testID="network-title">{a.title}</Text>
              <Text style={s.verdict} testID="network-verdict">{a.verdict}</Text>
              <SectionTitle>Why?</SectionTitle>
              {a.why.map((w, i) => <Text key={i} style={s.why} testID={`network-why-${i}`}>• {w}</Text>)}
              <SectionTitle>Recommendation</SectionTitle>
              <Text style={s.why} testID="network-recommendation">{a.recommendation}</Text>
            </Card>
            <Card style={{ gap: spacing.sm }} testID="network-actions">
              {a.handoff === "web" && captiveUrl.trim() ? <Button testID="network-check-portal" label="Check the sign-in page" onPress={() => router.push({ pathname: "/check", params: { url: captiveUrl.trim().startsWith("http") ? captiveUrl.trim() : `https://${captiveUrl.trim()}`, source: "network" } })} /> : null}
              {a.handoff === "app" ? <Button testID="network-check-device" label="Check my device" onPress={() => router.push("/device")} /> : null}
              {a.ssid && !trustedSsids.includes(a.ssid) && (a.state === "resting" || a.state === "ears_up") && context !== "public" ? <Button testID="network-trust" variant="secondary" label={`Trust “${a.ssid}” — it's mine`} onPress={() => void trustNetwork(a.ssid!)} /> : null}
              <Button testID="network-tech" variant="ghost" label="View technical details" onPress={() => setTech((t) => !t)} />
              {tech ? a.technical.map((t, i) => <Body key={i} testID={`network-tech-${i}`}>{t}</Body>) : null}
              <Button testID="network-ask" variant="ghost" label="Ask Higgins about this network" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { context: `Network check: ${a.title}. State: ${STATE_NAME[a.state]}. ${a.technical.join("; ")}`, prompt: "Is it OK to use this network?" } })} />
              <Button testID="network-again" variant="ghost" label="Check again" onPress={() => setResult(null)} />
            </Card>
          </>
        ) : null}
        <Card style={{ gap: spacing.xs }} testID="network-cannot-see">
          <SectionTitle>What Apollo can see here</SectionTitle>
          <Body>{sdkLive ? "Native Security SDK: destination filtering, DNS/VPN state and network events." : "This build sees only what the platform reports: connection type, Wi‑Fi name (with location permission), captive portal and VPN flags. DNS queries, per-app traffic and destination blocking need the native Security SDK — Apollo won't pretend otherwise."}</Body>
        </Card>
      </KeyboardAwareScrollView>
    </View>
  );
}
