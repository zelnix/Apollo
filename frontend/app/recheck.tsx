// Device Re-check — manual diagnostic in the Check tab (spec §17). Repeats the platform-appropriate
// baseline, compares with the previous baseline where data permits, and keeps history. This is a
// manual action only: it never runs in the background and is never duplicated in Gates.
import { Redirect, useRouter } from "expo-router";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FirstCheckResult } from "@/src/components/FirstCheckResult";
import { Body, Button, Card } from "@/src/components/ui";
import { GateAbout } from "@/src/components/GateAbout";
import { diffFirstCheck, reCheckHeadline, type FirstCheckChange, type FirstCheckReport } from "@/src/domain/firstCheck";
import { runSystemHealthCheck } from "@/src/health/systemHealthCoordinator";
import { collectFirstCheck } from "@/src/security/firstCheckSignals";
import { getBaseline, saveFirstCheck } from "@/src/store/firstCheckStore";
import { useApollo } from "@/src/store/ApolloContext";
import { markCheckDone } from "@/src/store/checkCompletion";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  intro: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onSurfaceSecondary },
  stamp: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted },
  centre: { paddingVertical: spacing["2xl"], alignItems: "center", gap: spacing.md },
}));

export default function Recheck() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, isMock } = useApollo();
  const [report, setReport] = useState<FirstCheckReport | null>(null);
  const [previous, setPrevious] = useState<FirstCheckReport | null>(null);
  const [changes, setChanges] = useState<FirstCheckChange[]>([]);
  const [running, setRunning] = useState(false);

  // On entry, show the last saved baseline (if any) without re-running — the person chooses when to re-check.
  useEffect(() => { void getBaseline().then((b) => { setReport(b); setPrevious(b); }); }, []);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const prior = await getBaseline();
      const fresh = await collectFirstCheck();
      const diff = diffFirstCheck(prior, fresh);
      await saveFirstCheck(fresh, "re_check");
      setPrevious(prior);
      setChanges(diff);
      setReport(fresh);
      void markCheckDone("device");
      // Re-check is a full diagnostic: also refresh Apollo/Higgins system health so Support reflects it.
      void runSystemHealthCheck(isMock);
    } finally { setRunning(false); }
  }, [isMock]);

  const justRan = report && previous !== report;
  const stamp = report ? new Date(report.checkedAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

  if (ready && !setupDone) return <Redirect href="/" />;

  return (
    <View style={s.root} testID="recheck-root">
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Device Re-check</Text>
        <Pressable testID="recheck-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="recheck-scroll">
        <GateAbout title="About Device Re-check" testID="recheck-intro"
          tip="Pop-ups or ads appearing outside apps, the battery or data draining unusually fast, new apps or icons you didn't add, or settings that change back after you fix them.">
          <Body>Re-check this device for signs of malware, unsafe changes or an existing compromise. Higgins repeats the checks this device allows and compares them with the last check.</Body>
        </GateAbout>
        {stamp ? <Text style={s.stamp} testID="recheck-stamp">Last checked {stamp}</Text> : null}
        <Button testID="recheck-run" label={running ? "Checking…" : report ? "Run Device Re-check" : "Run the first check now"} onPress={() => void run()} disabled={running} icon={running ? <ActivityIndicator color={colors.onBrandPrimary} /> : <RefreshCw size={18} color={colors.onBrandPrimary} />} />

        {running ? (
          <Card testID="recheck-running" style={{ gap: spacing.sm }}>
            <View style={s.centre}><ActivityIndicator color={colors.brand} /><Body>Higgins is reading the security signals this device allows…</Body></View>
          </Card>
        ) : report ? (
          <FirstCheckResult report={report} changes={justRan ? changes : undefined} headlineOverride={justRan ? reCheckHeadline(report.overall, changes.length) : undefined} kind="re_check" autoStartAsk={!!justRan} testID="recheck-result" />
        ) : (
          <Card testID="recheck-empty" style={{ gap: spacing.sm }}>
            <Body>Higgins hasn&apos;t run a baseline on this device yet. Run it now to establish one.</Body>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
