import { useRouter } from "expo-router";
import AppWindow from "lucide-react-native/icons/app-window";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Globe2 from "lucide-react-native/icons/globe";
import Link2 from "lucide-react-native/icons/link-2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquareText from "lucide-react-native/icons/message-square-text";
import Phone from "lucide-react-native/icons/phone";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import UserRound from "lucide-react-native/icons/user-round";
import Wifi from "lucide-react-native/icons/wifi";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, LayoutAnimation, Linking, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GateStatusCard } from "@/src/components/GateStatusCard";
import { Body, Button, Card, Pill, ScreenHeader, SectionTitle } from "@/src/components/ui";
import { buildGatesOverview, type GateId, type GateItem } from "@/src/domain/gates";
import { CallSdk, type CallProtectionCapabilities } from "@/src/security/callSdk";
import { MessagingSdk, type MessagingCapabilities } from "@/src/security/messagingSdk";
import { useApollo } from "@/src/store/ApolloContext";
import { apiGet } from "@/src/api/client";
import { useBackendHealth } from "@/src/api/backendHealth";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const ICON: Record<GateId, typeof Globe2> = { site: Globe2, link: Link2, text: MessageSquareText, call: Phone, network: Wifi, account: UserRound, email: Mail, app: AppWindow };
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface }, content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  summary: { gap: spacing.md, borderColor: c.navyBorder }, summaryTitle: { fontFamily: fonts.displayBold, fontSize: 25, lineHeight: 31, color: c.onSurface },
  higginsLabel: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 1.1, textTransform: "uppercase", color: c.brand },
  higgins: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onSurface }, section: { gap: spacing.md },
  notice: { gap: spacing.sm, borderColor: c.goldBorder, backgroundColor: c.goldTint }, detailButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm },
  detailText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand }, detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  detailLabel: { flex: 1, fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface }, small: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.onSurfaceSecondary },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.sm }, switchCopy: { flex: 1, gap: 2 },
}));

