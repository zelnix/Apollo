/**
 * Device Capabilities — the landing page for the "Device" card on Home.
 *
 * It answers the person's four questions in their order, and nothing more:
 *   What does my device already protect?  →  What can Apollo use?
 *   →  What can Apollo NOT access?        →  What else can I turn on?
 *
 * Every line here comes from a real read. A read that failed says so. A native protection stays
 * attributed to Samsung / Google / your carrier / Apple — never presented as an Apollo detection.
 * Apollo never claims a native setting is on or off when it cannot read it.
 *
 * The device CHECK itself lives at /device. This screen links to it and shows its history.
 */
import { useRouter } from "expo-router";
import * as Device from "expo-device";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Smartphone from "lucide-react-native/icons/smartphone";
import Share2 from "lucide-react-native/icons/share-2";
import Clock from "lucide-react-native/icons/clock";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AlertsButton } from "@/src/components/AlertsButton";
import { DeviceAreaTables } from "@/src/components/device/CapabilityTable";
import { Body, Pill } from "@/src/components/ui";
import { useApollo } from "@/src/store/ApolloContext";
import { getCheckHistory, type CheckHistoryEntry } from "@/src/store/checkHistoryStore";
import { allCapabilityRows, type CapabilityRow, type DeviceCapabilityView } from "@/src/domain/deviceCapabilities";
import { capabilityPlatform, readDeviceCapabilityState } from "@/src/security/deviceCapabilityState";
import { shareDeviceCapabilityReport } from "@/src/utils/shareDeviceCapabilityReport";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, flex: 1 },

  lastCheck: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: 2,
    borderBottomWidth: 0.5, borderBottomColor: c.divider, marginBottom: spacing.lg,
  },
  lastCheckTitle: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },

  deviceCard: {
    marginHorizontal: spacing.lg, borderRadius: radius.lg, padding: spacing.lg,
    backgroundColor: c.surfaceSecondary, borderWidth: 0.5, borderColor: c.border, gap: spacing.md,
  },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  deviceIconWrap: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: c.goldTint, alignItems: "center", justifyContent: "center" },
  deviceInfo: { flex: 1, gap: 2 },
  deviceName: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  deviceOs: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  deviceManufacturer: { fontFamily: fonts.text, fontSize: 12, color: c.muted },

  shareBtn: { marginHorizontal: spacing.lg, marginTop: spacing.md, borderRadius: radius.md, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  shareBtnText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brandPrimary },

  section: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  sectionIntro: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary, marginTop: 2, marginBottom: spacing.sm },

  rowAttribution: { fontFamily: fonts.text, fontSize: 11, color: c.muted, marginTop: 4 },
  tableNote: { fontFamily: fonts.text, fontSize: 11, lineHeight: 16, color: c.muted, marginTop: spacing.sm },

  recRow: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.md,
    borderBottomWidth: 0.5, borderBottomColor: c.divider,
  },
  recTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  recLine: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted, marginTop: 2 },
  recState: { width: 110, flexDirection: "row", alignItems: "flex-start", justifyContent: "flex-end", gap: 4 },
  recStateText: { fontFamily: fonts.textMedium, fontSize: 11, lineHeight: 15, color: c.onSurfaceSecondary, textAlign: "right", flexShrink: 1 },

}));

const EMPTY_VIEW: DeviceCapabilityView = { deviceProtects: [], apolloCanUse: [], needsPermission: [], notAccessible: [], unavailable: [], unknown: [], notReadableHere: [], recommendations: [], summary: "Reading this device…" };

/** Section heading with a one-line explanation of what the person is looking at. */
function SectionHead({ title, intro, testID }: { title: string; intro: string; testID: string }) {
  const s = useStyles();
  return (
    <View testID={testID}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionIntro}>{intro}</Text>
    </View>
  );
}

