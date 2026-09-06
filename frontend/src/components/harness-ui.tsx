import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import type { HarnessStep, StepStatus } from "@/src/harness/androidBlockingProofHarness";
import { makeStyles, useTheme } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 8 },
  cardTitle: { color: colors.muted, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { color: colors.onSurfaceSecondary, fontSize: 15, fontWeight: "600", flex: 1 },
  value: { color: colors.onSurfaceTertiary, fontSize: 13, flexShrink: 1 },
  mono: { color: colors.onSurfaceTertiary, fontSize: 12, fontFamily: "monospace" },
  badge: { paddingHorizontal: 10, height: 24, borderRadius: 12, justifyContent: "center" },
  badgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  stepRow: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  stepBody: { flex: 1, gap: 2 },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary },
  buttonSecondary: { backgroundColor: colors.brandSecondary },
  buttonText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "700" },
  buttonTextSecondary: { color: colors.onBrandSecondary },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
}));

export function Card({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function KeyValue({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} testID={testID} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export function StatusBadge({ status, testID }: { status: StepStatus | string; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const palette: Record<string, { bg: string; fg: string }> = {
    PASS: { bg: colors.success, fg: colors.onSuccess },
    ACTIVE: { bg: colors.success, fg: colors.onSuccess },
    FAIL: { bg: colors.error, fg: colors.onError },
    FAILED: { bg: colors.error, fg: colors.onError },
    REVOKED: { bg: colors.error, fg: colors.onError },
    BLOCKED: { bg: colors.warning, fg: colors.onWarning },
    DEGRADED: { bg: colors.warning, fg: colors.onWarning },
    SKIPPED: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary },
  };
  const p = palette[status] ?? { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary };
  return (
    <View style={[styles.badge, { backgroundColor: p.bg }]} testID={testID}>
      <Text style={[styles.badgeText, { color: p.fg }]}>{status}</Text>
    </View>
  );
}

export function StepRow({ step }: { step: HarnessStep }) {
  const styles = useStyles();
  return (
    <View style={styles.stepRow} testID={`harness-step-${step.id}`}>
      <StatusBadge status={step.status} testID={`harness-step-${step.id}-status`} />
      <View style={styles.stepBody}>
        <Text style={styles.label}>{step.title}</Text>
        <Text style={styles.mono}>{step.detail}</Text>
      </View>
    </View>
  );
}

export function ActionButton({ title, onPress, secondary, disabled, testID }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean; testID: string }) {
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  );
}
