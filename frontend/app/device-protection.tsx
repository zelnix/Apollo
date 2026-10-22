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
import { CapabilityTable, NativeProtectionTable } from "@/src/components/device/CapabilityTable";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Pill } from "@/src/components/ui";
import { useApollo } from "@/src/store/ApolloContext";
import { getCheckHistory } from "@/src/store/checkHistoryStore";
import { allCapabilityRows, type CapabilityRow, type DeviceCapabilityView, type NativeRecommendation } from "@/src/domain/deviceCapabilities";
import { capabilityPlatform, readDeviceCapabilityState } from "@/src/security/deviceCapabilityState";
import { shareDeviceCapabilityReport } from "@/src/utils/shareDeviceCapabilityReport";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { openDeviceSettings } from "@/src/utils/deviceSettings";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, flex: 1 },

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

  recCard: { borderRadius: radius.md, borderWidth: 0.5, borderColor: c.goldBorder, backgroundColor: c.surfaceSecondary, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  recTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  recBadge: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.3, textTransform: "uppercase", color: c.gold },
  recLine: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  recRecommend: { fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 19, color: c.onSurface },
  recAction: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  recActionText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brandPrimary },

  step: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xs },
  stepNum: { fontFamily: fonts.displayBold, fontSize: 14, color: c.brandPrimary, width: 18 },
  stepText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface, flex: 1 },

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

  const [lastCheckAt, setLastCheckAt] = useState<string | null>(null);
  const [view, setView] = useState<DeviceCapabilityView>(EMPTY_VIEW);
  const [hasNativeHost, setHasNativeHost] = useState(Platform.OS !== "web");
  const [nativeReadFailed, setNativeReadFailed] = useState(false);
  const [reading, setReading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [openRec, setOpenRec] = useState<NativeRecommendation | null>(null);

  useEffect(() => { void getCheckHistory("device").then((h) => setLastCheckAt(h[0]?.at ?? null)); }, []);

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

  const lastCheckLabel = useCallback(() => {
    if (!lastCheckAt) return "Not checked yet";
    const days = Math.floor((Date.now() - new Date(lastCheckAt).getTime()) / 86400000);
    if (days === 0) return "Checked today";
    if (days === 1) return "Checked yesterday";
    return `Checked ${days} days ago`;
  }, [lastCheckAt]);

  const openSettingsFor = useCallback((target: Parameters<typeof openDeviceSettings>[0], path: string) => {
    void openDeviceSettings(target, path, (m) => showToast(m, "neutral"));
  }, [showToast]);

  const shareReport = useCallback(async () => {
    setSharing(true);
    try {
      await shareDeviceCapabilityReport(view, {
        deviceLabel: deviceModel,
        osLabel,
        manufacturer: manufacturer || null,
        platformLabel: platform === "android" ? "Android" : platform === "ios" ? "iOS" : platform === "windows" ? "Windows" : platform === "macos" ? "macOS" : "this browser",
        lastCheckedAt: lastCheckAt,
        generatedAt: new Date().toISOString(),
        apolloProtection: protection ? (protection.operational ? "running" : protection.requested ? `requested but not running${protection.degradedReason ? ` (${protection.degradedReason})` : ""}` : "off") : "not read",
        hasNativeHost,
      });
    } catch (error) {
      showToast(`Apollo couldn't prepare the report (${error instanceof Error ? error.message : "reason could not be determined"}).`, "growling");
    } finally {
      setSharing(false);
    }
  }, [view, deviceModel, osLabel, manufacturer, platform, lastCheckAt, protection, hasNativeHost, showToast]);

  return (
    <View style={s.root} testID="device-protection-screen">
      <View style={{ paddingTop: insets.top }}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="device-prot-back" onPress={() => goBackOrHome(router)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle}>Device Capabilities and Status</Text>
          <AlertsButton testID="device-prot-alerts" />
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Clock size={12} color={colors.muted} />
            <Text style={{ fontFamily: fonts.text, fontSize: 12, color: colors.muted }} testID="device-prot-last-check">{lastCheckLabel()}</Text>
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

        {/* ── 1. What your device protects ── */}
        <View style={s.section}>
          <SectionHead
            title="What your device protects"
            intro="Protection built into this phone by its maker or your carrier. It runs whether Apollo is here or not, and anything it finds stays their finding."
            testID="device-prot-native-head"
          />
          {view.deviceProtects.length ? (
            <NativeProtectionTable rows={view.deviceProtects} testID="device-prot-native" />
          ) : (
            <Body testID="device-prot-native-empty">
              {!hasNativeHost
                ? "Apollo is open in a browser preview here, so it cannot see this phone’s built-in protection. Open Apollo on your phone to see what your device already protects."
                : nativeReadFailed
                  ? "Apollo asked this device which built-in protections it has and the read failed. That is unknown, not none."
                  : "Apollo did not recognise any built-in call or message protection on this device. The settings below are still worth checking."}
            </Body>
          )}
        </View>

        {/* ── 2–4. Every capability Apollo looks for, with its real status ── */}
        <View style={s.section}>
          <SectionHead
            title="Apollo’s capabilities on this device"
            intro={reading ? "Reading this device…" : view.summary}
            testID="device-prot-table-head"
          />
          {allCapabilities.length ? (
            <CapabilityTable rows={allCapabilities} testID="device-prot-table" />
          ) : !reading ? (
            <Body testID="device-prot-table-empty">Apollo could not read any capability state here.</Body>
          ) : null}
          <Text style={s.tableNote} testID="device-prot-table-note">
            Tap any row to see what it is, how it helps protect you, and whether you need to do anything.
          </Text>
        </View>

        {/* ── 5. More protection you can turn on ── */}
        {view.recommendations.length ? (
          <View style={s.section}>
            <SectionHead
              title="More protection you can turn on"
              intro="Protection your device offers that Apollo cannot switch on for you — or even read. Higgins will show you exactly which setting to enable and why."
              testID="device-prot-rec-head"
            />
            {view.recommendations.map((rec, i) => (
              <View key={rec.id} style={s.recCard} testID={`device-prot-rec-${i}`}>
                <Text style={s.recTitle}>{rec.title}</Text>
                <Text style={s.recBadge}>{rec.badge}</Text>
                <Text style={s.recLine}>{rec.unverified}</Text>
                <Text style={s.recRecommend}>{rec.recommendation}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={rec.actionLabel}
                  testID={`device-prot-rec-${i}-open`}
                  onPress={() => setOpenRec(rec)}
                  style={({ pressed }) => [s.recAction, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={s.recActionText}>{rec.actionLabel}</Text>
                  <ChevronRight size={16} color={colors.brandPrimary} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* ── Higgins' guide for one native setting ── */}
      <Sheet visible={!!openRec} onClose={() => setOpenRec(null)} title={openRec?.title ?? ""} testID="device-prot-rec-sheet">
        {openRec ? (
          <>
            <Text style={[s.recLine, { marginBottom: spacing.sm }]}>{openRec.why}</Text>
            <Text style={[s.sectionTitle, { marginBottom: spacing.sm }]}>What to turn on</Text>
            {openRec.steps.map((step, i) => (
              <View key={i} style={s.step}>
                <Text style={s.stepNum}>{i + 1}</Text>
                <Text style={s.stepText}>{step}</Text>
              </View>
            ))}
            <Text style={[s.rowAttribution, { marginBottom: spacing.sm }]}>{openRec.unverified} Once you have turned it on, your device handles it — Apollo will not report it as an Apollo protection.</Text>
            <Button
              testID="device-prot-rec-open-settings"
              label={Platform.OS === "web" ? "Show me where" : "Open Settings"}
              onPress={() => { openSettingsFor(openRec.settingsTarget, openRec.settingsPath); setOpenRec(null); }}
            />
            <Button
              testID="device-prot-rec-ask"
              variant="ghost"
              label="Ask Higgins about this"
              onPress={() => { const rec = openRec; setOpenRec(null); router.push({ pathname: "/(tabs)/ask", params: { prompt: `Can you explain ${rec.title} on my ${osLabel} device and whether I should turn it on?` } }); }}
            />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
