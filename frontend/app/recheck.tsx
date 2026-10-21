// Device Check — the manual Higgins check in the Check tab (spec §17). Repeats the
// platform-appropriate baseline, compares it with the previous baseline where data permits, and keeps
// history. Manual only: it never runs in the background and is never duplicated in Gates.
//
// The finished result is shown on the shared Check Results screen every other Apollo check uses:
// one overall result → the checks that actually ran → one action when needed → details/evidence.
import { Redirect, useRouter } from "expo-router";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckResultScreen } from "@/src/components/CheckResultScreen";
import { Body, Button, Card } from "@/src/components/ui";
import { GateAbout } from "@/src/components/GateAbout";
import { diffFirstCheck, reCheckHeadline, FIRST_CHECK_COPY, type FirstCheckChange, type FirstCheckReport } from "@/src/domain/firstCheck";
import { deviceCheckResult } from "@/src/domain/firstCheckResultModel";
import { openHigginsHandoff } from "@/src/domain/higginsHandoff";
import { runSystemHealthCheck } from "@/src/health/systemHealthCoordinator";
import { collectFirstCheck, type FirstCheckProgress } from "@/src/security/firstCheckSignals";
import { getBaseline, saveFirstCheck } from "@/src/store/firstCheckStore";
import { useApollo } from "@/src/store/ApolloContext";
import { markCheckDone } from "@/src/store/checkCompletion";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { CheckToolHeader } from "@/src/components/CheckToolHeader";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  stamp: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted },
  centre: { paddingVertical: spacing.xl, alignItems: "center", gap: spacing.md },
  stageLabel: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface, textAlign: "center" },
  stageCount: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  progressTrack: { height: 6, width: "100%", backgroundColor: c.borderStrong, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
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
  const [progress, setProgress] = useState<FirstCheckProgress | null>(null);

  // On entry, show the last saved baseline (if any) without re-running — the person chooses when to re-check.
  useEffect(() => { void getBaseline().then((b) => { setReport(b); setPrevious(b); }); }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setProgress(null);
    try {
      const prior = await getBaseline();
      const fresh = await collectFirstCheck(setProgress);
      const diff = diffFirstCheck(prior, fresh);
      await saveFirstCheck(fresh, "re_check");
      setPrevious(prior);
      setChanges(diff);
      setReport(fresh);
      void markCheckDone("device");
      // A Device Check is a full diagnostic: also refresh Apollo/Higgins service health for Support.
      void runSystemHealthCheck(isMock);
    } finally { setRunning(false); setProgress(null); }
  }, [isMock]);

  const justRan = !!report && previous !== report;
  const stamp = report ? new Date(report.checkedAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

  // One result model, built from the checks that actually ran.
  const result = useMemo(() => {
    if (!report) return null;
    const built = deviceCheckResult(report, "re_check", justRan ? reCheckHeadline(report.overall, changes.length) : undefined);
    if (justRan && changes.length) {
      built.model.evidence = [
        ...changes.map((c) => ({ label: `Changed — ${c.title}`, value: c.detail })),
        ...built.model.evidence,
      ];
    }
    return built;
  }, [report, justRan, changes]);

  if (ready && !setupDone) return <Redirect href="/" />;

  // ── Finished: the shared Check Results screen ──
  if (result && !running) {
    const actions = [
      ...(result.actionRoute
        ? [{
            label: result.actionRoute.label,
            testID: "recheck-primary-action",
            variant: "primary" as const,
            onPress: () => router.push(result.actionRoute!.route as never),
          }]
        : []),
      { label: "Check again", testID: "recheck-run-again", variant: "secondary" as const, onPress: () => void run() },
    ];
    return (
      <CheckResultScreen
        result={result.model}
        actions={actions}
        onAskHiggins={() => openHigginsHandoff(router, {
          gate: "device",
          issue_summary: `Device Check: ${result.model.headline}`,
          assessment_state: FIRST_CHECK_COPY[report!.overall].dogState,
          findings: report!.checks.map((c) => ({
            summary: `${c.title} — ${c.explanation}`,
            provenance: c.executed ? ("observed" as const) : ("inferred" as const),
            status: c.result === "CONFIRMED_THREAT" || c.result === "SUSPICIOUS" ? ("warning" as const) : ("uncertain" as const),
          })),
          uncertainty: report!.unavailable,
          confirmed_protective_actions: [],
          user_reported_actions: [],
          available_actions: [],
        }, "What did you find, and what should I do next?")}
      />
    );
  }

  return (
    <View style={s.root} testID="recheck-root">
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <CheckToolHeader
          title="Device Check"
          info={{ title: "About Device Check", body: ["Re-check this device for signs of malware, unsafe changes or an existing compromise.", "Higgins repeats the checks this device allows and compares them with the last check. Pop-ups, unusual battery drain, new apps you didn't add, or settings that change back after you fix them may indicate a problem."] }}
          testID="recheck"
        />
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="recheck-scroll">
        <GateAbout title="About Device Check" testID="recheck-intro"
          tip="Pop-ups or ads appearing outside apps, the battery or data draining unusually fast, new apps or icons you didn't add, or settings that change back after you fix them.">
          <Body>Re-check this device for signs of malware, unsafe changes or an existing compromise. Higgins repeats the checks this device allows and compares them with the last check.</Body>
        </GateAbout>
        {stamp ? <Text style={s.stamp} testID="recheck-stamp">Last checked {stamp}</Text> : null}

        {running ? (
          <Card testID="recheck-running" style={{ gap: spacing.md }}>
            <View style={s.centre}>
              <ActivityIndicator color={colors.brand} />
              <Text style={s.stageLabel} testID="recheck-progress-label">
                {progress?.label ?? "Starting the check"}
              </Text>
              <Text style={s.stageCount} testID="recheck-progress-count">
                {progress ? `Step ${progress.step} of ${progress.total}` : "Step 1 of 4"}
              </Text>
              <View style={s.progressTrack}>
                <View style={[s.progressFill, {
                  width: `${progress ? Math.round((progress.step / progress.total) * 100) : 5}%`,
                  backgroundColor: colors.brand,
                }]} />
              </View>
            </View>
          </Card>
        ) : (
          <>
            <Button testID="recheck-run" label="Run the check now" onPress={() => void run()} icon={<RefreshCw size={18} color={colors.onBrandPrimary} />} />
            <Card testID="recheck-empty" style={{ gap: spacing.sm }}>
              <Body>Higgins hasn&apos;t run a check on this device yet. Run it now so there is something to compare future checks against.</Body>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
