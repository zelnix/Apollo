import { Redirect, useRouter } from "expo-router";
import Shield from "lucide-react-native/icons/shield";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { automaticStatusTone, onDemandStatusTone, type GateCapabilityAction } from "@/src/domain/gates";
import { requestSiteProtectionRecovery } from "@/src/protection/healthCoordinator";
import { useProtectionHealth } from "@/src/protection/healthStore";
import type { GateHealthRecord } from "@/src/protection/healthTypes";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  title: { fontFamily: fonts.displayBold, fontSize: 30, color: c.onSurface },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  summaryText: { flex: 1, gap: 4 },
  card: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  capability: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider },
  capabilityTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  name: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
}));

function HealthCard({ record }: { record: GateHealthRecord }) {
  const s = useStyles();
  const router = useRouter();
  const { showToast } = useApollo();
  const act = async (action: GateCapabilityAction) => {
    if (action.kind === "restore_site") {
      const attempt = await requestSiteProtectionRecovery();
      showToast(attempt.status === "failed" ? "Android could not open the approval screen." : "Apollo will check the result when you return.", attempt.status === "failed" ? "growling" : "neutral");
      return;
    }
    if (action.route) router.push(action.route as never);
  };
  return <Card testID={`gate-health-${record.id}`} style={s.card}>
    <Text testID={`gate-health-${record.id}-title`} style={s.name}>{record.title}</Text>
    <View style={s.capability} testID={`gate-health-${record.id}-automatic`}><View style={s.row}><Text style={s.capabilityTitle}>Automatic protection</Text><Pill testID={`gate-health-${record.id}-automatic-state`} tone={automaticStatusTone(record.automaticStatus)} label={record.automaticStatus} /></View><Body testID={`gate-health-${record.id}-automatic-detail`}>{record.automaticDetail}</Body>{record.automaticAction ? <Button testID={`gate-health-${record.id}-automatic-action`} variant={record.automaticStatus === "Needs attention" ? "primary" : "secondary"} label={record.automaticAction.label} onPress={() => void act(record.automaticAction!)} /> : null}</View>
    <View style={s.capability} testID={`gate-health-${record.id}-on-demand`}><View style={s.row}><Text style={s.capabilityTitle}>Check when I ask</Text><Pill testID={`gate-health-${record.id}-on-demand-state`} tone={onDemandStatusTone(record.onDemandStatus)} label={record.onDemandStatus} /></View><Body testID={`gate-health-${record.id}-on-demand-detail`}>{record.onDemandDetail}</Body>{record.onDemandAction ? <Button testID={`gate-health-${record.id}-on-demand-action`} variant="secondary" label={record.onDemandAction.label} onPress={() => void act(record.onDemandAction!)} /> : null}</View>
  </Card>;
}

export default function GuardScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, setupDone } = useApollo();
  const health = useProtectionHealth();
  if (ready && !setupDone) return <Redirect href="/" />;
  const active = health.gates.filter((gate) => gate.automaticStatus === "On").length;
  const attention = health.gates.filter((gate) => gate.automaticStatus === "Needs attention").length;
  const setup = health.gates.filter((gate) => gate.automaticStatus === "Needs setup").length;
  return <View style={s.root} testID="gates-screen">
    <View style={{ paddingTop: insets.top + spacing.md }}><RootScreenHeader title="Gates" testID="gates-header" /></View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 110 }]}>
      <Text style={s.title} testID="gates-title">Your protection</Text>
      <Card testID="gates-summary-card">
        <View style={s.summary}><Shield size={28} color={attention ? colors.growling : colors.brandPrimary} />
          <View style={s.summaryText}><Text style={s.name} testID="gates-summary-title">{attention ? `${attention} automatic ${attention === 1 ? "protection needs" : "protections need"} attention` : setup ? `${setup} automatic ${setup === 1 ? "protection needs" : "protections need"} setup` : `${active} automatic ${active === 1 ? "protection is" : "protections are"} on`}</Text>
            <Body testID="gates-summary-time">{health.checking ? "Checking current device status…" : health.checkedAt ? "Status checked from current device signals." : "Status will appear after the first device check."}</Body></View>
        </View>
      </Card>
      <View testID="gates-capability-section" style={{ gap: spacing.md }}><SectionTitle>What each Gate can do</SectionTitle>{health.gates.map((record) => <HealthCard key={record.id} record={record} />)}</View>
    </ScrollView>
  </View>;
}