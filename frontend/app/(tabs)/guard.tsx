import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Shield from "lucide-react-native/icons/shield";
import KeyRound from "lucide-react-native/icons/key-round";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { deriveGateState, type AccountScan } from "@/src/domain/accountMonitor";
import { getLastCheckedAt, getLastScan, getMonitoredEmails } from "@/src/store/accountMonitorStore";
import { gateTone } from "@/src/domain/gates";
import type { UserAction } from "@/src/domain/userActions";
import { userActionRoute } from "@/src/domain/userActions";
import { useProtectionHealth } from "@/src/protection/healthStore";
import type { GateHealthRecord } from "@/src/protection/healthTypes";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  title: { fontFamily: fonts.displayBold, fontSize: 30, color: c.onSurface },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  summaryText: { flex: 1, gap: 4 },
  card: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  question: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  attention: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.goldTint },
  name: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
}));

function HealthCard({ record, highlighted }: { record: GateHealthRecord; highlighted?: boolean }) {
  const s = useStyles();
  const router = useRouter();
  const { colors } = useTheme();
  const { showToast, enableSiteProtection } = useApollo();
  const [enablingSite, setEnablingSite] = React.useState(false);
  const act = async (action: UserAction) => {
    if (action.id === "restore_site") {
      // Same instant-flip path as Settings: wait for VPN consent to land, start Site Gate, then
      // refresh so this card updates to "Protection on" right away — no app reopen.
      setEnablingSite(true);
      try {
        const granted = await enableSiteProtection();
        showToast(granted ? "Site Gate is on." : "Site Gate needs VPN permission. Your other protection stays active.", granted ? "resting" : "growling");
      } catch {
        showToast("Android could not open the VPN permission screen. Try again shortly.", "growling");
      } finally { setEnablingSite(false); }
      return;
    }
    const route = userActionRoute(action.id);
    if (route) router.push(route as never);
  };
  const isRestoreSite = record.primaryAction?.id === "restore_site";
  return <Card testID={`gate-health-${record.id}`} style={[s.card, highlighted ? { borderColor: colors.gold, borderWidth: 2 } : null]}>
    {highlighted ? <Pill tone="ears_up" label="Opened from your alert" testID={`gate-health-${record.id}-focused`} /> : null}
    <View style={s.row}><Text testID={`gate-health-${record.id}-title`} style={s.name}>{record.title}</Text><Pill testID={`gate-health-${record.id}-state`} tone={gateTone(record.tone)} label={record.statusLabel} /></View>
    <View><Text style={s.question}>What this Gate helps with</Text><Body testID={`gate-health-${record.id}-purpose`}>{record.purpose}</Body></View>
    <View><Text style={s.question}>What Apollo is doing now</Text><Body testID={`gate-health-${record.id}-current`}>{record.currentHelp}</Body></View>
    {record.tone === "attention" && record.capability.automatic?.limitation ? <View style={s.attention} testID={`gate-health-${record.id}-attention`}><Text style={s.question}>Needs your attention</Text><Body>{record.capability.automatic.limitation}</Body></View> : null}
    {record.tone === "attention" && record.primaryAction ? <Button testID={`gate-health-${record.id}-action`} variant="primary" label={isRestoreSite && enablingSite ? "Turning on…" : record.primaryAction.label} disabled={isRestoreSite && enablingSite} onPress={() => void act(record.primaryAction!)} /> : null}
  </Card>;
}

export default function GuardScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { gate: gateParam } = useLocalSearchParams<{ gate?: string }>();
  const { ready, setupDone } = useApollo();
  const router = useRouter();
  const health = useProtectionHealth();
  const [acctEmails, setAcctEmails] = useState(0);
  const [acctScan, setAcctScan] = useState<AccountScan | null>(null);
  const [acctCheckedAt, setAcctCheckedAt] = useState<string | null>(null);
  useEffect(() => { void Promise.all([getMonitoredEmails(), getLastScan(), getLastCheckedAt()]).then(([e, sc, ca]) => { setAcctEmails(e.length); setAcctScan(sc); setAcctCheckedAt(ca); }); }, []);
  if (ready && !setupDone) return <Redirect href="/" />;
  const acctStatus = deriveGateState({ monitoredCount: acctEmails, lastScan: acctScan, lastCheckedAt: acctCheckedAt, checking: false });
  const active = health.gates.filter((gate) => gate.capability.automatic?.state === "running").length;
  const attentionGates = health.gates.filter((gate) => gate.tone === "attention");
  const attentionNames = attentionGates.map((g) => g.title.replace(/ Gate$/, "")).join(" and ");
  const reducedCoverage = attentionGates.length > 0 && active > 0;
  const summaryTitle = reducedCoverage ? "Protection active — reduced coverage" : attentionGates.length ? `${attentionNames} ${attentionGates.length === 1 ? "needs" : "need"} your attention` : `${active} ${active === 1 ? "Gate is" : "Gates are"} helping automatically`;
  return <View style={s.root} testID="gates-screen">
    <View style={{ paddingTop: insets.top + spacing.md }}><RootScreenHeader title="Gates" testID="gates-header" /></View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 110 }]}>
      <Text style={s.title} testID="gates-title">Your protection</Text>
      <Card testID="gates-summary-card">
        <View style={s.summary}><Shield size={28} color={attentionGates.length ? colors.growling : colors.brandPrimary} />
          <View style={s.summaryText}><Text style={s.name} testID="gates-summary-title">{summaryTitle}</Text>
            <Body testID="gates-summary-time">{health.checking ? "Checking current device status…" : health.checkedAt ? "Status checked from current device signals." : "Status will appear after the first device check."}</Body></View>
        </View>
      </Card>
      <Body testID="gates-introduction">Your protection. Apollo watches what this device allows and shows you what&apos;s working and anything that needs you. To check something yourself, use Check It.</Body>
      <View testID="gates-capability-section" style={{ gap: spacing.md }}><SectionTitle>Your Gates</SectionTitle>{health.gates.map((record) => <HealthCard key={record.id} record={record} highlighted={record.id === gateParam} />)}</View>
      <View testID="gates-account-section" style={{ gap: spacing.md }}>
        <SectionTitle>Account exposure</SectionTitle>
        <Card testID="gates-account-card" style={{ gap: spacing.sm, borderColor: toneColor(colors, acctStatus.tone) }}>
          <View style={s.row}><View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 }}><KeyRound size={20} color={toneColor(colors, acctStatus.tone)} /><Text style={s.name} testID="gates-account-title">{acctStatus.title}</Text></View><Pill tone={acctStatus.tone} label={acctStatus.state === "not_set_up" ? "Not set up" : acctStatus.state === "no_exposure" || acctStatus.state === "monitoring" ? "Monitoring" : acctStatus.state === "action_needed" ? "Action needed" : acctStatus.state === "exposure_found" ? "Worth a look" : acctStatus.state === "overdue" ? "Overdue" : "Partly checked"} testID="gates-account-pill" /></View>
          <Body testID="gates-account-detail">{acctStatus.detail}</Body>
          <Button testID="gates-account-open" variant="secondary" label={acctEmails === 0 ? "Set up in Check It" : "Open Check My Accounts"} onPress={() => router.push("/account-monitor")} />
        </Card>
      </View>
    </ScrollView>
  </View>;
}