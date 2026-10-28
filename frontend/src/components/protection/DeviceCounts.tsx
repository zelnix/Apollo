// The device's own protections as four counts: protected, needs attention, needs checking, optional.
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleDashed from "lucide-react-native/icons/circle-dashed";
import CircleEllipsis from "lucide-react-native/icons/circle-ellipsis";
import React from "react";
import { Text, View } from "react-native";

import type { DeviceCounts as Counts } from "@/src/protection/useProtectionPosture";
import { fonts, makeStyles, radius, spacing, useTheme, type ThemeColors } from "@/src/theme";

const COLUMNS: { key: keyof Counts; label: string; sub: string; Icon: typeof CircleCheck; color: keyof ThemeColors; text: keyof ThemeColors }[] = [
  { key: "protected", label: "Protected", sub: "Working correctly", Icon: CircleCheck, color: "resting", text: "restingText" },
  { key: "attention", label: "Needs attention", sub: "May reduce protection", Icon: CircleAlert, color: "growling", text: "growlingText" },
  { key: "toCheck", label: "Need checking", sub: "Apollo can't confirm these yet", Icon: CircleEllipsis, color: "unknown", text: "onSurface" },
  { key: "optional", label: "Optional", sub: "Recommended extras", Icon: CircleDashed, color: "muted", text: "onSurface" },
];

const useStyles = makeStyles((c) => ({
  card: { flexDirection: "row", paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 0.5, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  column: { flex: 1, paddingHorizontal: spacing.sm, gap: 2 },
  columnDivider: { borderLeftWidth: 0.5, borderLeftColor: c.divider },
  numberRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  number: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 12, lineHeight: 16 },
  sub: { fontFamily: fonts.text, fontSize: 11, lineHeight: 15, color: c.onSurfaceSecondary },
}));

export function DeviceCounts({ counts, testID }: { counts: Counts; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={s.card} testID={testID}>
      {COLUMNS.map((col, i) => (
        <View key={col.key} style={[s.column, i > 0 && s.columnDivider]} testID={`${testID}-${col.key}`}>
          <View style={s.numberRow}>
            <col.Icon size={18} color={colors[col.color]} />
            <Text style={s.number} testID={`${testID}-${col.key}-count`}>{counts[col.key]}</Text>
          </View>
          <Text style={[s.label, { color: colors[col.text] }]}>{col.label}</Text>
          <Text style={s.sub}>{col.sub}</Text>
        </View>
      ))}
    </View>
  );
}
