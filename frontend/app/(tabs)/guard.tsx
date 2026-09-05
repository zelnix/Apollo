import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Linking, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, ScreenHeader, SectionTitle, capabilityTone } from "@/src/components/ui";
import { CAPABILITY_STATUS_LABEL } from "@/src/domain/capability";
import { assessConnection } from "@/src/domain/connection";
import type { Capability } from "@/src/domain/types";
import type { ProtectionPermission } from "@/src/security/SecurityPlatformAdapter";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  masterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.lg },
  masterTitle: { fontFamily: fonts.display, fontSize: 18, color: c.onSurface },
  capCard: { gap: spacing.sm, marginBottom: spacing.md },
  capTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  capTitle: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface, flex: 1 },
  permRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  permTitle: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface },
  netLine: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface },
}));

const PERMISSION_TONE: Record<ProtectionPermission["status"], "resting" | "growling" | "barking" | "unknown" | "neutral"> = { granted: "resting", undetermined: "neutral", denied: "growling", blocked: "barking", not_applicable: "unknown" };

export default function Guard() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { capabilities, protection, permissions, network, toggleProtection, requestPermission, adapterLabel, isMock, showToast } = useApollo();
  const [busy, setBusy] = useState(false);
  const [explain, setExplain] = useState<ProtectionPermission | null>(null);
  const [selected, setSelected] = useState<Capability | null>(null);

  const onToggle = async (on: boolean) => { setBusy(true); try { await toggleProtection(on); } finally { setBusy(false); } };

  const ask = async (perm: ProtectionPermission) => {
    setExplain(null);
    if (perm.status === "blocked" || (perm.status === "denied" && !perm.canAskAgain)) { void Linking.openSettings(); return; }
    const result = await requestPermission(perm.id);
    showToast(result.status === "granted" ? `${perm.title} permission granted` : `${perm.title} permission not granted`, result.status === "granted" ? "resting" : "growling");
  };

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <ScreenHeader title="Guard" testID="guard-header" right={isMock ? <Pill tone="unknown" label="Mock" /> : null} />
      </View>
      <ScrollView contentContainerStyle={s.content} testID="guard-scroll">
        <Card testID="guard-master-card">
          <View style={s.masterRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.masterTitle}>{protection?.running ? "Protection is on" : "Protection is off"}</Text>
              <Body>{protection?.running ? `Apollo is watching within its active checks. Adapter: ${adapterLabel}.` : "Apollo cannot see anything while protection is off."}</Body>
            </View>
            <Switch testID="guard-protection-switch" value={!!protection?.running} onValueChange={onToggle} disabled={busy} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} />
          </View>
        </Card>

        <View>
          <SectionTitle>Capabilities</SectionTitle>
          {capabilities.map((cap) => (
            <Card key={cap.id} style={s.capCard} testID={`guard-cap-${cap.id}`}>
              <View style={s.capTop}>
                <Text style={s.capTitle}>{cap.title}</Text>
                <Pill tone={capabilityTone(cap.status)} label={CAPABILITY_STATUS_LABEL[cap.status]} testID={`guard-cap-${cap.id}-status`} />
              </View>
              <Body>{cap.detail}</Body>
              {cap.status === "permission_required" ? (
                <Button testID={`guard-cap-${cap.id}-fix`} variant="secondary" label="What's needed" onPress={() => setSelected(cap)} />
              ) : null}
            </Card>
          ))}
        </View>

        <View>
          <SectionTitle>Permissions</SectionTitle>
          <Card testID="guard-permissions">
            {permissions.map((p) => (
              <View key={p.id} style={s.permRow} testID={`guard-perm-${p.id}`}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.permTitle}>{p.title}</Text>
                  <Body>{p.why}</Body>
                </View>
                {p.status === "granted" || p.status === "not_applicable" ? (
                  <Pill tone={PERMISSION_TONE[p.status]} label={p.status === "granted" ? "Granted" : "N/A"} />
                ) : (
                  <Button testID={`guard-perm-${p.id}-request`} variant={p.status === "blocked" ? "warning" : "secondary"} label={p.status === "blocked" || (p.status === "denied" && !p.canAskAgain) ? "Open Settings" : "Allow"} onPress={() => setExplain(p)} />
                )}
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>Connection</SectionTitle>
          <Card testID="guard-network">
            <Text style={s.netLine}>{network ? (network.connected ? `Connected via ${network.type}` : "Not connected") : "Checking…"}</Text>
            <Body>{assessConnection(network).summary}</Body>
            {network?.type === "wifi" ? <Pill tone={network.wifiSecurity === "open" || network.wifiSecurity === "wep" || network.captivePortal ? "growling" : network.wifiSecurity === "unknown" ? "unknown" : "resting"} label={network.captivePortal ? "Captive portal" : network.wifiSecurity === "n/a" ? "Wi‑Fi" : `Wi‑Fi: ${network.wifiSecurity}`} testID="guard-wifi-pill" /> : null}
          </Card>
        </View>

        <Button testID="guard-check-link" label="Check a link" onPress={() => router.push("/check")} />
      </ScrollView>

      <Sheet visible={!!explain} onClose={() => setExplain(null)} title={explain?.title ?? ""} testID="permission-sheet">
        <Body>{explain?.why}</Body>
        <Body>{explain?.status === "blocked" || (explain?.status === "denied" && !explain?.canAskAgain) ? "This permission was declined before. You can enable it in your device settings." : "Apollo only asks when you choose to enable a protection. You can change this any time."}</Body>
        {explain ? <Button testID="permission-sheet-continue" label={explain.status === "blocked" || (explain.status === "denied" && !explain.canAskAgain) ? "Open Settings" : "Continue"} onPress={() => ask(explain)} /> : null}
        <Button testID="permission-sheet-cancel" variant="ghost" label="Not now" onPress={() => setExplain(null)} />
      </Sheet>

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected?.title ?? ""} testID="capability-sheet">
        <Body>{selected?.detail}</Body>
        <Body>Grant the permission below to enable this protection. Until then, Apollo shows it as not active.</Body>
        {permissions.filter((p) => p.status !== "granted" && p.status !== "not_applicable").map((p) => (
          <Button key={p.id} testID={`capability-sheet-perm-${p.id}`} label={`Allow ${p.title}`} onPress={() => { setSelected(null); setExplain(p); }} />
        ))}
        <Button testID="capability-sheet-close" variant="ghost" label="Close" onPress={() => setSelected(null)} />
      </Sheet>
    </View>
  );
}
