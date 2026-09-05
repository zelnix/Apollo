import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, ScreenHeader, SectionTitle } from "@/src/components/ui";
import { PRIVACY_POLICY_SUMMARY } from "@/src/domain/privacy";
import { SECURECORE_LABEL, IS_MOCK_SECURECORE } from "@/src/security/securecore/SecureCore";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing } from "@/src/theme";

interface IntelStatus { safe_browsing: { status: string; detail: string }; blocklist: { status: string; entries: number } }

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
  const { deviceId, trust, revokeTrust, clearPatrol, adapterLabel, isMock } = useApollo();
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
