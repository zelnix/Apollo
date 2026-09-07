import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, ScreenHeader, SectionTitle, capabilityTone } from "@/src/components/ui";
import { CAPABILITY_STATUS_LABEL } from "@/src/domain/capability";
import { assessConnection } from "@/src/domain/connection";
import { masterCopy } from "@/src/domain/protectionTruth";
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
  guardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
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
  const { capabilities, protection, permissions, network, events, toggleProtection, requestPermission, isMock, showToast, trustedSsids, trustNetwork, forgetNetwork } = useApollo();
  const [busy, setBusy] = useState(false);
  const netCap = capabilities.find((c) => c.id === "connection_guard");
  const connectionSummary = assessConnection(network, trustedSsids).summary;
  const netOpen = events.filter((e) => e.category === "connection" && e.status === "active" && e.state !== "resting").length;
  const accountOpen = events.filter((e) => e.category === "account" && e.status === "active" && e.state !== "resting");
  // One sheet, two views. Closing one Modal and opening another in the same tick fails on iOS/Android
  // (the second never presents), so capability → permission switches content inside the same Modal.
  const [sheet, setSheet] = useState<{ kind: "cap"; cap: Capability } | { kind: "perm"; perm: ProtectionPermission } | null>(null);
  const explain = sheet?.kind === "perm" ? sheet.perm : null;
  const selected = sheet?.kind === "cap" ? sheet.cap : null;
  const needsSettings = (p: ProtectionPermission) => p.status === "blocked" || (p.status === "denied" && !p.canAskAgain);

  const onToggle = async (on: boolean) => { setBusy(true); try { await toggleProtection(on); } finally { setBusy(false); } };

  // Three facts from the security layer, reported — never inferred here: requested, operational, verified.
  const { title: masterTitle, line: masterLine, requested, operational } = masterCopy(protection);

  const ask = async (perm: ProtectionPermission) => {
    setSheet(null);
    if (needsSettings(perm)) { void Linking.openSettings(); return; }
    const result = await requestPermission(perm.id);
    showToast(result.status === "granted" ? `${perm.title} permission granted` : `${perm.title} permission not granted`, result.status === "granted" ? "resting" : "barking");
  };

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <ScreenHeader title="Guard" testID="guard-header" right={isMock ? <Pill tone="unknown" label="Mock" /> : null} />
      </View>
      <ScrollView contentContainerStyle={s.content} testID="guard-scroll">
        <Card testID="guard-master-card" style={{ gap: spacing.sm }}>
          <View style={s.masterRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.masterTitle} testID="guard-master-title">{masterTitle}</Text>
              <Body testID="guard-master-line">{masterLine}</Body>
            </View>
            <Switch testID="guard-protection-switch" value={requested} onValueChange={onToggle} disabled={busy} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} />
          </View>
          {requested ? (
            <View style={{ gap: 4 }} testID="guard-master-truth">
              <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                <Pill tone="neutral" label="Requested: on" testID="guard-truth-requested" />
                <Pill tone={operational ? "resting" : "growling"} label={operational ? "Enforcement: active" : "Enforcement: not active"} testID="guard-truth-operational" />
                <Pill tone={operational ? "resting" : "unknown"} label={protection?.lastVerified ? `Verified ${new Date(protection.lastVerified).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not yet verified"} testID="guard-truth-verified" />
              </View>
              <Body testID="guard-master-coverage">{protection?.coverage}</Body>
              {protection?.degradedReason ? <Body testID="guard-master-degraded">{protection.degradedReason}</Body> : null}
            </View>
          ) : null}
        </Card>

        <View>
          <SectionTitle>Network & Accounts</SectionTitle>
          <Card style={s.capCard} testID="guard-network-card">
            <View style={s.guardRow}>
              <Text style={s.capTitle}>Network Guard</Text>
              <Pill tone={netCap ? capabilityTone(netCap.status) : "unknown"} label={netCap ? CAPABILITY_STATUS_LABEL[netCap.status] : "Unknown"} testID="guard-network-status" />
            </View>
            <Body testID="guard-network-summary">{!requested ? "Protection is off — Apollo isn't watching connections." : `${connectionSummary} ${netOpen ? `${netOpen} unresolved network item${netOpen > 1 ? "s" : ""}.` : "No unresolved network issues."}`}</Body>
            <Button testID="guard-open-network" variant="secondary" label="Open Network Guard" onPress={() => router.push("/network")} />
          </Card>
          <Card style={s.capCard} testID="guard-account-card">
            <View style={s.guardRow}>
              <Text style={s.capTitle}>Account Guard</Text>
              <Pill tone={accountOpen.some((e) => e.state === "barking") ? "barking" : accountOpen.length ? "growling" : "resting"} label={accountOpen.length ? `${accountOpen.length} need${accountOpen.length > 1 ? "" : "s"} attention` : "All good"} testID="guard-account-status" />
            </View>
            <Body testID="guard-account-summary">{accountOpen.length ? accountOpen.slice(0, 2).map((e) => e.headline.replace(/^Account: /, "")).join(" · ") : "No unresolved account-security issues. Check any login, MFA or password-reset alert you're unsure about."}</Body>
            <Button testID="guard-open-account" variant="secondary" label="Open Account Guard" onPress={() => router.push("/account")} />
          </Card>
        </View>

        <View>
          <SectionTitle>Capabilities</SectionTitle>
          {capabilities.map((cap) => (
            <Card key={cap.id} style={s.capCard} testID={`guard-cap-${cap.id}`}>
              <Pressable disabled={cap.status !== "permission_required"} onPress={() => setSheet({ kind: "cap", cap })} testID={`guard-cap-${cap.id}-press`} accessibilityRole={cap.status === "permission_required" ? "button" : undefined} style={s.capTop}>
                <Text style={s.capTitle}>{cap.title}</Text>
                <Pill tone={capabilityTone(cap.status)} label={CAPABILITY_STATUS_LABEL[cap.status]} testID={`guard-cap-${cap.id}-status`} />
              </Pressable>
              <Body>{cap.detail}</Body>
              {cap.status === "permission_required" ? (
                <Button testID={`guard-cap-${cap.id}-fix`} variant="secondary" label="What's needed" onPress={() => setSheet({ kind: "cap", cap })} />
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
                  <Button testID={`guard-perm-${p.id}-request`} variant={p.status === "blocked" ? "warning" : "secondary"} label={needsSettings(p) ? "Open Settings" : "Allow"} onPress={() => setSheet({ kind: "perm", perm: p })} />
                )}
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>Connection</SectionTitle>
          <Card testID="guard-network">
            <Text style={s.netLine}>{network ? (network.connected ? `Connected via ${network.type}${network.ssid ? ` · ${network.ssid}` : ""}` : "Not connected") : "Checking…"}</Text>
            <Body>{assessConnection(network, trustedSsids).summary}</Body>
            {network?.type === "wifi" ? <Pill tone={trustedSsids.includes(network.ssid ?? "") ? "resting" : network.wifiSecurity === "open" || network.wifiSecurity === "wep" || network.captivePortal ? "growling" : network.wifiSecurity === "unknown" ? "unknown" : "resting"} label={trustedSsids.includes(network.ssid ?? "") ? "Trusted network" : network.captivePortal ? "Captive portal" : network.wifiSecurity === "n/a" ? "Wi‑Fi" : `Wi‑Fi: ${network.wifiSecurity}`} testID="guard-wifi-pill" /> : null}
            {network?.type === "wifi" && network.ssid ? (
              trustedSsids.includes(network.ssid)
                ? <Button testID="guard-forget-network" variant="ghost" label="Forget this network" onPress={() => forgetNetwork(network.ssid!)} style={{ marginTop: spacing.sm }} />
                : <Button testID="guard-trust-network" variant="secondary" label="Trust this network (home / work)" onPress={() => trustNetwork(network.ssid!)} style={{ marginTop: spacing.sm }} />
            ) : null}
            {trustedSsids.length ? <Body style={{ marginTop: spacing.sm }}>Trusted networks: {trustedSsids.join(", ")}</Body> : null}
          </Card>
        </View>

        <Button testID="guard-check-link" label="Check a link" onPress={() => router.push("/check")} />
      </ScrollView>

      <Sheet visible={!!sheet} onClose={() => setSheet(null)} title={explain?.title ?? selected?.title ?? ""} testID={explain ? "permission-sheet" : "capability-sheet"}>
        {explain ? (
          <>
            <Body>{explain.why}</Body>
            <Body>{needsSettings(explain) ? "This permission was declined before. You can enable it in your device settings." : "Apollo only asks when you choose to enable a protection. You can change this any time."}</Body>
            <Button testID="permission-sheet-continue" label={needsSettings(explain) ? "Open Settings" : "Continue"} onPress={() => void ask(explain)} />
            <Button testID="permission-sheet-cancel" variant="ghost" label="Not now" onPress={() => setSheet(null)} />
          </>
        ) : selected ? (
          <>
            <Body>{selected.detail}</Body>
            <Body>Grant the permission below to enable this protection. Until then, Apollo shows it as not active.</Body>
            {permissions.filter((p) => p.status !== "granted" && p.status !== "not_applicable").map((p) => (
              <Button key={p.id} testID={`capability-sheet-perm-${p.id}`} label={needsSettings(p) ? `Open Settings for ${p.title}` : `Allow ${p.title}`} onPress={() => setSheet({ kind: "perm", perm: p })} />
            ))}
            <Button testID="capability-sheet-close" variant="ghost" label="Close" onPress={() => setSheet(null)} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
