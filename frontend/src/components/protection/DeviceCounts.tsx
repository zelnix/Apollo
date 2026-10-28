// Device Protections on the Protection screen: what the device's own settings look like, as counts.
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleDashed from "lucide-react-native/icons/circle-dashed";
import CircleEllipsis from "lucide-react-native/icons/circle-ellipsis";
import Settings from "lucide-react-native/icons/settings";
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { DeviceCounts as Counts } from "@/src/protection/useProtectionPosture";
import { fonts, makeStyles, radius, spacing, useTheme, type ThemeColors } from "@/src/theme";

const COLUMNS: { key: keyof Counts; label: string; sub: string; Icon: typeof CircleCheck; color: keyof ThemeColors }[] = [
  { key: "protected", label: "Protected", sub: "Working correctly", Icon: CircleCheck, color: "resting" },
  { key: "attention", label: "Needs attention", sub: "May reduce protection", Icon: CircleAlert, color: "growling" },
  { key: "toCheck", label: "Need checking", sub: "Apollo can't confirm these yet", Icon: CircleEllipsis, color: "unknown" },
  { key: "optional", label: "Optional", sub: "Recommended extras", Icon: CircleDashed, color: "muted" },
];

const useStyles = makeStyles((c) => ({
  card: { borderRadius: radius.lg, borderWidth: 0.5, borderColor: c.border, backgroundColor: c.surfaceSecondary, overflow: "hidden" },
  columns: { flexDirection: "row", paddingVertical: spacing.md },
  column: { flex: 1, paddingHorizontal: spacing.sm, gap: 2 },
  columnDivider: { borderLeftWidth: 0.5, borderLeftColor: c.divider },
  numberRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  number: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 12, lineHeight: 16 },
  sub: { fontFamily: fonts.text, fontSize: 11, lineHeight: 15, color: c.onSurfaceSecondary },
  note: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  noteText: { flex: 1, fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  link: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md, borderTopWidth: 0.5, borderTopColor: c.divider },
  linkText: { flex: 1, fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
}));

export function DeviceCounts({ counts, read, testID }: { counts: Counts | null; read: boolean; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={s.card} testID={testID}>
      {counts ? (
        <View style={s.columns}>
          {COLUMNS.map((col, i) => (
            <View key={col.key} style={[s.column, i > 0 && s.columnDivider]} testID={`${testID}-${col.key}`}>
              <View style={s.numberRow}>
                <col.Icon size={18} color={colors[col.color]} />
                <Text style={s.number} testID={`${testID}-${col.key}-count`}>{counts[col.key]}</Text>
              </View>
              <Text style={[s.label, { color: col.key === "protected" ? colors.restingText : col.key === "attention" ? colors.growlingText : colors.onSurface }]}>{col.label}</Text>
              <Text style={s.sub}>{col.sub}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={s.note} testID={`${testID}-note`}>
          {read ? null : <ActivityIndicator size="small" color={colors.brandPrimary} />}
          <Text style={s.noteText}>
            {read ? "ApolloSG can only read your device's own settings in the app on your phone." : "Reading this device…"}
          </Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View all device protections"
        onPress={() => router.push("/device-protection")}
        style={({ pressed }) => [s.link, { backgroundColor: pressed ? colors.surfaceTertiary : "transparent" }]}
        testID={`${testID}-view-all`}
      >
        <Settings size={18} color={colors.onSurface} />
        <Text style={s.linkText}>View all device protections</Text>
        <ChevronRight size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}
