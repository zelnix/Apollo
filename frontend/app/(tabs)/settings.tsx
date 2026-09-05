import { useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { Sheet } from "@/src/components/Sheet";
import { TimeStepper } from "@/src/components/TimeStepper";
import { Body, Button, Card, Pill, ScreenHeader, SectionTitle } from "@/src/components/ui";
import { APP_ENV } from "@/src/config/appEnvironment";
import { PRIVACY_POLICY_SUMMARY } from "@/src/domain/privacy";
import type { PushStatus } from "@/src/push/notifications";
import { SECURECORE_LABEL, IS_MOCK_SECURECORE } from "@/src/security/securecore/SecureCore";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";
import { minimiseApp } from "@/src/utils/minimise";

interface IntelStatus { safe_browsing: { status: string; detail: string }; blocklist: { status: string; entries: number } }
const PUSH_LABEL: Record<PushStatus, string> = { granted: "On", denied: "Off", undetermined: "Not set", blocked: "Blocked in Settings", unsupported: "Native build only" };

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  label: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface, flex: 1 },
  mono: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurfaceSecondary },
  trustRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  footer: { fontFamily: fonts.text, fontSize: 12, color: c.muted, textAlign: "center" },
}));

export default function SettingsScreen() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId, trust, revokeTrust, clearPatrol, adapterLabel, isMock, pushStatus, enablePush, quietHours, quietNow, setQuietHours, lowPower, setLowPower, showToast } = useApollo();
  const { colors } = useTheme();
  const [confirmClear, setConfirmClear] = useState(false);
  const intel = useQuery({ queryKey: ["intel-status"], queryFn: () => apiGet<IntelStatus>("/intel/status"), staleTime: 60_000 });
  const sb = intel.data?.safe_browsing;
  const sbTone = sb?.status === "ok" ? "resting" : sb?.status === "not_configured" ? "unknown" : "growling";

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <ScreenHeader title="Settings" testID="settings-header" />
      </View>
      <ScrollView contentContainerStyle={s.content} testID="settings-scroll">
        <View>
          <SectionTitle>Privacy</SectionTitle>
          <Card testID="settings-privacy">
            {PRIVACY_POLICY_SUMMARY.map((line) => <Body key={line} style={{ marginBottom: spacing.sm }}>• {line}</Body>)}
            <View style={s.row}>
              <Text style={s.label}>Anonymous device ID</Text>
              <Text style={s.mono} testID="settings-device-id">{deviceId ? `${deviceId.slice(0, 8)}…` : "—"}</Text>
            </View>
            <Button testID="settings-privacy-disclosure" variant="secondary" label="Read the full privacy disclosure" onPress={() => router.push("/privacy-disclosure")} style={{ marginTop: spacing.sm }} />
          </Card>
        </View>

        <View>
          <SectionTitle>Share links into Apollo</SectionTitle>
          <Card style={{ gap: spacing.sm }} testID="settings-share">
            <Body>From Messages, Mail or a browser, tap Share → Apollo to check a link instantly. Apollo also notices links on your clipboard when you open it, and opens links sent to apollo://check?url=… — nothing is checked until you confirm.</Body>
            <Pill tone={Platform.OS === "web" ? "unknown" : "growling"} label={Platform.OS === "web" ? "Share sheet: needs a native build" : "Share sheet: available after a native build"} />
          </Card>
        </View>

        <View>
          <SectionTitle>Alert notifications</SectionTitle>
          <Card style={{ gap: spacing.sm }} testID="settings-push">
            <View style={s.row}>
              <Text style={s.label}>Tell me the moment Apollo barks</Text>
              <Pill tone={pushStatus === "granted" ? "resting" : pushStatus === "unsupported" ? "unknown" : "growling"} label={PUSH_LABEL[pushStatus]} testID="settings-push-status" />
            </View>
            <Body>Barking and Biting alerts reach you even when the app is closed, plus replies from family you share with. Only the headline and what to do — never the link.</Body>
            {pushStatus === "unsupported" ? <Pill tone="unknown" label="Needs a native build (not available in Expo Go or web)" /> : null}
            {pushStatus === "denied" || pushStatus === "undetermined" ? <Button testID="settings-push-enable" variant="secondary" label="Turn on alert notifications" onPress={() => void enablePush()} /> : null}
            {pushStatus === "blocked" ? <Button testID="settings-push-settings" variant="secondary" label="Open Settings to allow notifications" onPress={() => void Linking.openSettings()} /> : null}
          </Card>
        </View>

        <View>
          <SectionTitle>Quiet hours</SectionTitle>
          <Card style={{ gap: spacing.sm }} testID="settings-quiet">
            <View style={s.row}>
              <Text style={s.label}>Hold growling nudges at night</Text>
              <Switch testID="settings-quiet-switch" value={quietHours.enabled} onValueChange={(v) => void setQuietHours({ ...quietHours, enabled: v })} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} />
            </View>
            <Body>Non-urgent Growling notifications and in-app nudges stay silent in this window. Barking and Biting alerts always come through.</Body>
            {quietHours.enabled ? (
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <TimeStepper testID="settings-quiet-start" label="From" minutes={quietHours.start_minutes} onChange={(m) => void setQuietHours({ ...quietHours, start_minutes: m })} />
                <TimeStepper testID="settings-quiet-end" label="Until" minutes={quietHours.end_minutes} onChange={(m) => void setQuietHours({ ...quietHours, end_minutes: m })} />
              </View>
            ) : null}
            {quietHours.enabled ? <Pill tone={quietNow ? "unknown" : "resting"} label={quietNow ? "Quiet hours active now" : "Outside quiet hours"} testID="settings-quiet-now" /> : null}
          </Card>
        </View>

        <View>
          <SectionTitle>Battery</SectionTitle>
          <Card style={{ gap: spacing.sm }} testID="settings-battery">
            <View style={s.row}>
              <Text style={s.label}>Battery saver</Text>
              <Switch testID="settings-lowpower-switch" value={lowPower} onValueChange={(v) => void setLowPower(v)} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} />
            </View>
            <Body>Pauses Apollo&apos;s animations and checks status less often while the app is open. Protection is unaffected — Apollo keeps guarding in the background, so you can minimise the app whenever you like.</Body>
            <Button testID="settings-minimise" variant="secondary" label="Minimise Apollo now" onPress={() => void minimiseApp(showToast)} />
          </Card>
        </View>

        <View>
          <SectionTitle>Family sharing</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Body>Send plain-language Barking and Biting alerts to a trusted family member by email, or pair their Apollo device.</Body>
            <Button testID="settings-family" variant="secondary" label="Manage family sharing" onPress={() => router.push("/family")} />
          </Card>
        </View>

        <View>
          <SectionTitle>Launch gates</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Body>Run the labelled threat corpus and clean set against Apollo&apos;s engine to check the ≥90% detection and &lt;2% false-positive gates.</Body>
            <Button testID="settings-benchmark" variant="secondary" label="Run threat benchmark" onPress={() => router.push("/benchmark")} />
          </Card>
        </View>

        <View>
          <SectionTitle>Intelligence sources</SectionTitle>
          <Card testID="settings-intel">
            <View style={s.row}>
              <Text style={s.label}>Google Safe Browsing</Text>
              <Pill tone={intel.isLoading ? "neutral" : sbTone} label={intel.isLoading ? "Checking…" : sb?.status === "ok" ? "Connected" : sb?.status === "not_configured" ? "Not configured" : "Unavailable"} testID="settings-sb-status" />
            </View>
            <Body>{sb?.detail ?? "Checks the link itself against Google's threat lists."}</Body>
            <View style={[s.row, { marginTop: spacing.sm }]}>
              <Text style={s.label}>Apollo managed threat list</Text>
              <Pill tone="resting" label={`${intel.data?.blocklist.entries ?? "—"} entries`} testID="settings-blocklist-status" />
            </View>
          </Card>
        </View>

        <View>
          <SectionTitle>Trusted items ({trust.length})</SectionTitle>
          <Card testID="settings-trust">
            {trust.length === 0 ? <Body>Nothing trusted. Trust only ever applies to one exact link and never overrides a confirmed threat.</Body> : trust.map((t) => (
              <View key={t.trust_id} style={s.trustRow} testID={`settings-trust-${t.trust_id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{t.indicator_host}</Text>
                  <Body>Exact link · {new Date(t.created_at).toLocaleDateString()}</Body>
                </View>
                <Button testID={`settings-revoke-${t.trust_id}`} variant="secondary" label="Revoke" onPress={() => revokeTrust(t)} />
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>Data</SectionTitle>
          <Card style={{ gap: spacing.md }}>
            <Body>Patrol events are stored on this device and synced as summaries (domain only). Clearing marks synced copies as deleted.</Body>
            <Button testID="settings-clear-patrol" variant="secondary" label="Clear Patrol history" onPress={() => setConfirmClear(true)} />
          </Card>
        </View>

        <View>
          <SectionTitle>About this build</SectionTitle>
          <Card style={{ gap: spacing.sm }} testID="settings-build">
            <View style={s.row}><Text style={s.label}>Environment</Text><Pill tone={APP_ENV === "production" ? "resting" : "growling"} label={APP_ENV} testID="settings-app-env" /></View>
            <View style={s.row}><Text style={s.label}>Security adapter</Text><Pill tone={isMock ? "unknown" : "resting"} label={adapterLabel} /></View>
            <View style={s.row}><Text style={s.label}>SecureCore</Text><Pill tone={IS_MOCK_SECURECORE ? "unknown" : "resting"} label={IS_MOCK_SECURECORE ? "MOCK" : "Native"} /></View>
            <Body>{SECURECORE_LABEL}</Body>
            {isMock ? <Button testID="settings-dev-tools" variant="secondary" label="Developer tools (mock scenarios)" onPress={() => router.push("/dev-tools")} /> : null}
          </Card>
        </View>
        <Text style={s.footer}>Apollo V1 · Australia-first · No account, no tracking</Text>
      </ScrollView>

      <Sheet visible={confirmClear} onClose={() => setConfirmClear(false)} title="Clear Patrol history?" testID="clear-sheet">
        <Body>This removes all events from this device and marks synced summaries as deleted. Trust entries are kept.</Body>
        <Button testID="clear-confirm" variant="danger" label="Clear history" onPress={() => { setConfirmClear(false); void clearPatrol(); }} />
        <Button testID="clear-cancel" variant="ghost" label="Keep it" onPress={() => setConfirmClear(false)} />
      </Sheet>
    </View>
  );
}
