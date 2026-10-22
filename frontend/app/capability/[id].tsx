/**
 * Capability Details — one capability or one device protection, answering the person's three
 * questions in order: What is this?  →  How does it help me?  →  Do I need to do anything?
 *
 * Both kinds of row land here, from the same live reading as the Device Capabilities screen, so the
 * two can never disagree:
 *   • An Apollo capability shows its class exactly as the read produced it.
 *   • A device protection shows the state a read produced, or says plainly that Apollo cannot verify
 *     it — and then still gives Higgins' recommended configuration, the steps for checking it on this
 *     phone, a deep link to the setting, and a way for the person to record that they checked it.
 *
 * Apollo never claims a setting is on or off that it could not read, and a self-check is always
 * presented as the person's own statement, never as Apollo's verification.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import Check from "lucide-react-native/icons/check";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AlertsButton } from "@/src/components/AlertsButton";
import { Body, Button, Pill } from "@/src/components/ui";
import {
  allCapabilityRows, capabilityAdvice, CAPABILITY_CLASS_LABEL,
  type CapabilityRow, type DeviceProtectionRow,
} from "@/src/domain/deviceCapabilities";
import { readDeviceCapabilityState } from "@/src/security/deviceCapabilityState";
import { useApollo } from "@/src/store/ApolloContext";
import { getSelfChecks, recordSelfCheck } from "@/src/store/protectionChecklistStore";
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

  step: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  stepNum: { fontFamily: fonts.displayBold, fontSize: 14, color: c.brandPrimary, width: 18 },
  stepText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface, flex: 1 },

  selfCheck: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  selfCheckDone: { fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 19, color: c.restingText, flex: 1 },

  actions: { paddingHorizontal: spacing.lg, marginTop: spacing.xl, gap: spacing.sm },
}));

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export default function CapabilityDetailScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { showToast } = useApollo();

  const [capability, setCapability] = useState<CapabilityRow | null>(null);
  const [protectionRow, setProtectionRow] = useState<DeviceProtectionRow | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [reading, setReading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void readDeviceCapabilityState().then((state) => {
      if (cancelled) return;
      setCapability(allCapabilityRows(state.view).find((r) => r.id === id) ?? null);
      setProtectionRow(state.view.deviceProtects.find((r) => r.id === id) ?? null);
      setReading(false);
    }).catch(() => { if (!cancelled) setReading(false); });
    void getSelfChecks().then((map) => { if (!cancelled) setCheckedAt(map[String(id)] ?? null); });
    return () => { cancelled = true; };
  }, [id]);

  const markChecked = useCallback(async () => {
    const map = await recordSelfCheck(String(id));
    setCheckedAt(map[String(id)] ?? null);
    showToast("Noted — that is recorded as your check, not Apollo's.", "resting");
  }, [id, showToast]);

  const row = capability ?? protectionRow;
  const statusLabel = capability ? CAPABILITY_CLASS_LABEL[capability.klass] : protectionRow?.stateLabel ?? "";
  const tone = capability
    ? capability.klass === "apollo_can_use" ? "resting"
      : capability.klass === "permission_required" ? "ears_up"
        : capability.klass === "unknown" ? "growling" : "unknown"
    : protectionRow?.state === "active" || protectionRow?.state === "as_recommended" ? "resting"
      : protectionRow?.state === "off" ? "biting"
        : protectionRow?.state === "out_of_date" || protectionRow?.state === "unknown" ? "growling"
          : protectionRow?.state === "installed_not_default" ? "ears_up" : "unknown";
  const advice = capability ? capabilityAdvice(capability) : protectionRow?.guidance?.recommended ?? null;
  const guidance = protectionRow?.guidance ?? null;
  const action = capability?.action ?? guidance?.action ?? null;

  return (
    <View style={s.root} testID="capability-detail-screen">
      <View style={{ paddingTop: insets.top }}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="capability-back" onPress={() => goBackOrHome(router)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>{protectionRow ? "Device protection" : "Device capability"}</Text>
          <AlertsButton testID="capability-alerts" />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        {!row ? (
          <View style={s.section}>
            <Body testID="capability-missing">
              {reading ? "Reading this device…" : "Apollo doesn’t have anything by that name. Go back to Device Capabilities and tap the row you want."}
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
                <Pill tone={tone} label={statusLabel} compact testID="capability-status-pill" />
              </View>
              <Text style={s.text} testID="capability-status-detail">{row.detail}</Text>
              {row.attributedTo !== "Apollo" ? <Text style={s.attr}>Reported by {row.attributedTo}</Text> : null}
              {protectionRow?.evidenceLine ? <Text style={s.attr}>{protectionRow.evidenceLine}</Text> : null}
            </View>

            <View style={s.section}>
              <Text style={s.sectionTitle}>What you should do</Text>
              <Text style={s.text} testID="capability-advice">
                {advice ?? "Nothing. Apollo is already using this whenever it checks something for you."}
              </Text>
            </View>

            {guidance?.steps.length ? (
              <View style={s.section} testID="capability-steps">
                <Text style={s.sectionTitle}>How to check it yourself</Text>
                {guidance.steps.map((step, i) => (
                  <View key={i} style={s.step}>
                    <Text style={s.stepNum}>{i + 1}</Text>
                    <Text style={s.stepText}>{step}</Text>
                  </View>
                ))}
                {guidance.selfCheck ? (
                  checkedAt ? (
                    <View style={s.selfCheck} testID="capability-self-checked">
                      <Check size={16} color={colors.resting} />
                      <Text style={s.selfCheckDone}>You checked this on {dayLabel(checkedAt)}. That is your record, not Apollo’s — Apollo still cannot read this setting.</Text>
                    </View>
                  ) : (
                    <Button
                      testID="capability-mark-checked"
                      variant="ghost"
                      label="I’ve checked this myself"
                      onPress={() => void markChecked()}
                    />
                  )
                ) : null}
              </View>
            ) : null}

            <View style={s.actions}>
              {action ? (
                <Button
                  testID="capability-open-settings"
                  label={Platform.OS === "web" ? `Show me where: ${action.label}` : action.label}
                  onPress={() => { void openDeviceSettings(action.target, action.path, (m) => showToast(m, "neutral")); }}
                />
              ) : null}
              <Button
                testID="capability-ask-higgins"
                variant="ghost"
                label="Ask Higgins about this"
                onPress={() => router.push({ pathname: "/(tabs)/ask", params: { prompt: `Can you explain “${row.title}” on my phone? Apollo says its status is “${statusLabel}”. What does that mean for me and should I do anything?` } })}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
