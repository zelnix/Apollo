import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Globe from "lucide-react-native/icons/globe";
import KeyRound from "lucide-react-native/icons/key-round";
import Link2 from "lucide-react-native/icons/link-2";
import MessageSquareWarning from "lucide-react-native/icons/message-square-warning";
import Radar from "lucide-react-native/icons/radar";
import Share2 from "lucide-react-native/icons/share-2";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import Wifi from "lucide-react-native/icons/wifi";
import React, { useState } from "react";
import { Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBackendHealth } from "@/src/api/backendHealth";
import { ServiceBanner } from "@/src/components/ServiceBanner";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, DevTag, Pill, ScreenHeader, SectionTitle, capabilityTone } from "@/src/components/ui";
import { CAPABILITY_STATUS_LABEL } from "@/src/domain/capability";
import { assessConnection } from "@/src/domain/connection";
import { masterCopy } from "@/src/domain/protectionTruth";
import type { Capability } from "@/src/domain/types";
import type { ProtectionPermission } from "@/src/security/SecurityPlatformAdapter";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

/** One small icon per capability, matched to what it actually watches — never a generic shield for everything. */
const CAP_ICON: Record<Capability["id"], React.ComponentType<{ size?: number; color?: string }>> = {
  link_guard: Link2,
  known_threats: Radar,
  site_guard: Globe,
  connection_guard: Wifi,
  share_intake: Share2,
  message_guard: MessageSquareWarning,
  app_guard: Smartphone,
};

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  masterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.lg },
  masterTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  masterTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.brand },
  capCard: { gap: spacing.sm, marginBottom: spacing.md },
  guardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  guardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  capTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  capTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.brand },
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
  // Plus one from the network layer: is the security service reachable (online checks) — local enforcement is unaffected.
  const health = useBackendHealth();
  const { title: masterTitle, line: masterLine, requested, operational } = masterCopy(protection, health.reachable !== false);

  const ask = async (perm: ProtectionPermission) => {
    setSheet(null);
    if (needsSettings(perm)) { void Linking.openSettings(); return; }
    const result = await requestPermission(perm.id);
    showToast(result.status === "granted" ? `${perm.title} permission granted` : `${perm.title} permission not granted`, result.status === "granted" ? "resting" : "barking");
  };

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <ScreenHeader title="Guard" testID="guard-header" right={isMock ? <DevTag label="Mock" /> : null} />
      </View>
      <ScrollView contentContainerStyle={s.content} testID="guard-scroll">
        <ServiceBanner />
        <Card testID="guard-master-card" style={{ gap: spacing.sm }}>
          <View style={s.masterRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={s.masterTitleRow}>
                <View style={s.iconWell}><ShieldCheck size={18} color={colors.brand} /></View>
                <Text style={s.masterTitle} testID="guard-master-title">{masterTitle}</Text>
              </View>
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
              <View style={s.guardTitleRow}>
                <View style={s.iconWell}><Wifi size={16} color={colors.brand} /></View>
                <Text style={s.capTitle}>Network Guard</Text>
              </View>
              <Pill tone={netCap ? capabilityTone(netCap.status) : "unknown"} label={netCap ? CAPABILITY_STATUS_LABEL[netCap.status] : "Unknown"} testID="guard-network-status" />
            </View>
            <Body testID="guard-network-summary">{!requested ? "Protection is off — Apollo isn't watching connections." : `${connectionSummary} ${netOpen ? `${netOpen} unresolved network item${netOpen > 1 ? "s" : ""}.` : "No unresolved network issues."}`}</Body>
            <Button testID="guard-open-network" variant="secondary" label="Open Network Guard" onPress={() => router.push("/network")} />
          </Card>
          <Card style={s.capCard} testID="guard-account-card">
            <View style={s.guardRow}>
              <View style={s.guardTitleRow}>
                <View style={s.iconWell}><KeyRound size={16} color={colors.brand} /></View>
                <Text style={s.capTitle}>Account Guard</Text>
              </View>
              <Pill tone={accountOpen.some((e) => e.state === "barking") ? "barking" : accountOpen.length ? "growling" : "resting"} label={accountOpen.length ? `${accountOpen.length} need${accountOpen.length > 1 ? "" : "s"} attention` : "All good"} testID="guard-account-status" />
            </View>
            <Body testID="guard-account-summary">{accountOpen.length ? accountOpen.slice(0, 2).map((e) => e.headline.replace(/^Account: /, "")).join(" · ") : "No unresolved account-security issues. Check any login, MFA or password-reset alert you're unsure about."}</Body>
            <Button testID="guard-open-account" variant="secondary" label="Open Account Guard" onPress={() => router.push("/account")} />
          </Card>
        </View>

        <View>
          <SectionTitle>Capabilities</SectionTitle>
          {capabilities.map((cap) => {
            const CapIcon = CAP_ICON[cap.id];
            const actionable = cap.status === "permission_required";
            return (
              <Card key={cap.id} style={s.capCard} testID={`guard-cap-${cap.id}`}>
                <Pressable disabled={!actionable} onPress={() => setSheet({ kind: "cap", cap })} testID={`guard-cap-${cap.id}-press`} accessibilityRole={actionable ? "button" : undefined} style={s.capTop}>
                  <View style={s.iconWell}><CapIcon size={18} color={colors.brand} /></View>
                  <Text style={[s.capTitle, { flex: 1 }]}>{cap.title}</Text>
                  <Pill tone={capabilityTone(cap.status)} label={CAPABILITY_STATUS_LABEL[cap.status]} testID={`guard-cap-${cap.id}-status`} />
                  {actionable ? <ChevronRight size={18} color={colors.onSurfaceSecondary} /> : null}
                </Pressable>
                <Body>{cap.detail}</Body>
                {actionable ? (
                  <Button testID={`guard-cap-${cap.id}-fix`} variant="secondary" label="What's needed" onPress={() => setSheet({ kind: "cap", cap })} />
                ) : null}
              </Card>
            );
          })}
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
