/**
 * Device Protections — the landing page for the "Device Protections" card on Home.
 *
 * Exception-first: what needs attention, then what Apollo can't read and the person should check,
 * then everything already as recommended — folded under "Protected (N)". Every state comes from a
 * real read; an unreadable setting stays "Check manually" and is never marked safe or unsafe. A
 * protection that belongs to the device stays attributed to Android / Apple / its maker / the carrier.
 *
 * The device CHECK itself lives at /device.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Device from "expo-device";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Smartphone from "lucide-react-native/icons/smartphone";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppMenuButton } from "@/src/components/AppMenu";
import { AlertsButton } from "@/src/components/AlertsButton";
import { CapabilityTables } from "@/src/components/device/CapabilityTable";
import { ProtectionGroup, ProtectionListRow, healthRowTone } from "@/src/components/ProtectionList";
import { Body, Pill, type Tone } from "@/src/components/ui";
import { allCapabilityRows, type DeviceProtectionRow } from "@/src/domain/deviceCapabilities";
import { PROTECTION_AREA_LABEL, PROTECTION_AREA_ORDER, groupDeviceProtections, type DeviceProtectionsOverall } from "@/src/domain/deviceProtectionTypes";
import { whatToDoNow } from "@/src/domain/deviceProtectionChanges";
import { assessDeviceProtections, useDeviceProtections } from "@/src/store/deviceProtectionStore";
import { goBackOrHome } from "@/src/utils/navigation";
import { useDeviceModelName } from "@/src/telemetry/deviceModelName";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, flex: 1 },

  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.xl },

  deviceCard: { borderRadius: radius.lg, padding: spacing.lg, backgroundColor: c.surfaceSecondary, borderWidth: 0.5, borderColor: c.border, gap: spacing.md },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  deviceIconWrap: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: c.goldTint, alignItems: "center", justifyContent: "center" },
  deviceInfo: { flex: 1, gap: 2 },
  deviceName: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  deviceOs: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  headline: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 21, color: c.onSurface },
  detail: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  readRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, borderTopWidth: 0.5, borderTopColor: c.divider, paddingTop: spacing.sm },
  readText: { fontFamily: fonts.text, fontSize: 12, color: c.muted, flex: 1 },
  readAction: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brandPrimary },

  loading: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["2xl"] },
  calm: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
}));

const OVERALL_PILL: Record<DeviceProtectionsOverall, { tone: Tone; label: string }> = {
  action: { tone: "biting", label: "Needs attention" },
  review: { tone: "growling", label: "Review" },
  check: { tone: "ears_up", label: "Check manually" },
  protected: { tone: "resting", label: "Protected" },
  unread: { tone: "unknown", label: "Not checked" },
};

function readLabel(iso: string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function DeviceProtectionsScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const assessment = useDeviceProtections();
  const [rechecking, setRechecking] = useState(false);
  // Opened from a category on the Protection screen: only that category's protections are listed.
  const params = useLocalSearchParams<{ area?: string }>();
  const area = PROTECTION_AREA_ORDER.find((a) => a === params.area) ?? null;

  const recheck = useCallback(() => {
    setRechecking(true);
    void assessDeviceProtections(true).catch(() => undefined).finally(() => setRechecking(false));
  }, []);

  // The descriptive name ("Samsung Galaxy Z Fold6"); the model code it reports goes beside the system.
  const device = useDeviceModelName();
  const deviceModel = device.name || Device.deviceName || "This device";
  const osLabel = Platform.OS === "android" ? `Android ${Device.osVersion || ""}`.trim() : Platform.OS === "ios" ? `iOS ${Device.osVersion || ""}`.trim() : "Browser preview";
  const maker = device.code ?? (Device.manufacturer || (Platform.OS === "ios" ? "Apple" : ""));

  const changed = new Set(assessment?.unseen.map((c) => c.protectionId) ?? []);
  const open = (id: string) => router.push({ pathname: "/capability/[id]", params: { id } });
  // Attention rows show what is wrong; everything else shows what the protection covers.
  const rows = (list: DeviceProtectionRow[], prefix: string, showDetail = false) => list.map((row, i) => (
    <ProtectionListRow
      key={row.id}
      first={i === 0}
      title={row.title}
      subtitle={showDetail ? row.detail : row.subtitle}
      statusLabel={row.stateLabel}
      tone={healthRowTone(row.health)}
      changed={changed.has(row.id)}
      onPress={() => open(row.id)}
      testID={`${prefix}-${i}`}
    />
  ));

  const inArea = <T extends { area: string }>(list: T[]) => (area ? list.filter((r) => r.area === area) : list);
  const deviceRows = assessment ? inArea(assessment.reading.view.deviceProtects) : [];
  const areaIds = new Set(deviceRows.map((r) => r.id));
  const unseen = (assessment?.unseen ?? []).filter((c) => !area || areaIds.has(c.protectionId));
  const groups = assessment ? (area ? groupDeviceProtections(deviceRows) : assessment.groups) : undefined;
  const summary = assessment?.summary;
  const capabilities = assessment ? inArea(allCapabilityRows(assessment.reading.view)) : [];
  const onDevice = assessment?.reading.hasNativeHost ?? Platform.OS !== "web";
  const pill = OVERALL_PILL[summary?.overall ?? "unread"];

  return (
    <View style={s.root} testID="device-protection-screen">
      <View style={{ paddingTop: insets.top }}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="device-prot-back" onPress={() => goBackOrHome(router)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1} testID="device-prot-title">{area ? PROTECTION_AREA_LABEL[area] : "Device Protections"}</Text>
          <AlertsButton testID="device-prot-alerts" />
          <AppMenuButton testID="device-prot-menu" />
        </View>
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingTop: spacing.sm }]} showsVerticalScrollIndicator={false} testID="device-prot-scroll">
        {/* ── This device, and the one-line answer ── */}
        <View style={s.deviceCard} testID="device-prot-info">
          <View style={s.deviceRow}>
            <View style={s.deviceIconWrap}><Smartphone size={26} color={colors.gold} /></View>
            <View style={s.deviceInfo}>
              <Text style={s.deviceName} numberOfLines={2} testID="device-prot-name">{deviceModel}</Text>
              <Text style={s.deviceOs}>{[maker, osLabel].filter(Boolean).join(" · ")}</Text>
            </View>
            <Pill tone={pill.tone} label={pill.label} compact testID="device-prot-status" />
          </View>
          {summary ? (
            <View style={{ gap: 2 }}>
              <Text style={s.headline} testID="device-prot-headline">{summary.headline}</Text>
              {summary.detail ? <Text style={s.detail} testID="device-prot-summary">{summary.detail}</Text> : null}
            </View>
          ) : null}
          {assessment && onDevice ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Check these settings again"
              onPress={recheck}
              disabled={rechecking}
              style={s.readRow}
              testID="device-prot-recheck"
            >
              <Text style={s.readText}>Apollo read these settings {readLabel(assessment.assessedAt)}</Text>
              {rechecking ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <RefreshCw size={14} color={colors.brandPrimary} />}
              <Text style={s.readAction}>Check again</Text>
            </Pressable>
          ) : null}
        </View>

        {!assessment || !groups ? (
          <View style={s.loading} testID="device-prot-loading">
            <ActivityIndicator color={colors.brandPrimary} />
            <Body>Reading this device…</Body>
          </View>
        ) : !onDevice ? (
          <ProtectionGroup
            title="What Apollo checks on a device"
            intro="ApolloSG is open in a browser preview, so it can’t read this device’s settings. Each protection below still shows what it is and how to check it."
            count={deviceRows.length}
            collapsible
            testID="device-prot-catalogue"
          >
            {rows(deviceRows, "device-prot-catalogue-row")}
          </ProtectionGroup>
        ) : (
          <>
            {unseen.length ? (
              <ProtectionGroup title="Changed since you last looked" count={unseen.length} testID="device-prot-changes">
                {unseen.map((change, i) => (
                  <ProtectionListRow
                    key={change.id}
                    first={i === 0}
                    title={change.title}
                    subtitle={change.text}
                    higgins={whatToDoNow(change)}
                    statusLabel={change.direction === "worse" ? "Changed" : "Improved"}
                    tone={change.direction === "worse" ? "attention" : "protected"}
                    onPress={() => open(change.protectionId)}
                    testID={`device-prot-change-${i}`}
                  />
                ))}
              </ProtectionGroup>
            ) : null}

            {groups.needsAttention.length ? (
              <ProtectionGroup title="Needs attention" intro="Apollo read these settings and they aren’t set the way Higgins recommends." count={groups.needsAttention.length} testID="device-prot-attention">
                {rows(groups.needsAttention, "device-prot-attention-row", true)}
              </ProtectionGroup>
            ) : null}

            {groups.needsChecking.length ? (
              <ProtectionGroup title="Needs checking" intro="Apollo can’t read these on this device, so they’re never marked safe or unsafe. Each one shows how to check it yourself." count={groups.needsChecking.length} testID="device-prot-checking">
                {rows(groups.needsChecking, "device-prot-checking-row")}
              </ProtectionGroup>
            ) : null}

            {!groups.needsAttention.length && !groups.needsChecking.length ? (
              <Text style={s.calm} testID="device-prot-calm">Nothing needs you right now. Everything Apollo could read is set as recommended.</Text>
            ) : null}

            {groups.protectedRows.length ? (
              <ProtectionGroup title="Protected" count={groups.protectedRows.length} collapsible testID="device-prot-protected">
                {rows(groups.protectedRows, "device-prot-protected-row")}
              </ProtectionGroup>
            ) : null}

            {groups.optional.length ? (
              <ProtectionGroup title="Optional" intro="Worth it for some people, not for everyone." count={groups.optional.length} collapsible testID="device-prot-optional">
                {rows(groups.optional, "device-prot-optional-row")}
              </ProtectionGroup>
            ) : null}

            {groups.notAvailable.length ? (
              <ProtectionGroup title="Not on this device" count={groups.notAvailable.length} collapsible testID="device-prot-unavailable">
                {rows(groups.notAvailable, "device-prot-unavailable-row")}
              </ProtectionGroup>
            ) : null}
          </>
        )}

        {capabilities.length ? (
          <ProtectionGroup title="What ApolloSG can use here" intro="ApolloSG’s own access on this device, as a real read reported it." count={capabilities.length} collapsible bare testID="device-prot-capabilities">
            <CapabilityTables capabilities={capabilities} testID="device-prot-table" />
          </ProtectionGroup>
        ) : null}
      </ScrollView>
    </View>
  );
}
