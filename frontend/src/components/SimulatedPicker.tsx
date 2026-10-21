// Preview-only picker: supplies INPUT to a real Apollo check when the preview can't reach the real
// source (no SMS list, no call log, no installed-app list, nothing in the file picker). It is marked
// so it can never be mistaken for real device data, and it never carries a verdict — whatever the
// person picks goes through the screen's own real check flow.

import { Platform, Pressable, Text, View } from "react-native";

import { PREVIEW_SAMPLES_ENABLED } from "@/src/preview/samples";
import { IS_PREVIEW_HARNESS } from "@/src/security/securityAdapter";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

/** True only in a preview build where the real source of this input cannot be reached. Every shipped
 *  build — native or web — fails this, so no simulated input can ever be offered to a real user. */
export const PREVIEW_SIMULATION = PREVIEW_SAMPLES_ENABLED && (Platform.OS === "web" || IS_PREVIEW_HARNESS);

export interface SimulatedChoice {
  id: string;
  primary: string;
  secondary?: string;
  /** What the item contains — never what Apollo will conclude about it. */
  probes: string;
}

const useStyles = makeStyles((c) => ({
  card: {
    marginBottom: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed",
    borderColor: c.gold, backgroundColor: c.surfaceSecondary, paddingVertical: spacing.md,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  title: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface, flex: 1 },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.gold },
  tagText: { fontFamily: fonts.textSemibold, fontSize: 10, letterSpacing: 0.5, color: "#1B2437" },
  note: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary, paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: c.border, marginTop: spacing.xs,
  },
  rowSelected: { backgroundColor: c.restingTint },
  rowPrimary: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  rowSecondary: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurface, marginTop: 1 },
  rowProbe: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary, marginTop: 2 },
}));

export function SimulatedPicker({
  title, note, items, onSelect, disabled, testID, selectedId,
}: {
  title: string;
  note: string;
  items: SimulatedChoice[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  testID: string;
  /** The sample currently loaded into the field, so the tap is visibly acknowledged. */
  selectedId?: string | null;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  if (!PREVIEW_SIMULATION || items.length === 0) return null;
  return (
    <View style={s.card} testID={testID}>
      <View style={s.header}>
        <Text style={s.title}>{title}</Text>
        <View style={s.tag}><Text style={s.tagText}>PREVIEW ONLY</Text></View>
      </View>
      <Text style={s.note}>{note}</Text>
      {items.map((item, i) => (
        <Pressable
          key={item.id}
          testID={`${testID}-${i}`}
          accessibilityRole="button"
          accessibilityLabel={`Check the simulated item ${item.primary}`}
          disabled={disabled}
          onPress={() => onSelect(item.id)}
          style={({ pressed }) => [s.row, item.id === selectedId && s.rowSelected, { opacity: pressed || disabled ? 0.7 : 1 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.rowPrimary} numberOfLines={1}>{item.primary}</Text>
            {item.secondary ? <Text style={s.rowSecondary} numberOfLines={2}>{item.secondary}</Text> : null}
            <Text style={s.rowProbe} numberOfLines={2}>{item.probes}</Text>
          </View>
          <Text style={{ color: item.id === selectedId ? colors.resting : colors.muted, fontFamily: fonts.textSemibold, fontSize: 13 }}>
            {item.id === selectedId ? "Selected" : "Use this"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
