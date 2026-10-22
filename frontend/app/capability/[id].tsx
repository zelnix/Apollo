/**
 * Capability Details — one capability, answering the person's three questions:
 *   What is this?  →  How does it help me?  →  Do I need to do anything?
 *
 * Everything here comes from the SAME live reading as the Device Capabilities table, so the two can
 * never disagree. The status is stated exactly as the read produced it: a capability the OS keeps to
 * itself is "Managed by your device" and names who manages it, a failed read is "Apollo couldn't
 * check" and never an all-clear, and no native setting is ever described as on or off.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AlertsButton } from "@/src/components/AlertsButton";
import { Body, Button, Pill } from "@/src/components/ui";
import {
  allCapabilityRows, capabilityAdvice, CAPABILITY_CLASS_LABEL,
  type CapabilityRow,
} from "@/src/domain/deviceCapabilities";
import { readDeviceCapabilityState } from "@/src/security/deviceCapabilityState";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { openDeviceSettings } from "@/src/utils/deviceSettings";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, flex: 1 },

  hero: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  title: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 30, color: c.onSurface },

  section: { paddingHorizontal: spacing.lg, marginTop: spacing.xl, gap: spacing.xs },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  text: { fontFamily: fonts.text, fontSize: 15, lineHeight: 23, color: c.onSurfaceSecondary },

  statusCard: { marginHorizontal: spacing.lg, marginTop: spacing.xl, borderRadius: radius.md, borderWidth: 0.5, borderColor: c.border, backgroundColor: c.surfaceSecondary, padding: spacing.lg, gap: spacing.sm },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusLabel: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface, flex: 1 },
  attr: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.muted },

  actions: { paddingHorizontal: spacing.lg, marginTop: spacing.xl, gap: spacing.sm },
}));

export default function CapabilityDetailScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { showToast } = useApollo();

  const [row, setRow] = useState<CapabilityRow | null>(null);
  const [reading, setReading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void readDeviceCapabilityState().then((state) => {
      if (cancelled) return;
      setRow(allCapabilityRows(state.view).find((r) => r.id === id) ?? null);
      setReading(false);
    }).catch(() => { if (!cancelled) setReading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const tone = row?.klass === "apollo_can_use" ? "resting"
    : row?.klass === "permission_required" ? "ears_up"
      : row?.klass === "unknown" ? "growling" : "unknown";
  const advice = row ? capabilityAdvice(row) : null;

  return (
    <View style={s.root} testID="capability-detail-screen">
      <View style={{ paddingTop: insets.top }}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="capability-back" onPress={() => goBackOrHome(router)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>Device capability</Text>
          <AlertsButton testID="capability-alerts" />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        {!row ? (
          <View style={s.section}>
            <Body testID="capability-missing">
              {reading ? "Reading this device…" : "Apollo doesn’t have a capability by that name. Go back to Device Capabilities and tap the row you want."}
            </Body>
          </View>
        ) : (
          <>
            <View style={s.hero}>
              <Text style={s.title} testID="capability-title">{row.title}</Text>
            </View>

            <View style={s.section}>
              <Text style={s.sectionTitle}>What it does</Text>
              <Text style={s.text} testID="capability-what">{row.what}</Text>
            </View>

            <View style={s.section}>
              <Text style={s.sectionTitle}>How it helps protect you</Text>
              <Text style={s.text} testID="capability-benefit">{row.benefit}</Text>
            </View>

            <View style={s.statusCard} testID="capability-status">
              <View style={s.statusRow}>
                <Text style={s.statusLabel}>Current status</Text>
                <Pill tone={tone} label={CAPABILITY_CLASS_LABEL[row.klass]} compact testID="capability-status-pill" />
              </View>
              <Text style={s.text} testID="capability-status-detail">{row.detail}</Text>
              {row.attributedTo !== "Apollo" ? <Text style={s.attr}>Reported by {row.attributedTo}</Text> : null}
            </View>

            {advice ? (
              <View style={s.section}>
                <Text style={s.sectionTitle}>What you should do</Text>
                <Text style={s.text} testID="capability-advice">{advice}</Text>
              </View>
            ) : (
              <View style={s.section}>
                <Text style={s.sectionTitle}>What you should do</Text>
                <Text style={s.text} testID="capability-advice">Nothing. Apollo is already using this whenever it checks something for you.</Text>
              </View>
            )}

            <View style={s.actions}>
              {row.action ? (
                <Button
                  testID="capability-open-settings"
                  label={Platform.OS === "web" ? `Show me where: ${row.action.label}` : row.action.label}
                  onPress={() => { void openDeviceSettings(row.action!.target, row.action!.path, (m) => showToast(m, "neutral")); }}
                />
              ) : null}
              <Button
                testID="capability-ask-higgins"
                variant="ghost"
                label="Ask Higgins about this"
                onPress={() => router.push({ pathname: "/(tabs)/ask", params: { prompt: `Can you explain “${row.title}” on my phone? Apollo says its status is “${CAPABILITY_CLASS_LABEL[row.klass]}”. What does that mean for me and should I do anything?` } })}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
