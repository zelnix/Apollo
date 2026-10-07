// Higgins First Check — onboarding baseline (spec §4). Runs AFTER permissions/platform setup
// (setup-gates) and BEFORE Apollo enters its normal all-clear experience. Apollo must never assume it
// arrived on a clean device. A detected concern never blocks entry — Apollo still protects what it can;
// Higgins just keeps the starting state honest.
import { useRouter } from "expo-router";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApolloLogo } from "@/src/components/ApolloLogo";
import { FirstCheckResult } from "@/src/components/FirstCheckResult";
import { Body, Button } from "@/src/components/ui";
import type { FirstCheckReport } from "@/src/domain/firstCheck";
import { collectFirstCheck } from "@/src/security/firstCheckSignals";
import { saveFirstCheck } from "@/src/store/firstCheckStore";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.lg },
  eyebrow: { fontFamily: fonts.display, fontSize: 13, color: c.restingText, letterSpacing: 1.4, textTransform: "uppercase" },
  title: { fontFamily: fonts.displayBold, fontSize: 28, color: c.onSurface, lineHeight: 34, textAlign: "center" },
  sub: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onSurfaceSecondary, textAlign: "center" },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm },
  note: { fontFamily: fonts.text, fontSize: 12, color: c.muted, textAlign: "center" },
}));

export default function FirstCheckOnboarding() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [report, setReport] = useState<FirstCheckReport | null>(null);
  const [running, setRunning] = useState(true);

  const run = useCallback(async () => {
    setRunning(true);
    const result = await collectFirstCheck();
    await saveFirstCheck(result, "first_check");
    setReport(result);
    setRunning(false);
  }, []);

  useEffect(() => { void run(); }, [run]);

  const goHome = () => router.replace("/(tabs)/home");

  if (running || !report) {
    return (
      <View style={s.root} testID="first-check-onboarding-loading">
        <View style={[s.centre, { paddingTop: insets.top }]}>
          <ApolloLogo size={96} />
          <Text style={s.eyebrow}>Higgins First Check</Text>
          <Text style={s.title}>Checking this device&apos;s starting point…</Text>
          <Text style={s.sub}>Apollo never assumes a new device is clean. Higgins is reading the security signals this device allows — it takes a moment.</Text>
          <ActivityIndicator color={colors.brand} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.root} testID="first-check-onboarding">
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + spacing.lg, paddingBottom: spacing.xl }]}>
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <ApolloLogo size={72} />
          <Text style={s.eyebrow}>Higgins First Check</Text>
        </View>
        <FirstCheckResult report={report} kind="first_check" />
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {report.overall === "ERROR" ? (
          <Button testID="first-check-retry" variant="secondary" label="Try the check again" icon={<RefreshCw size={18} color={colors.brand} />} onPress={() => void run()} />
        ) : null}
        <Button testID="first-check-continue" label="Continue to Apollo" onPress={goHome} icon={<ShieldCheck size={18} color={colors.onBrandPrimary} />} />
        <Text style={s.note}>You can repeat this anytime from Check It → Higgins Re-check.</Text>
      </View>
    </View>
  );
}