export default function GatesScreen() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { protection, permissions, capabilities, network, refreshing, verifyNow, toggleProtection, requestPermission, deviceId } = useApollo();
  const service = useBackendHealth();
  const [messaging, setMessaging] = useState<MessagingCapabilities | null>(null);
  const [calls, setCalls] = useState<CallProtectionCapabilities | null>(null);
  const [emailRuntime, setEmailRuntime] = useState<{ checking: boolean; configured: boolean; connected: boolean; monitoringRequested: boolean; lastCheckedAt: string | null; lastErrorAt: string | null }>({ checking: true, configured: true, connected: false, monitoringRequested: false, lastCheckedAt: null, lastErrorAt: null });
  const [breachConfigured, setBreachConfigured] = useState<boolean | undefined>(undefined);
  const [details, setDetails] = useState(false); const [notice, setNotice] = useState<string | null>(null); const [restoring, setRestoring] = useState<GateId | null>(null);
  const pendingSettings = useRef<GateId | null>(null);
  const refreshGateCapabilities = useCallback(async () => {
    const [nextMessaging, nextCalls] = await Promise.all([MessagingSdk.getMessagingCapabilities(), CallSdk.getCallProtectionCapabilities()]);
    setMessaging(nextMessaging); setCalls(nextCalls); return { nextMessaging, nextCalls };
  }, []);
  useEffect(() => { void refreshGateCapabilities(); }, [refreshGateCapabilities]);
  useEffect(() => {
    if (!deviceId) return;
    type MailStatus = { configured: boolean; connected: boolean; monitoring_enabled: boolean; monitor_last_checked_at: string | null; monitor_last_error_at: string | null };
    apiGet<MailStatus>(`/gmail/status?device_id=${deviceId}`)
      .then((gmail) => setEmailRuntime({ checking: false, configured: gmail.configured, connected: gmail.connected, monitoringRequested: gmail.monitoring_enabled,
        lastCheckedAt: gmail.monitor_last_checked_at, lastErrorAt: gmail.monitor_last_error_at }))
      .catch(() => setEmailRuntime((current) => ({ ...current, checking: false, configured: false })));
  }, [deviceId]);
  useEffect(() => { if (deviceId) apiGet<{ breach_lookup_configured: boolean }>("/account/status").then((value) => setBreachConfigured(value.breach_lookup_configured)).catch(() => setBreachConfigured(false)); }, [deviceId]);

  const overview = useMemo(() => buildGatesOverview({ platform: Platform.OS, checking: refreshing, protection, permissions, capabilities, messaging, calls, email: emailRuntime,
    online: service.reachable !== false, accountBreachConfigured: breachConfigured }),
    [refreshing, protection, permissions, capabilities, messaging, calls, emailRuntime, service.reachable, breachConfigured]);

  const verifyRestoration = useCallback(async (id: GateId) => {
    setRestoring(id); setNotice("I’m waiting for Apollo to verify whether the protection is actually running.");
    try {
      if (id === "site") {
        const observed = await verifyNow();
        setNotice(observed?.operational && !!observed.lastVerified ? "Protection is confirmed running. Site Gate is active."
          : `Site Gate is still not confirmed running. ${observed?.degradedReason ?? "Open the device protection settings and complete the remaining permission step."}`);
      } else {
        const latest = await refreshGateCapabilities();
        const active = id === "text" ? latest.nextMessaging.smsFiltering === "supported" : latest.nextCalls.callScreening === "supported";
        setNotice(active ? `${id === "text" ? "Text" : "Call"} Gate is confirmed active.`
          : `${id === "text" ? "Text" : "Call"} Gate is still off. Return to Settings and complete the requested role or permission.`);
      }
    } catch {
      setNotice(`${id === "site" ? "Site" : id === "text" ? "Text" : "Call"} Gate could not be verified. Check the device permission or role, then try again.`);
    } finally { setRestoring(null); }
  }, [refreshGateCapabilities, verifyNow]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !pendingSettings.current) return;
      const id = pendingSettings.current; pendingSettings.current = null; void verifyRestoration(id);
    });
    return () => sub.remove();
  }, [verifyRestoration]);

  const restoreSite = async () => {
    setRestoring("site"); setNotice(null);
    try {
      const missing = permissions.find((p) => (p.id === "network_filter" || p.id === "vpn_config") && p.status !== "granted" && p.status !== "not_applicable");
      if (missing?.status === "blocked" || (missing && !missing.canAskAgain)) {
        pendingSettings.current = "site"; setNotice("Open Settings and restore Apollo’s protection permission. I’ll check again when you return."); await Linking.openSettings(); return;
      }
      if (missing) {
        const result = await requestPermission(missing.id);
        if (result.status !== "granted" && result.status !== "not_applicable") {
          setNotice(result.canAskAgain ? "The permission was not granted. Tap Restore protection to try again." : "The permission is blocked. Tap Restore protection to open Settings."); return;
        }
      }
      await toggleProtection(true); await verifyRestoration("site");
    } catch {
      setNotice("Site Gate restoration could not be completed. Open the device protection settings, complete the remaining permission, then return and try again.");
    } finally { setRestoring(null); }
  };

  const restoreNativeGate = async (id: "text" | "call") => {
    setRestoring(id); setNotice(null);
    try {
      const result = id === "text" ? await MessagingSdk.openSmsListenerSettings() : await CallSdk.requestCallScreeningRole();
      if (!result.opened) { setNotice(`${id === "text" ? "Text" : "Call"} Gate cannot open its protection settings on this device. Manual checks remain available.`); return; }
      pendingSettings.current = id; setNotice(`Complete the ${id === "text" ? "notification access" : "call-screening"} step in Settings. I’ll verify it when you return.`);
    } catch {
      setNotice(`${id === "text" ? "Text" : "Call"} Gate settings could not be opened. Manual checks remain available.`);
    } finally { setRestoring(null); }
  };

  const onGateAction = (gate: GateItem) => {
    if (gate.action === "open" && gate.route) { router.push(gate.route as never); return; }
    if (gate.action === "restore_site") void restoreSite();
    else if (gate.action === "restore_text") void restoreNativeGate("text");
    else if (gate.action === "restore_call") void restoreNativeGate("call");
  };

  const gap = overview.gates.some((gate) => gate.status === "Needs attention" || gate.status === "Off");
  const checkingSummary = overview.summary === "Checking protection status";
  const summaryTone = checkingSummary ? "neutral" : gap ? "barking" : overview.summary === "All available protection is active" ? "resting" : "unknown";
  const summaryLabel = checkingSummary ? "Checking status" : gap ? "Needs attention" : overview.summary === "All available protection is active" ? "Active" : "Manual only";
  return <View style={s.root} testID="gates-screen">
    <View style={{ paddingTop: insets.top + spacing.md }}><ScreenHeader title="Gates" testID="gates-header" /></View>
    <ScrollView contentContainerStyle={s.content} testID="gates-scroll">
      <Card testID="gates-summary-card" style={s.summary}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><ShieldAlert size={21} color={gap ? colors.barking : colors.brand} />
          <Pill testID="gates-summary-status" tone={summaryTone} label={summaryLabel} /></View>
        <Text testID="gates-summary" style={s.summaryTitle}>{overview.summary}</Text>
        <Text style={s.higginsLabel}>Higgins</Text><Text testID="gates-higgins" style={s.higgins}>{notice ?? overview.higgins}</Text>
        {overview.primary ? <Button testID="gates-primary-action" label={restoring ? "Checking…" : overview.primary.actionLabel} onPress={() => onGateAction(overview.primary!)} disabled={!!restoring} /> : null}
        <Pressable testID="gates-more-details" accessibilityRole="button" accessibilityState={{ expanded: details }} style={s.detailButton}
          onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setDetails((value) => !value); }}>
          <Text style={s.detailText}>More details</Text>{details ? <ChevronUp size={19} color={colors.brand} /> : <ChevronDown size={19} color={colors.brand} />}
        </Pressable>
        {details ? <View testID="gates-technical-details">
          <View style={s.switchRow}><View style={s.switchCopy}><Text style={s.detailLabel}>Requested setting</Text><Text style={s.small}>This setting alone does not prove protection is running.</Text></View>
            <Switch testID="gates-protection-switch" value={!!protection?.requested} onValueChange={(value) => void toggleProtection(value)} trackColor={{ false: colors.borderStrong, true: colors.resting }} thumbColor={colors.onSurface} /></View>
          <View style={s.detailRow}><Text style={s.detailLabel}>Confirmed running</Text><Pill testID="gates-confirmed-running" tone={protection?.operational && protection.lastVerified ? "resting" : "growling"} label={protection?.operational && protection.lastVerified ? "Yes" : "No"} /></View>
          <View style={s.detailRow}><Text style={s.detailLabel}>Enforcement</Text><Text style={s.small}>{protection?.enforcementMethod ?? "Not established"}</Text></View>
          <View style={s.detailRow}><Text style={s.detailLabel}>DNS / VPN visibility</Text><Text style={s.small}>{network?.inspectable ? "Observed by adapter" : "Not observed"}</Text></View>
          <View style={s.detailRow}><Text style={s.detailLabel}>Last checked</Text><Text style={s.small}>{protection?.checkedAt ? new Date(protection.checkedAt).toLocaleTimeString() : "Not established"}</Text></View>
          {permissions.map((permission) => <View key={permission.id} style={s.detailRow} testID={`gates-permission-${permission.id}`}><Text style={s.detailLabel}>{permission.title}</Text><Pill tone={permission.status === "granted" ? "resting" : permission.status === "not_applicable" ? "unknown" : "growling"} label={permission.status.replaceAll("_", " ")} /></View>)}
        </View> : null}
      </Card>

      <View style={s.section}><SectionTitle>Automatic protection and monitoring</SectionTitle>
        {overview.gates.filter((gate) => gate.mode !== "Manual submission").map((gate) => { const Icon = ICON[gate.id]; return <GateStatusCard key={gate.id} gate={gate} icon={<Icon size={19} color={colors.brand} />} onAction={() => onGateAction(gate)} />; })}
      </View>
      <View style={s.section}><SectionTitle>Checks you start</SectionTitle>
        <Body testID="gates-manual-note">These Gates assess only what you submit. Ready to check does not mean Apollo is monitoring that entry point automatically.</Body>
        {overview.gates.filter((gate) => gate.mode === "Manual submission").map((gate) => { const Icon = ICON[gate.id]; return <GateStatusCard key={gate.id} gate={gate} icon={<Icon size={19} color={colors.brand} />} onAction={() => onGateAction(gate)} />; })}
      </View>
    </ScrollView>
  </View>;
}