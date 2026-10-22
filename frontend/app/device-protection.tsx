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
import Clock from "lucide-react-native/icons/clock";
import Check from "lucide-react-native/icons/check";
import Lock from "lucide-react-native/icons/lock";
import KeyRound from "lucide-react-native/icons/key-round";
import CircleQuestionMark from "lucide-react-native/icons/circle-question-mark";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import CircleSlash from "lucide-react-native/icons/circle-slash";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckHistoryCard } from "@/src/components/CheckHistoryCard";
import { AlertsButton } from "@/src/components/AlertsButton";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Pill } from "@/src/components/ui";
import { useApollo } from "@/src/store/ApolloContext";
import { getCheckHistory } from "@/src/store/checkHistoryStore";
import { buildDeviceCapabilities, type CapabilityPlatform, type CapabilityRow, type NativeProtectionRead, type NativeProtectionRow, type NativeRecommendation } from "@/src/domain/deviceCapabilities";
import { AppDeviceSdk, type AppDeviceCapabilities } from "@/src/security/appDeviceSdk";
import { detectNativeProtection } from "@/src/security/nativeProtectionEvidence";
import { getNativeModule } from "@/src/security/nativeBridge";
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

  checkBtn: { marginHorizontal: spacing.lg, marginTop: spacing.md, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center" },
  checkBtnText: { fontFamily: fonts.textSemibold, fontSize: 15 },

  section: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  sectionIntro: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary, marginTop: 2, marginBottom: spacing.sm },

  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: c.divider },
  iconWell: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 2 },
  rowTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  rowDetail: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.onSurfaceSecondary, marginTop: 2 },
  rowAttribution: { fontFamily: fonts.text, fontSize: 11, color: c.muted, marginTop: 4 },
  rowAction: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.brandPrimary, marginTop: spacing.xs },

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

  historyWrap: { marginTop: spacing.lg, paddingHorizontal: spacing.lg },
}));

const platformFor = (): CapabilityPlatform =>
  Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web";

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

