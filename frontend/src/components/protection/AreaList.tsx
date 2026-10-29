// The Protection screen's category lists — Apollo's protection areas and the device's own — one row each with
// its status pill and a short note (who covers it, or how many issues / items to check).
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Globe from "lucide-react-native/icons/globe";
import Grid2x2 from "lucide-react-native/icons/grid-2x2";
import KeyRound from "lucide-react-native/icons/key-round";
import Lock from "lucide-react-native/icons/lock";
import Mail from "lucide-react-native/icons/mail";
import MapPin from "lucide-react-native/icons/map-pin";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Wifi from "lucide-react-native/icons/wifi";
import React from "react";
import { Pressable, Text, View } from "react-native";

import type { DeviceAreaStatus, ProtectionArea } from "@/src/domain/deviceProtectionTypes";
import type { AreaStatus } from "@/src/domain/protectionPosture";
import type { ProtectionAreaId } from "@/src/domain/protectionAreas";
import { fonts, makeStyles, radius, spacing, useTheme, type ThemeColors } from "@/src/theme";

export type ListStatus = AreaStatus | DeviceAreaStatus;
export interface StatusListRow { id: string; title: string; description: string; status: ListStatus; label: string; note: string }
interface RowIcon { Icon: typeof Globe; fg: keyof ThemeColors; bg: keyof ThemeColors }

export const APOLLO_AREA_ICONS: Record<ProtectionAreaId, RowIcon> = {
  websites_links: { Icon: Globe, fg: "groupAccounts", bg: "groupAccountsTint" },
  email_accounts: { Icon: Mail, fg: "biting", bg: "bitingTint" },
  messages_calls: { Icon: MessageSquare, fg: "groupData", bg: "groupDataTint" },
  device_internet: { Icon: Wifi, fg: "groupProtection", bg: "groupProtectionTint" },
  apps_files: { Icon: Grid2x2, fg: "groupAlerts", bg: "groupAlertsTint" },
};

export const DEVICE_AREA_ICONS: Record<ProtectionArea, RowIcon> = {
  calls_messages: { Icon: Phone, fg: "biting", bg: "bitingTint" },
  apps: { Icon: Grid2x2, fg: "groupAlerts", bg: "groupAlertsTint" },
  privacy: { Icon: KeyRound, fg: "groupData", bg: "groupDataTint" },
  web: { Icon: Globe, fg: "groupAccounts", bg: "groupAccountsTint" },
  access: { Icon: Lock, fg: "groupProtection", bg: "groupProtectionTint" },
  updates: { Icon: RefreshCw, fg: "groupAccounts", bg: "groupAccountsTint" },
  recovery: { Icon: MapPin, fg: "groupProtection", bg: "groupProtectionTint" },
};

function statusColors(status: ListStatus, c: ThemeColors) {
  switch (status) {
    case "at_risk": return { dot: c.biting, bg: c.bitingTint, text: c.bitingText };
    case "attention": return { dot: c.growling, bg: c.growlingTint, text: c.growlingText };
    case "check": return { dot: c.gold, bg: c.goldTint, text: c.onSurface };
    case "unconfirmed": return { dot: c.brand, bg: c.unknownTint, text: c.onSurface };
    case "protected": return { dot: c.resting, bg: c.restingTint, text: c.restingText };
    case "ready": return { dot: c.brand, bg: c.navyTint, text: c.onSurface };
    case "optional": return { dot: c.muted, bg: c.unknownTint, text: c.onSurfaceSecondary };
    default: return { dot: c.muted, bg: c.unknownTint, text: c.unknownText };
  }
}

const useStyles = makeStyles((c) => ({
  card: { borderRadius: radius.lg, borderWidth: 0.5, borderColor: c.border, backgroundColor: c.surfaceSecondary, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 56 },
  divider: { borderTopWidth: 0.5, borderTopColor: c.divider },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 20, color: c.onSurface },
  descRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  desc: { flex: 1, fontFamily: fonts.text, fontSize: 12, lineHeight: 16, color: c.onSurfaceSecondary },
  status: { alignItems: "flex-end", gap: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: fonts.textSemibold, fontSize: 11, flexShrink: 1 },
  note: { fontFamily: fonts.text, fontSize: 10, color: c.onSurfaceSecondary, textAlign: "right" },
}));

export function AreaList({ rows, icons, onOpen, testID }: {
  rows: StatusListRow[]; icons: Record<string, RowIcon>; onOpen: (id: string) => void; testID: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={s.card} testID={testID}>
      {rows.map((row, i) => {
        const icon = icons[row.id];
        const palette = statusColors(row.status, colors);
        const id = `${testID}-${row.id}`;
        return (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`${row.title}. ${row.label}, ${row.note}.`}
            onPress={() => onOpen(row.id)}
            style={({ pressed }) => [s.row, i > 0 && s.divider, { backgroundColor: pressed ? colors.surfaceTertiary : "transparent" }]}
            testID={id}
          >
            <View style={[s.icon, { backgroundColor: colors[icon.bg] }]}>
              <icon.Icon size={18} color={colors[icon.fg]} />
            </View>
            <View style={s.body}>
              <View style={s.titleRow}>
                <Text style={s.title} numberOfLines={1}>{row.title}</Text>
                <View style={s.status}>
                  <View style={[s.pill, { backgroundColor: palette.bg }]}>
                    <View style={[s.dot, { backgroundColor: palette.dot }]} />
                    <Text style={[s.pillText, { color: palette.text }]} numberOfLines={1} testID={`${id}-status`}>{row.label}</Text>
                  </View>
                </View>
              </View>
              <View style={s.descRow}>
                <Text style={s.desc} numberOfLines={2}>{row.description}</Text>
                <Text style={s.note} testID={`${id}-note`}>{row.note}</Text>
              </View>
            </View>
            <ChevronRight size={16} color={colors.muted} />
          </Pressable>
        );
      })}
    </View>
  );
}
