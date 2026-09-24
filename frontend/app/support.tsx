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
import { runSystemHealthCheck, useSystemHealth } from "@/src/health/systemHealthCoordinator";
import type { CheckRow, CheckStatus } from "@/src/health/systemHealthTypes";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

interface IntelStatus { safe_browsing: { status: string; detail: string }; blocklist: { status: string; entries: number } }
const STATUS: Record<CheckStatus, string> = { pending: "Could not check", checking: "Checking", healthy: "Working", degraded: "Needs attention", unavailable: "Could not check" };
const RESULT_TEXT = {
  device: { working: "Protection on this phone is working.", problem: "Apollo cannot confirm protection right now." },
  backend: { working: "Apollo's online services are working.", problem: "Apollo's online services need attention. Protection on this phone may continue." },
  higgins: { working: "Higgins can complete investigations.", problem: "Higgins cannot complete an investigation right now." },
  report: { working: "Higgins can prepare reports.", problem: "Higgins cannot prepare a report right now." },
} as const;
const DETAILS: Record<string, string> = {
  native_build_required: "A native Apollo build is needed for this device check.",
  observation_unavailable: "Apollo could not confirm current device protection.",
  protection_needs_attention: "Current protection needs your attention.",
  backend_unreachable: "The Apollo service could not be reached or checked.",
  readiness_unavailable: "A required service or privacy check is unavailable.",
  provider_not_configured: "Higgins is not configured for a live check.",
  provider_timeout: "Higgins did not confirm a result in time.",
  invalid_provider_response: "Higgins could not confirm a complete answer.",
  render_unavailable: "This device could not prepare the temporary report.",
  cleanup_not_confirmed: "Apollo could not confirm temporary report cleanup.",
  device_cleanup_failed: "Apollo could not remove the temporary file on this device.",
  rate_limited: "Higgins was checked recently. Try again later.",
  cached_result: "This is an earlier result; Higgins was not contacted again.",
  check_cancelled: "The check was interrupted when this screen closed.",
};
function statusTone(status: CheckStatus): "resting" | "growling" | "unknown" { return status === "healthy" ? "resting" : status === "degraded" ? "growling" : "unknown"; }
function ResultRow({ label, result, id }: { label: string; result: CheckRow; id: keyof typeof RESULT_TEXT }) {
  const s = useStyles();
  const sentence = result.status === "checking" ? "Checking current status…" : RESULT_TEXT[id][result.status === "healthy" ? "working" : "problem"];
  return <View testID={`support-${id}-row`}><View style={s.row}><Text style={s.label} testID={`support-${id}-label`}>{label}</Text><Pill testID={`support-${id}-status`} tone={statusTone(result.status)} label={STATUS[result.status]} /></View><Body testID={`support-${id}-message`}>{sentence}</Body>{result.checkedAt ? <Body testID={`support-${id}-checked-at`}>Checked {new Date(result.checkedAt).toLocaleString()}</Body> : null}{result.code && result.status !== "healthy" ? <Body testID={`support-${id}-detail`}>{DETAILS[result.code] ?? "This part of the check could not be confirmed."}</Body> : null}</View>;
}
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
  const { adapterLabel, isMock } = useApollo();
  const health = useSystemHealth();
  const [moreDetails, setMoreDetails] = useState(false);
  const intel = useQuery({ queryKey: ["support-intel-status"], queryFn: () => apiGet<IntelStatus>("/intel/status"), staleTime: 60_000, enabled: moreDetails });
  const safeBrowsing = intel.data?.safe_browsing;
  return <View style={s.root} testID="support-screen">
    <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
      <Text style={s.title} testID="support-title">Support</Text>
      <Pressable testID="support-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
    </View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="support-scroll">
      <View><SectionTitle>Check Apollo and Higgins</SectionTitle><Card style={s.card} testID="support-health-card">
        <Body testID="support-health-intro">Confirm that protection, online services, Higgins investigations and reports are working.</Body>
        <Body testID="support-health-caution">This is a diagnostic, not proof that a threat was blocked.</Body>
        {health.checking || health.checkedAt ? <>
          <ResultRow id="device" label="Apollo protection" result={health.device} />
          <ResultRow id="backend" label="Apollo services" result={health.backend} />
          <ResultRow id="higgins" label="Higgins investigations" result={health.higgins} />
          <ResultRow id="report" label="Higgins reports" result={health.report} />
          {health.device.status === "healthy" && health.backend.status !== "healthy" && !health.checking ? <Body testID="support-health-partial-note">Protection on this phone continues. New online checks may be unavailable.</Body> : null}
          {health.checkedAt ? <Body testID="support-health-checked-at">Last checked {new Date(health.checkedAt).toLocaleString()}</Body> : null}
        </> : null}
        <Button testID="support-run-health-check" label={health.checking ? "Checking…" : "Check now"} disabled={health.checking} onPress={() => void runSystemHealthCheck(isMock)} />
        {health.checkedAt && [health.device, health.backend, health.higgins, health.report].some((item) => item.status !== "healthy") && !moreDetails ? <Button testID="support-open-support-details" variant="ghost" label="Open Support details" onPress={() => setMoreDetails(true)} /> : null}
        <Button testID="support-more-details" variant="ghost" label={moreDetails ? "Hide details" : "More details"} onPress={() => setMoreDetails((value) => !value)} />
        {moreDetails ? <View style={s.card} testID="support-more-details-panel">
          <View style={s.row}><Text style={s.label}>Version</Text><Text style={s.value} testID="support-version">{APP_VERSION}</Text></View>
          <View style={s.row}><Text style={s.label}>Build</Text><Text style={s.value} testID="support-build">{buildLabel()}</Text></View>
          <View style={s.row}><Text style={s.label}>Environment</Text><Text style={s.value} testID="support-environment">{APP_ENV}</Text></View>
          <View style={s.row}><Text style={s.label}>Security adapter</Text><Text style={s.value} testID="support-adapter">{adapterLabel}</Text></View>
          {isMock ? <Body testID="support-preview-adapter">This preview uses development device observations. Native builds read current operating-system signals.</Body> : null}
          <View style={s.row}><Text style={s.label}>Google Safe Browsing</Text><Pill testID="support-safe-browsing-status" tone={safeBrowsing?.status === "ok" ? "resting" : "unknown"} label={intel.isLoading ? "Checking" : safeBrowsing?.status === "ok" ? "Available" : safeBrowsing?.status === "not_configured" ? "Not configured" : "Unavailable"} /></View>
          <Body testID="support-safe-browsing-detail">{safeBrowsing?.detail ?? "Checks submitted links against Google's threat lists."}</Body>
          <View style={s.row}><Text style={s.label}>Apollo threat list</Text><Text style={s.value} testID="support-blocklist-count">{intel.data?.blocklist.entries ?? "—"} entries</Text></View>
        </View> : null}
      </Card></View>
    </ScrollView>
  </View>;
}