/** One Apollo capability — what it is, what state it's in, and what the person can do about it. */
function CapabilityRowView({ row, tone, onAction, testID }: { row: CapabilityRow; tone: { bg: string; fg: string; Icon: typeof Check }; onAction?: () => void; testID: string }) {
  const s = useStyles();
  const Icon = tone.Icon;
  return (
    <View style={s.row} testID={testID}>
      <View style={[s.iconWell, { backgroundColor: tone.bg }]}><Icon size={16} color={tone.fg} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{row.title}</Text>
        <Text style={s.rowDetail}>{row.detail}</Text>
        {row.attributedTo !== "Apollo" ? <Text style={s.rowAttribution}>Reported by {row.attributedTo}</Text> : null}
        {row.action && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={6} testID={`${testID}-action`}>
            <Text style={s.rowAction}>{row.action.label} →</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** One native protection the device itself provides. The provider owns this row. */
function NativeRowView({ row, testID }: { row: NativeProtectionRow; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const active = row.state === "active";
  return (
    <View style={s.row} testID={testID}>
      <View style={[s.iconWell, { backgroundColor: active ? colors.restingTint : colors.surfaceTertiary }]}>
        <ShieldCheck size={16} color={active ? colors.resting : colors.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={[s.rowTitle, { flex: 1 }]}>{row.provider}</Text>
          <Pill tone={active ? "resting" : "unknown"} label={row.stateLabel} compact testID={`${testID}-state`} />
        </View>
        <Text style={s.rowDetail}>{row.detail}</Text>
        {row.evidenceLine ? <Text style={s.rowAttribution}>{row.evidenceLine}</Text> : null}
      </View>
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
  const [caps, setCaps] = useState<AppDeviceCapabilities | null>(null);
  const [native, setNative] = useState<NativeProtectionRead | null>(null);
  const [hasNativeHost, setHasNativeHost] = useState(Platform.OS !== "web");
  const [reading, setReading] = useState(true);
  const [openRec, setOpenRec] = useState<NativeRecommendation | null>(null);

  useEffect(() => { void getCheckHistory("device").then((h) => setLastCheckAt(h[0]?.at ?? null)); }, []);

  // Real reads only. A failed read stays null so the view reports "Apollo couldn't tell" instead of
  // flattening a broken read into "nothing found".
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const nativeHost = Platform.OS !== "web" && !!getNativeModule();
      if (!cancelled) setHasNativeHost(nativeHost);
      if (!nativeHost) { if (!cancelled) { setCaps(null); setNative(null); setReading(false); } return; }
      const [capsResult, nativeResult] = await Promise.allSettled([
        AppDeviceSdk.getAppDeviceCapabilities(),
        detectNativeProtection(),
      ]);
      if (cancelled) return;
      setCaps(capsResult.status === "fulfilled" ? capsResult.value : null);
      setNative(nativeResult.status === "fulfilled" ? nativeResult.value : null);
      setReading(false);
    };
    void read();
    return () => { cancelled = true; };
  }, []);

  const platform = platformFor();
  const view = useMemo(() => buildDeviceCapabilities({ platform, caps, native }), [platform, caps, native]);

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
          testID="device-prot-check-btn"
          accessibilityRole="button"
          accessibilityLabel="Check Device"
          onPress={() => router.push("/device")}
          style={({ pressed }) => [s.checkBtn, { backgroundColor: colors.brand, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={[s.checkBtnText, { color: colors.onBrand }]}>Check Device</Text>
        </Pressable>

        {/* ── 1. What your device protects ── */}
        <View style={s.section}>
          <SectionHead
            title="What your device protects"
            intro="Protection built into this phone by its maker or your carrier. It runs whether Apollo is here or not, and anything it finds stays their finding."
            testID="device-prot-native-head"
          />
          {view.deviceProtects.length ? (
            view.deviceProtects.map((row, i) => <NativeRowView key={row.id} row={row} testID={`device-prot-native-${i}`} />)
          ) : (
            <Body testID="device-prot-native-empty">
              {!hasNativeHost
                ? "Apollo is open in a browser preview here, so it cannot see this phone’s built-in protection. Open Apollo on your phone to see what your device already protects."
                : native === null
                  ? "Apollo asked this device which built-in protections it has and the read failed. That is unknown, not none."
                  : "Apollo did not recognise any built-in call or message protection on this device. The settings below are still worth checking."}
            </Body>
          )}
        </View>

        {/* ── 2. What Apollo can use ── */}
        <View style={s.section}>
          <SectionHead
            title="What Apollo can use"
            intro={reading ? "Reading this device…" : view.summary}
            testID="device-prot-canuse-head"
          />
          {view.apolloCanUse.map((row, i) => (
            <CapabilityRowView
              key={row.id}
              row={row}
              tone={{ bg: colors.restingTint, fg: colors.resting, Icon: Check }}
              onAction={row.action ? () => openSettingsFor(row.action!.target, row.action!.path) : undefined}
              testID={`device-prot-canuse-${i}`}
            />
          ))}
          {!view.apolloCanUse.length && !reading ? <Body testID="device-prot-canuse-empty">Apollo has no device capabilities available here.</Body> : null}
        </View>

        {/* ── 3. Needs your permission ── */}
        {view.needsPermission.length ? (
          <View style={s.section}>
            <SectionHead
              title="Needs your permission"
              intro="Apollo asks for each of these at the moment it needs them — never up front, and never for more than the one thing you picked."
              testID="device-prot-perm-head"
            />
            {view.needsPermission.map((row, i) => (
              <CapabilityRowView
                key={row.id}
                row={row}
                tone={{ bg: colors.goldTint, fg: colors.gold, Icon: KeyRound }}
                onAction={row.action ? () => openSettingsFor(row.action!.target, row.action!.path) : undefined}
                testID={`device-prot-perm-${i}`}
              />
            ))}
          </View>
        ) : null}

        {/* ── 4. What Apollo cannot access ── */}
        {view.notAccessible.length ? (
          <View style={s.section}>
            <SectionHead
              title="What Apollo cannot access"
              intro="These exist on this device, but the operating system keeps them private from apps like Apollo. Apollo will not guess at them."
              testID="device-prot-blocked-head"
            />
            {view.notAccessible.map((row, i) => (
              <CapabilityRowView key={row.id} row={row} tone={{ bg: colors.surfaceTertiary, fg: colors.muted, Icon: Lock }} testID={`device-prot-blocked-${i}`} />
            ))}
          </View>
        ) : null}

        {/* ── Couldn't tell — only shown when a read genuinely failed ── */}
        {view.unknown.length ? (
          <View style={s.section}>
            <SectionHead
              title="Apollo couldn’t tell"
              intro="Apollo asked this device and the read failed. These are unknown — not clear. Running a device check again may settle them."
              testID="device-prot-unknown-head"
            />
            {view.unknown.map((row, i) => (
              <CapabilityRowView key={row.id} row={row} tone={{ bg: colors.growlingTint, fg: colors.growling, Icon: CircleQuestionMark }} testID={`device-prot-unknown-${i}`} />
            ))}
          </View>
        ) : null}

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

        {/* ── Not on this device ── */}
        {view.unavailable.length ? (
          <View style={s.section}>
            <SectionHead title="Not on this device" intro="Capabilities Apollo looks for that this device does not have at all." testID="device-prot-na-head" />
            <View style={s.row} testID="device-prot-na-list">
              <View style={[s.iconWell, { backgroundColor: colors.surfaceTertiary }]}><CircleSlash size={16} color={colors.muted} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowDetail}>{view.unavailable.map((r) => r.title).join(" · ")}</Text>
                <Text style={s.rowAttribution}>{view.unavailable[0].detail}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* ── Previous device checks ── */}
        <View style={s.historyWrap}>
          <CheckHistoryCard gate="device" testID="device-prot-history" />
        </View>
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