export default function DeviceCapabilitiesScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { protection, showToast } = useApollo();

  const [lastCheck, setLastCheck] = useState<CheckHistoryEntry | null>(null);
  const [view, setView] = useState<DeviceCapabilityView>(EMPTY_VIEW);
  const [hasNativeHost, setHasNativeHost] = useState(Platform.OS !== "web");
  const [nativeReadFailed, setNativeReadFailed] = useState(false);
  const [reading, setReading] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => { void getCheckHistory("device").then((h) => setLastCheck(h[0] ?? null)); }, []);

  // One shared reader, so this screen, the shareable report and Higgins' live reading can never
  // disagree. A failed read stays a failure — it is never flattened into "nothing found".
  useEffect(() => {
    let cancelled = false;
    void readDeviceCapabilityState().then((reading_) => {
      if (cancelled) return;
      setView(reading_.view);
      setHasNativeHost(reading_.hasNativeHost);
      setNativeReadFailed(reading_.nativeReadFailed);
      setReading(false);
    }).catch(() => { if (!cancelled) setReading(false); });
    return () => { cancelled = true; };
  }, []);

  const platform = capabilityPlatform();

  // One table, in the order the person reads it: usable → needs permission → device-managed →
  // couldn't check → not readable here → absent. The classes stay exactly as the engine resolved them.
  const allCapabilities = useMemo<CapabilityRow[]>(() => allCapabilityRows(view), [view]);

  const deviceModel = Device.modelName || Device.deviceName || "Unknown device";
  const osLabel = Platform.OS === "android" ? `Android ${Device.osVersion || ""}`.trim() : Platform.OS === "ios" ? `iOS ${Device.osVersion || ""}`.trim() : "Web";
  const manufacturer = Device.manufacturer || (Platform.OS === "ios" ? "Apple" : "");
  const brand = Device.brand ? `${Device.brand}` : "";

  const protectionActive = protection?.operational !== false;

  // When the last device check ran, from the real check history. No history means exactly that.
  const lastCheckWhen = useCallback(() => {
    if (!lastCheck) return "not run yet";
    const days = Math.floor((Date.now() - new Date(lastCheck.at).getTime()) / 86400000);
    const time = new Date(lastCheck.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (days === 0) return `today, ${time}`;
    if (days === 1) return `yesterday, ${time}`;
    return `${days} days ago`;
  }, [lastCheck]);

  const shareReport = useCallback(async () => {
    setSharing(true);
    try {
      await shareDeviceCapabilityReport(view, {
        deviceLabel: deviceModel,
        osLabel,
        manufacturer: manufacturer || null,
        platformLabel: platform === "android" ? "Android" : platform === "ios" ? "iOS" : platform === "windows" ? "Windows" : platform === "macos" ? "macOS" : "this browser",
        lastCheckedAt: lastCheck?.at ?? null,
        generatedAt: new Date().toISOString(),
        apolloProtection: protection ? (protection.operational ? "running" : protection.requested ? `requested but not running${protection.degradedReason ? ` (${protection.degradedReason})` : ""}` : "off") : "not read",
        hasNativeHost,
      });
    } catch (error) {
      showToast(`Apollo couldn't prepare the report (${error instanceof Error ? error.message : "reason could not be determined"}).`, "growling");
    } finally {
      setSharing(false);
    }
  }, [view, deviceModel, osLabel, manufacturer, platform, lastCheck, protection, hasNativeHost, showToast]);

  return (
    <View style={s.root} testID="device-protection-screen">
      <View style={{ paddingTop: insets.top }}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="device-prot-back" onPress={() => goBackOrHome(router)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle}>Device Capabilities</Text>
          <AlertsButton testID="device-prot-alerts" />
        </View>
        <View style={s.lastCheck} testID="device-prot-last-check">
          <Clock size={14} color={colors.muted} />
          <Text style={s.lastCheckTitle}>Last device check — {lastCheckWhen()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false} testID="device-prot-scroll">
        {/* ── This device ── */}
        <View style={s.deviceCard} testID="device-prot-info">
          <View style={s.deviceRow}>
            <View style={s.deviceIconWrap}><Smartphone size={28} color={colors.gold} /></View>
            <View style={s.deviceInfo}>
              <Text style={s.deviceName}>{deviceModel}</Text>
              <Text style={s.deviceOs}>{osLabel}</Text>
              {brand ? <Text style={s.deviceManufacturer}>{manufacturer ? `${manufacturer} ${brand}` : brand}</Text> : null}
            </View>
            <Pill tone={protectionActive ? "resting" : "growling"} label={protectionActive ? "Good" : "Review"} testID="device-prot-status" />
          </View>
        </View>

        <Pressable
          testID="device-prot-share-btn"
          accessibilityRole="button"
          accessibilityLabel="Share this report"
          accessibilityHint="Creates a PDF of everything on this screen and opens your share options"
          disabled={reading || sharing}
          onPress={() => void shareReport()}
          style={({ pressed }) => [s.shareBtn, { opacity: pressed || reading || sharing ? 0.6 : 1 }]}
        >
          <Share2 size={16} color={colors.brandPrimary} />
          <Text style={s.shareBtnText}>{sharing ? "Preparing report…" : "Share this report"}</Text>
        </Pressable>

        {/* ── Everything on this device, grouped by what it covers ── */}
        <View style={s.section}>
          <SectionHead
            title="What protects this device"
            intro="Grouped by what each one covers: the protection built into this device by Android, Apple, its maker or your carrier — which runs whether Apollo is here or not, and whose findings stay theirs — and the capabilities Apollo itself can use here. Tap any row for what it does and how to check it."
            testID="device-prot-native-head"
          />
          {view.deviceProtects.length || allCapabilities.length ? (
            <DeviceAreaTables protections={view.deviceProtects} capabilities={allCapabilities} testID="device-prot-table" />
          ) : !reading ? (
            <Body testID="device-prot-table-empty">
              {!hasNativeHost
                ? "Apollo is open in a browser preview here, so it cannot see this phone’s protection. Open Apollo on your phone to see the real state."
                : nativeReadFailed
                  ? "Apollo asked this device which protections it has and the read failed. That is unknown, not none."
                  : "Apollo could not read any protection or capability state here."}
            </Body>
          ) : null}
          <Text style={s.tableNote} testID="device-prot-table-note">
            Tap any row to see what it is, how it helps protect you, and whether you need to do anything.
          </Text>
        </View>

        {/* ── 5. Protection worth checking ── */}
        {view.recommendations.length ? (
          <View style={s.section}>
            <SectionHead
              title="Worth checking"
              intro={`${view.recommendations.length} of these Apollo cannot switch on for you, and some it cannot even read. Each one opens Higgins' instructions for this device.`}
              testID="device-prot-rec-head"
            />
            {view.recommendations.map((rec, i) => (
              <Pressable
                key={rec.id}
                accessibilityRole="button"
                accessibilityLabel={`${rec.title}. ${rec.stateLabel}.`}
                accessibilityHint="Opens what this is, how it helps you, and how to check it"
                testID={`device-prot-rec-${i}`}
                onPress={() => router.push({ pathname: "/capability/[id]", params: { id: rec.id } })}
                style={({ pressed }) => [s.recRow, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.recTitle}>{rec.title}</Text>
                  <Text style={s.recLine} numberOfLines={2}>{rec.guidance?.recommended ?? rec.detail}</Text>
                </View>
                <View style={s.recState}>
                  <Text style={s.recStateText} numberOfLines={2}>{rec.stateLabel}</Text>
                  <ChevronRight size={16} color={colors.muted} />
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

    </View>
  );
}
