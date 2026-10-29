// Protection — how ApolloSG and the device work together. One overall answer from the Protection Posture engine,
// then two tabs: Apollo's protection areas, and the device's own protections (counts + categories).
import { useLocalSearchParams, useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import Info from "lucide-react-native/icons/info";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppMenuButton } from "@/src/components/AppMenu";
import { FitTitle } from "@/src/components/FitTitle";
import { WebsiteProtectionNotices } from "@/src/components/WebsiteProtectionNotices";
import { APOLLO_AREA_ICONS, AreaList, DEVICE_AREA_ICONS } from "@/src/components/protection/AreaList";
import { DeviceCounts } from "@/src/components/protection/DeviceCounts";
import { PostureSummary, postureColors } from "@/src/components/protection/PostureSummary";
import { agoLabel } from "@/src/domain/alertFreshness";
import { useProtectionPosture } from "@/src/protection/useProtectionPosture";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 30, color: c.onSurface },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  subtitle: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  hero: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg },
  section: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  sectionSub: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary, marginTop: -spacing.xs },
  failedBanner: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, backgroundColor: c.growlingWash, borderColor: c.growling },
  failedTitle: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 20, color: c.onSurface },
  failedText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  tabs: { flexDirection: "row", padding: 4, borderRadius: radius.md, backgroundColor: c.surfaceTertiary },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  tabActive: { backgroundColor: c.surface, borderWidth: 0.5, borderColor: c.border },
  tabText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurfaceSecondary },
  tabTextActive: { fontFamily: fonts.textSemibold, color: c.onSurface },
  tabBody: { gap: spacing.lg },
  reading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  info: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, borderWidth: 0.5, borderColor: c.border },
  infoTitle: { fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 18, color: c.onSurface },
  infoText: { fontFamily: fonts.text, fontSize: 12.5, lineHeight: 17, color: c.onSurfaceSecondary },
  checkedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  checkedText: { flex: 1, fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary },
}));

const TABS = [{ id: "apollo", label: "Apollo Protections" }, { id: "device", label: "Device Protections" }] as const;
type TabId = (typeof TABS)[number]["id"];

export default function ProtectionScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<TabId>(params.tab === "device" ? "device" : "apollo");
  useEffect(() => { if (params.tab === "device" || params.tab === "apollo") setTab(params.tab); }, [params.tab]);
  const { posture, areas, deviceCounts, deviceAreas, deviceRead, health, recheck, rechecking } = useProtectionPosture();
  const palette = postureColors(posture.status, colors);
  const checkedAgo = health.checkedAt ? agoLabel(Date.parse(health.checkedAt), Date.now()) : null;
  const checkedLine = health.checkedAt ? `Protection status checked ${agoLabel(Date.parse(health.checkedAt), Date.now())}` : "Protection status not checked yet";

  return (
    <View style={s.root} testID="protection-screen">
      <View style={{ paddingTop: insets.top + spacing.sm }}>
        <View style={s.headerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="protection-back" onPress={() => goBackOrHome(router)} style={s.backBtn}>
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <FitTitle text="Protections" style={s.headerTitle} maxSize={24} minSize={20} testID="protection-title" />
          <AppMenuButton testID="protection-menu" />
        </View>
      </View>

      <ScrollView testID="protection-scroll" contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 90 }]} showsVerticalScrollIndicator={false}>
        <Text style={s.subtitle}>How ApolloSG and your device work together to keep you safer.</Text>

        {/* The readings below are the last ones Apollo actually observed. When the most recent check failed, that is said
            here with its reason and the age of what is on screen — an old reading is never presented as the current state. */}
        {health.lastCheckFailure ? (
          <View testID="protection-check-failed-banner" style={s.failedBanner}>
            <CircleAlert size={18} color={colors.growling} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.failedTitle} testID="protection-check-failed-title">This check didn&apos;t run</Text>
              <Text style={s.failedText} testID="protection-check-failed-reason">{health.lastCheckFailure.reason}</Text>
              <Text style={s.failedText} testID="protection-check-failed-age">
                {checkedAgo
                  ? `What you see below is Apollo's last successful reading, taken ${checkedAgo}. It is not confirmation of the current state.`
                  : "ApolloSG has no successful reading to show, so nothing below confirms the current state."}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Phone settings that decide whether website protection works (Android only). */}
        <WebsiteProtectionNotices protection={health.protection} testID="protection-site-notices" />

        <View style={[s.hero, { backgroundColor: palette.wash, borderColor: palette.tint }]} testID="protection-posture-card">
          <PostureSummary posture={posture} testID="protection-posture" />
        </View>

        {/* When Apollo last read its protections — icon-only re-check button. */}
        <Pressable
          testID="protection-checked"
          accessibilityRole="button"
          accessibilityLabel={`${checkedLine}. Check again.`}
          onPress={recheck}
          disabled={rechecking}
          style={({ pressed }) => [s.checkedRow, { opacity: pressed ? 0.85 : 1 }]}
        >
          <ShieldCheck size={18} color={colors.resting} />
          <Text style={s.checkedText} numberOfLines={2} testID="protection-checked-text">{checkedLine}</Text>
          {rechecking ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : (
            <RefreshCw size={18} color={colors.brandPrimary} testID="protection-recheck" />
          )}
        </Pressable>

        <View style={s.tabs} accessibilityRole="tablist" testID="protection-tabs">
          {TABS.map((t) => {
            const selected = tab === t.id;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setTab(t.id)}
                style={[s.tab, selected && s.tabActive]}
                testID={`protection-tab-${t.id}`}
              >
                <Text style={[s.tabText, selected && s.tabTextActive]} numberOfLines={1}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === "apollo" ? (
          <View style={s.section} testID="protection-apollo">
            <Text style={s.sectionSub}>How ApolloSG protects you from scams, threats and online risks.</Text>
            <AreaList rows={areas} icons={APOLLO_AREA_ICONS} onOpen={(id) => router.push(`/protection-details?category=${id}` as never)} testID="protection-area" />
          </View>
        ) : (
          <View style={s.tabBody} testID="protection-device">
            {deviceCounts ? (
              <DeviceCounts counts={deviceCounts} testID="protection-device-counts" />
            ) : !deviceRead ? (
              <View style={s.reading} testID="protection-device-reading">
                <ActivityIndicator size="small" color={colors.brandPrimary} />
                <Text style={s.sectionSub}>Reading this device…</Text>
              </View>
            ) : null}
            <AreaList rows={deviceAreas} icons={DEVICE_AREA_ICONS} onOpen={(id) => router.push(`/device-protection?area=${id}` as never)} testID="protection-device-area" />
            <View style={s.info} testID="protection-device-info">
              <Info size={20} color={colors.onSurfaceSecondary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.infoTitle}>These are your device&apos;s own protections and settings.</Text>
                <Text style={s.infoText}>ApolloSG can only read your device&apos;s settings in the app on your phone.</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
