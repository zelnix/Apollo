import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { APP_ENV } from "@/src/config/appEnvironment";
import { APP_VERSION, buildLabel } from "@/src/config/buildInfo";
import { runProtectionHealthCheck } from "@/src/protection/healthCoordinator";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

interface IntelStatus { safe_browsing: { status: string; detail: string }; blocklist: { status: string; entries: number } }
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  card: { gap: spacing.md },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  label: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface, flex: 1 },
  value: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurfaceSecondary },
}));

export default function SupportScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { adapterLabel, isMock, showToast } = useApollo();
  const health = useProtectionHealth();
  const [checking, setChecking] = useState(false);
  const intel = useQuery({ queryKey: ["support-intel-status"], queryFn: () => apiGet<IntelStatus>("/intel/status"), staleTime: 60_000 });
  const runCheck = async () => {
    setChecking(true);
    try { await runProtectionHealthCheck("support"); showToast("Current protection status checked.", "resting"); }
    catch { showToast("Some protection status could not be checked.", "growling"); }
    finally { setChecking(false); }
  };
  const safeBrowsing = intel.data?.safe_browsing;
  return <View style={s.root} testID="support-screen">
    <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
      <Text style={s.title} testID="support-title">Support</Text>
      <Pressable testID="support-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
    </View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="support-scroll">
      <View><SectionTitle>Protection check</SectionTitle><Card style={s.card} testID="support-health-card">
        <Body testID="support-health-status">{health.checking || checking ? "Checking current device status…" : health.checkedAt ? "The latest device check completed." : "No current device check is available."}</Body>
        <Button testID="support-run-health-check" label={checking ? "Checking…" : "Run protection check"} disabled={checking} onPress={() => void runCheck()} />
      </Card></View>
      <View><SectionTitle>Service availability</SectionTitle><Card style={s.card} testID="support-services-card">
        <View style={s.row}><Text style={s.label}>Google Safe Browsing</Text><Pill testID="support-safe-browsing-status" tone={safeBrowsing?.status === "ok" ? "resting" : "unknown"} label={intel.isLoading ? "Checking" : safeBrowsing?.status === "ok" ? "Available" : safeBrowsing?.status === "not_configured" ? "Not configured" : "Unavailable"} /></View>
        <Body testID="support-safe-browsing-detail">{safeBrowsing?.detail ?? "Checks submitted links against Google's threat lists."}</Body>
        <View style={s.row}><Text style={s.label}>Apollo threat list</Text><Text style={s.value} testID="support-blocklist-count">{intel.data?.blocklist.entries ?? "—"} entries</Text></View>
      </Card></View>
      <View><SectionTitle>Build details</SectionTitle><Card style={s.card} testID="support-build-card">
        <View style={s.row}><Text style={s.label}>Version</Text><Text style={s.value} testID="support-version">{APP_VERSION}</Text></View>
        <View style={s.row}><Text style={s.label}>Build</Text><Text style={s.value} testID="support-build">{buildLabel()}</Text></View>
        <View style={s.row}><Text style={s.label}>Environment</Text><Text style={s.value} testID="support-environment">{APP_ENV}</Text></View>
        <View style={s.row}><Text style={s.label}>Security adapter</Text><Text style={s.value} testID="support-adapter">{adapterLabel}</Text></View>
        {isMock ? <Body testID="support-preview-adapter">This preview uses development device observations. Native builds read current operating-system signals.</Body> : null}
      </Card></View>
      <View><SectionTitle>Engine benchmark</SectionTitle><Card style={s.card} testID="support-benchmark-card">
        <Body>Run the labelled threat and clean sets for troubleshooting.</Body>
        <Button testID="support-open-benchmark" variant="secondary" label="Open benchmark" onPress={() => router.push("/benchmark")} />
      </Card></View>
    </ScrollView>
  </View>;
}