// Apollo Protections on the Protection screen: one row per protection area, its status and who covers it.
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Globe from "lucide-react-native/icons/globe";
import Grid2x2 from "lucide-react-native/icons/grid-2x2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Wifi from "lucide-react-native/icons/wifi";
import React from "react";
import { Pressable, Text, View } from "react-native";

import type { AreaRow, AreaStatus } from "@/src/domain/protectionPosture";
import type { ProtectionAreaId } from "@/src/domain/protectionAreas";
import { fonts, makeStyles, radius, spacing, useTheme, type ThemeColors } from "@/src/theme";

const AREA_ICON: Record<ProtectionAreaId, { Icon: typeof Globe; fg: keyof ThemeColors; bg: keyof ThemeColors }> = {
  websites_links: { Icon: Globe, fg: "groupAccounts", bg: "groupAccountsTint" },
  email_accounts: { Icon: Mail, fg: "biting", bg: "bitingTint" },
  messages_calls: { Icon: MessageSquare, fg: "groupData", bg: "groupDataTint" },
  device_internet: { Icon: Wifi, fg: "groupProtection", bg: "groupProtectionTint" },
  apps_files: { Icon: Grid2x2, fg: "groupAlerts", bg: "groupAlertsTint" },
};

export function areaStatusColors(status: AreaStatus, c: ThemeColors) {
  switch (status) {
    case "at_risk": return { dot: c.biting, bg: c.bitingTint, text: c.bitingText };
    case "attention": return { dot: c.growling, bg: c.growlingTint, text: c.growlingText };
    case "check": return { dot: c.gold, bg: c.goldTint, text: c.onSurface };
    case "protected": return { dot: c.resting, bg: c.restingTint, text: c.restingText };
    case "ready": return { dot: c.brand, bg: c.navyTint, text: c.onSurface };
    default: return { dot: c.muted, bg: c.unknownTint, text: c.unknownText };
  }
}

const useStyles = makeStyles((c) => ({
  card: { borderRadius: radius.lg, borderWidth: 0.5, borderColor: c.border, backgroundColor: c.surfaceSecondary, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, minHeight: 64 },
  divider: { borderTopWidth: 0.5, borderTopColor: c.divider },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 20, color: c.onSurface },
  desc: { fontFamily: fonts.text, fontSize: 12.5, lineHeight: 17, color: c.onSurfaceSecondary },
  status: { alignItems: "flex-end", gap: 3, maxWidth: 132 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontFamily: fonts.textSemibold, fontSize: 12, flexShrink: 1 },
  note: { fontFamily: fonts.text, fontSize: 11, color: c.onSurfaceSecondary, textAlign: "right" },
}));

export function AreaList({ rows, testID }: { rows: AreaRow[]; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={s.card} testID={testID}>
      {rows.map((row, i) => {
        const icon = AREA_ICON[row.id];
        const palette = areaStatusColors(row.status, colors);
        const id = `${testID}-${row.id}`;
        return (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`${row.title}. ${row.label}, ${row.note}.`}
            onPress={() => router.push(`/protection-details?category=${row.id}` as never)}
            style={({ pressed }) => [s.row, i > 0 && s.divider, { backgroundColor: pressed ? colors.surfaceTertiary : "transparent" }]}
            testID={id}
          >
            <View style={[s.icon, { backgroundColor: colors[icon.bg] }]}>
              <icon.Icon size={20} color={colors[icon.fg]} />
            </View>
            <View style={s.body}>
              <Text style={s.title}>{row.title}</Text>
              <Text style={s.desc}>{row.description}</Text>
            </View>
            <View style={s.status}>
              <View style={[s.pill, { backgroundColor: palette.bg }]}>
                <View style={[s.dot, { backgroundColor: palette.dot }]} />
                <Text style={[s.pillText, { color: palette.text }]} numberOfLines={1} testID={`${id}-status`}>{row.label}</Text>
              </View>
              <Text style={s.note} testID={`${id}-note`}>{row.note}</Text>
            </View>
            <ChevronRight size={18} color={colors.muted} />
          </Pressable>
        );
      })}
    </View>
  );
}
