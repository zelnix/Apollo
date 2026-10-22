/**
 * Device Protection screen — the landing page for the "Device" card on Home.
 * Shows device info, Apollo capabilities, built-in protections, and links to
 * the full device check at /device. Does NOT duplicate check logic.
 */
import { useRouter } from "expo-router";
import * as Device from "expo-device";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import Smartphone from "lucide-react-native/icons/smartphone";
import Clock from "lucide-react-native/icons/clock";
import Phone from "lucide-react-native/icons/phone";
import MessageSquare from "lucide-react-native/icons/message-square";
import AppWindow from "lucide-react-native/icons/app-window";
import Bell from "lucide-react-native/icons/bell";
import Check from "lucide-react-native/icons/check";
import XIcon from "lucide-react-native/icons/x";
import Lock from "lucide-react-native/icons/lock";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckHistoryCard } from "@/src/components/CheckHistoryCard";
import { AlertsButton } from "@/src/components/AlertsButton";
import { Pill } from "@/src/components/ui";
import { useApollo } from "@/src/store/ApolloContext";
import { detectNativeProtection, summariseCallProtection, summariseMessageProtection } from "@/src/security/nativeProtectionEvidence";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const LAST_CHECK_KEY = "apollo.lastDeviceCheckAt";

// ── Capability item definitions — what Apollo can use on this device ──
const APOLLO_CAPABILITIES = [
  { id: "calls", label: "Call history", icon: Phone, available: Platform.OS === "android" },
  { id: "messages", label: "Messages", icon: MessageSquare, available: Platform.OS === "android" },
  { id: "apps", label: "Installed apps", icon: AppWindow, available: Platform.OS === "android" },
  { id: "notifications", label: "Notifications", icon: Bell, available: true },
];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, flex: 1 },

  // Device info card
  deviceCard: {
    marginHorizontal: spacing.lg, borderRadius: radius.lg, padding: spacing.lg,
    backgroundColor: c.surfaceSecondary, borderWidth: 0.5, borderColor: c.border, gap: spacing.md,
  },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  deviceIconWrap: {
    width: 56, height: 56, borderRadius: radius.md, backgroundColor: "rgba(22,34,53,0.06)",
    alignItems: "center", justifyContent: "center",
  },
  deviceInfo: { flex: 1, gap: 2 },
  deviceName: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  deviceOs: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  deviceManufacturer: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  lastChecked: { fontFamily: fonts.text, fontSize: 12, color: c.muted, flexDirection: "row", alignItems: "center" },

  // Check device button
  checkBtn: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: "center", justifyContent: "center",
  },
  checkBtnText: { fontFamily: fonts.textSemibold, fontSize: 15 },

  // Section
  section: { marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface, marginBottom: spacing.sm },

  // Capability row
  capRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: c.divider,
  },
  capIconWrap: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
  },
  capLabel: { flex: 1, fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  capStatus: { fontFamily: fonts.text, fontSize: 12 },

  // Protection row
  protRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: c.divider,
  },
  protLabel: { flex: 1, fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  protDetail: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  protStatusIcon: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  // History wrapper
  historyWrap: { marginTop: spacing.md, paddingHorizontal: spacing.lg },
}));

