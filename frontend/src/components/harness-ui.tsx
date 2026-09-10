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
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingVertical: 4 },
  checkboxBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  checkboxMark: { fontSize: 14, fontWeight: "900" },
  checkboxLabel: { flex: 1, fontSize: 13, fontWeight: "600" },
  radioGroupWrap: { gap: 6 },
  radioLabel: { fontSize: 12, fontWeight: "600" },
  radioOptionsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  radioOption: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  radioDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDotFill: { width: 8, height: 8, borderRadius: 4 },
  radioOptionText: { fontSize: 12, fontWeight: "700" },
  resultCard: { borderRadius: 10, borderWidth: 1.5, padding: 10, gap: 4 },
  resultTitle: { fontSize: 12, fontWeight: "800" },
  resultRow: { flexDirection: "row", gap: 6 },
  resultRowLabel: { fontSize: 11, fontWeight: "700", width: 130 },
  resultRowValue: { fontSize: 11, flex: 1 },
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

/** Tappable confirmation control -- use instead of a free-text field whenever the answer is
 * genuinely a yes/no confirmation (e.g. "invariant confirmed present", "drift check was empty"). */
export function Checkbox({ label, checked, onToggle, testID }: { label: string; checked: boolean; onToggle: (next: boolean) => void; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onToggle(!checked)}
      style={({ pressed }) => [styles.checkboxRow, pressed && styles.pressed]}
    >
      <View style={[styles.checkboxBox, { borderColor: checked ? colors.brandPrimary : colors.borderStrong, backgroundColor: checked ? colors.brandPrimary : "transparent" }]}>
        {checked ? <Text style={[styles.checkboxMark, { color: colors.onBrandPrimary }]}>✓</Text> : null}
      </View>
      <Text style={[styles.checkboxLabel, { color: colors.onSurfaceSecondary }]}>{label}</Text>
    </Pressable>
  );
}

/** Tappable single-choice control -- use instead of a free-text field whenever there is a known,
 * fixed set of possible answers (e.g. build source, architecture, Private DNS mode). */
export function RadioGroup({ label, options, value, onChange, testID }: { label: string; options: string[]; value: string; onChange: (next: string) => void; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.radioGroupWrap} testID={testID}>
      <Text style={[styles.radioLabel, { color: colors.onSurfaceSecondary }]}>{label}</Text>
      <View style={styles.radioOptionsRow}>
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <Pressable
              key={opt}
              testID={testID ? `${testID}-${opt}` : undefined}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(opt)}
              style={[styles.radioOption, { borderColor: selected ? colors.brandPrimary : colors.borderStrong, backgroundColor: selected ? colors.surfaceTertiary : "transparent" }]}
            >
              <View style={[styles.radioDot, { borderColor: selected ? colors.brandPrimary : colors.borderStrong }]}>
                {selected ? <View style={[styles.radioDotFill, { backgroundColor: colors.brandPrimary }]} /> : null}
              </View>
              <Text style={[styles.radioOptionText, { color: selected ? colors.onSurface : colors.onSurfaceTertiary }]}>{opt}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Inline pass/fail-flavored evidence card, meant to sit directly under an execution button so the
 * tester sees the raw captured result without leaving the screen. `tone` is a visual hint only --
 * it never substitutes for the tester's own manual PASS/FAIL classification in the matrix below. */
export function InlineResultCard({ tone, title, rows, testID }: { tone: "good" | "bad" | "neutral"; title: string; rows: [string, string][]; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toneColor = tone === "good" ? colors.success : tone === "bad" ? colors.error : colors.brandPrimary;
  return (
    <View style={[styles.resultCard, { borderColor: toneColor, backgroundColor: colors.surfaceTertiary }]} testID={testID}>
      <Text style={[styles.resultTitle, { color: toneColor }]}>{title}</Text>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.resultRow}>
          <Text style={[styles.resultRowLabel, { color: colors.onSurfaceSecondary }]}>{k}</Text>
          <Text style={[styles.resultRowValue, { color: colors.onSurfaceTertiary }]} selectable numberOfLines={3}>
            {v}
          </Text>
        </View>
      ))}
    </View>
  );
}
