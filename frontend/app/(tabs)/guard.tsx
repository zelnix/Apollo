import { Redirect, useRouter } from "expo-router";
import Shield from "lucide-react-native/icons/shield";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { gateTone } from "@/src/domain/gates";
import type { UserAction } from "@/src/domain/userActions";
import { userActionRoute } from "@/src/domain/userActions";
import { requestSiteProtectionRecovery } from "@/src/protection/healthCoordinator";
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

function HealthCard({ record }: { record: GateHealthRecord }) {
  const s = useStyles();
  const router = useRouter();
  const { showToast } = useApollo();
  const act = async (action: UserAction) => {
    if (action.id === "restore_site") {
      const attempt = await requestSiteProtectionRecovery();
      showToast(attempt.status === "failed" ? "Android could not open the approval screen." : "Apollo will check the result when you return.", attempt.status === "failed" ? "growling" : "neutral");
      return;
    }
    const route = userActionRoute(action.id);
    if (route) router.push(route as never);
  };
  return <Card testID={`gate-health-${record.id}`} style={s.card}>
    <View style={s.row}><Text testID={`gate-health-${record.id}-title`} style={s.name}>{record.title}</Text><Pill testID={`gate-health-${record.id}-state`} tone={gateTone(record.tone)} label={record.statusLabel} /></View>
    <View><Text style={s.question}>What this Gate helps with</Text><Body testID={`gate-health-${record.id}-purpose`}>{record.purpose}</Body></View>
    <View><Text style={s.question}>What Apollo is doing now</Text><Body testID={`gate-health-${record.id}-current`}>{record.currentHelp}</Body></View>
    {record.tone === "attention" && record.capability.automatic?.limitation ? <View style={s.attention} testID={`gate-health-${record.id}-attention`}><Text style={s.question}>Needs your attention</Text><Body>{record.capability.automatic.limitation}</Body></View> : null}
    {record.primaryAction ? <Button testID={`gate-health-${record.id}-action`} variant={record.tone === "attention" ? "primary" : "secondary"} label={record.primaryAction.label} onPress={() => void act(record.primaryAction!)} /> : null}
  </Card>;
}

export default function GuardScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, setupDone } = useApollo();
  const health = useProtectionHealth();
  if (ready && !setupDone) return <Redirect href="/" />;
  const active = health.gates.filter((gate) => gate.capability.automatic?.state === "running").length;
  const attention = health.gates.filter((gate) => gate.tone === "attention").length;
  return <View style={s.root} testID="gates-screen">
    <View style={{ paddingTop: insets.top + spacing.md }}><RootScreenHeader title="Gates" testID="gates-header" /></View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 110 }]}>
      <Text style={s.title} testID="gates-title">Your protection</Text>
      <Card testID="gates-summary-card">
        <View style={s.summary}><Shield size={28} color={attention ? colors.growling : colors.brandPrimary} />
          <View style={s.summaryText}><Text style={s.name} testID="gates-summary-title">{attention ? `${attention} ${attention === 1 ? "Gate needs" : "Gates need"} your attention` : `${active} ${active === 1 ? "Gate is" : "Gates are"} helping automatically`}</Text>
            <Body testID="gates-summary-time">{health.checking ? "Checking current device status…" : health.checkedAt ? "Status checked from current device signals." : "Status will appear after the first device check."}</Body></View>
        </View>
      </Card>
      <Body testID="gates-introduction">Your protection. Apollo watches what this device allows. You can also ask it to check anything you are unsure about.</Body>
      <View testID="gates-capability-section" style={{ gap: spacing.md }}><SectionTitle>Your Gates</SectionTitle>{health.gates.map((record) => <HealthCard key={record.id} record={record} />)}</View>
    </ScrollView>
  </View>;
}