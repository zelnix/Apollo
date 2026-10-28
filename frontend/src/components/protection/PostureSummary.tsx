// "Your protection": the one overall answer from the Protection Posture engine, with its fixed reason.
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import ShieldQuestionMark from "lucide-react-native/icons/shield-question-mark";
import ShieldX from "lucide-react-native/icons/shield-x";
import React from "react";
import { Text, View } from "react-native";

import type { PostureStatus, ProtectionPosture } from "@/src/domain/protectionPosture";
import { fonts, makeStyles, spacing, useTheme, type ThemeColors } from "@/src/theme";

export function postureColors(status: PostureStatus, c: ThemeColors) {
  switch (status) {
    case "well": case "mostly": return { text: c.restingText, icon: c.resting, wash: c.restingWash, tint: c.restingTint };
    case "reduced": return { text: c.growlingText, icon: c.growling, wash: c.growlingWash, tint: c.growlingTint };
    case "at_risk": return { text: c.bitingText, icon: c.biting, wash: c.bitingWash, tint: c.bitingTint };
    default: return { text: c.unknownText, icon: c.unknown, wash: c.unknownWash, tint: c.unknownTint };
  }
}

const ICON: Record<PostureStatus, typeof ShieldCheck> = { well: ShieldCheck, mostly: ShieldCheck, reduced: ShieldAlert, at_risk: ShieldX, unknown: ShieldQuestionMark };

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  well: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  body: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurfaceSecondary },
  title: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28 },
  reason: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary, marginTop: 2 },
}));

export function PostureSummary({ posture, reasonLines, right, testID }: {
  posture: ProtectionPosture; reasonLines?: number; right?: React.ReactNode; testID: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const palette = postureColors(posture.status, colors);
  const Icon = ICON[posture.status];
  return (
    <View style={s.row} testID={testID}>
      <View style={[s.well, { borderWidth: 1, borderColor: palette.tint }]}>
        <Icon size={24} color={palette.icon} />
      </View>
      <View style={s.body}>
        <Text style={s.label}>Your protection</Text>
        <Text style={[s.title, { color: palette.text }]} numberOfLines={2} testID={`${testID}-title`}>{posture.title}</Text>
        <Text style={s.reason} numberOfLines={reasonLines} testID={`${testID}-reason`}>{posture.reason}</Text>
      </View>
      {right}
    </View>
  );
}