export default function DeviceProtection() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { protection } = useApollo();

  const [lastCheckAt, setLastCheckAt] = useState<string | null>(null);
  const [nativeProtection, setNativeProtection] = useState<Awaited<ReturnType<typeof detectNativeProtection>> | null>(null);

  // Load last check time
  useEffect(() => {
    void storage.getItem<string | null>(LAST_CHECK_KEY, null).then(setLastCheckAt);
  }, []);

  // Detect native protections
  useEffect(() => {
    void detectNativeProtection().then(setNativeProtection).catch(() => null);
  }, []);

  const deviceModel = Device.modelName || Device.deviceName || "Unknown device";
  const osLabel = Platform.OS === "android" ? `Android ${Device.osVersion || ""}` : Platform.OS === "ios" ? `iOS ${Device.osVersion || ""}` : "Web";
  const manufacturer = Device.manufacturer || (Platform.OS === "ios" ? "Apple" : "");
  const brand = Device.brand ? `${Device.brand}` : "";

  // Determine device status
  const protectionActive = protection?.operational !== false;
  const statusTone = protectionActive ? "resting" : "growling";
  const statusLabel = protectionActive ? "Good" : "Review";

  // Last check time formatting
  const lastCheckLabel = useCallback(() => {
    if (!lastCheckAt) return "Not checked yet";
    const diff = Date.now() - new Date(lastCheckAt).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Checked today";
    if (days === 1) return "Checked yesterday";
    return `Checked ${days} days ago`;
  }, [lastCheckAt]);

  // Built-in protection items
  const builtInProtections = React.useMemo(() => {
    const items: { label: string; detail: string; enabled: boolean }[] = [];
    if (nativeProtection) {
      const callProt = summariseCallProtection(nativeProtection);
      if (callProt.provider) items.push({ label: `${callProt.provider} Smart Call`, detail: callProt.summary, enabled: callProt.enabled });
      const msgProt = summariseMessageProtection(nativeProtection);
      if (msgProt.provider) items.push({ label: `${msgProt.provider} Messages protection`, detail: msgProt.summary, enabled: msgProt.enabled });
    }
    // Google Play Protect (Android)
    if (Platform.OS === "android") {
      items.push({ label: "Google Play Protect", detail: "Scans apps for harmful behaviour", enabled: true });
    }
    // iOS built-in protections
    if (Platform.OS === "ios") {
      items.push({ label: "App Store Review", detail: "Apple reviews all App Store apps", enabled: true });
      items.push({ label: "Lockdown Mode", detail: "Extreme protection against targeted attacks", enabled: false });
    }
    return items;
  }, [nativeProtection]);

  // Items Apollo cannot access
  const notAccessible = React.useMemo(() => {
    const items: string[] = [];
    if (Platform.OS === "ios") {
      items.push("Call history", "Messages", "Installed apps");
    }
    if (Platform.OS === "web") {
      items.push("Call history", "Messages", "Installed apps", "System settings");
    }
    return items;
  }, []);

  return (
    <View style={s.root} testID="device-protection-screen">
      {/* Header */}
      <View style={{ paddingTop: insets.top }}>
        <View style={s.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="device-prot-back"
            onPress={() => goBackOrHome(router)}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle}>Device Capabilities and Status</Text>
          <AlertsButton testID="device-prot-alerts" />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        {/* ── Device Info Card ── */}
        <View style={s.deviceCard}>
          <View style={s.deviceRow}>
            <View style={s.deviceIconWrap}>
              <Smartphone size={28} color={colors.brand} />
            </View>
            <View style={s.deviceInfo}>
              <Text style={s.deviceName}>{deviceModel}</Text>
              <Text style={s.deviceOs}>{osLabel}</Text>
              {brand ? <Text style={s.deviceManufacturer}>{manufacturer ? `${manufacturer} ${brand}` : brand}</Text> : null}
            </View>
            <Pill tone={statusTone} label={statusLabel} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Clock size={12} color={colors.muted} />
            <Text style={{ fontFamily: fonts.text, fontSize: 12, color: colors.muted }}>
              {lastCheckLabel()}
            </Text>
          </View>
        </View>

        {/* ── Check Device Button ── */}
        <Pressable
          testID="device-prot-check-btn"
          accessibilityRole="button"
          accessibilityLabel="Check Device"
          onPress={() => router.push("/device")}
          style={({ pressed }) => [s.checkBtn, { backgroundColor: colors.brand, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={[s.checkBtnText, { color: colors.onBrand }]}>Check Device</Text>
        </Pressable>

        {/* ── Apollo Can Use ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Apollo can use</Text>
          {APOLLO_CAPABILITIES.filter((c) => c.available).map((cap) => {
            const CIcon = cap.icon;
            return (
              <View key={cap.id} style={s.capRow}>
                <View style={[s.capIconWrap, { backgroundColor: "rgba(22,34,53,0.06)" }]}>
                  <CIcon size={18} color={colors.brand} />
                </View>
                <Text style={s.capLabel}>{cap.label}</Text>
                <View style={[s.protStatusIcon, { backgroundColor: "rgba(16,185,129,0.12)" }]}>
                  <Check size={14} color="#10B981" />
                </View>
              </View>
            );
          })}
        </View>

        {/* ── Built-in Protection ── */}
        {builtInProtections.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Built-in protection</Text>
            {builtInProtections.map((prot) => (
              <View key={prot.label} style={s.protRow}>
                <View style={[s.protStatusIcon, { backgroundColor: prot.enabled ? "rgba(16,185,129,0.12)" : "rgba(107,114,128,0.12)" }]}>
                  {prot.enabled ? <Check size={14} color="#10B981" /> : <XIcon size={14} color="#6B7280" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.protLabel}>{prot.label}</Text>
                  <Text style={s.protDetail}>{prot.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Not Accessible to Apollo ── */}
        {notAccessible.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Not accessible to Apollo</Text>
            {notAccessible.map((item) => (
              <View key={item} style={s.protRow}>
                <View style={[s.protStatusIcon, { backgroundColor: "rgba(107,114,128,0.08)" }]}>
                  <Lock size={14} color="#9CA3AF" />
                </View>
                <Text style={[s.capLabel, { color: colors.muted }]}>{item}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Device Check History ── */}
        <View style={s.historyWrap}>
          <CheckHistoryCard gate="device" testID="device-prot-history" />
        </View>
      </ScrollView>
    </View>
  );
}
