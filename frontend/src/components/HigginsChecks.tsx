// Chips under a Higgins reply: the checks he asked for, as links, with completion tracked since he asked.
import Check from "lucide-react-native/icons/check";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { Pressable, Text, View } from "react-native";

import { CHECKS, isDone, progressLine, type CheckId } from "@/src/domain/higginsChecks";
import { useCheckCompletion } from "@/src/store/checkCompletion";
import { recordSuggestion } from "@/src/store/higginsSuggestions";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  wrap: { gap: spacing.sm, marginTop: spacing.sm },
  title: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurfaceSecondary, letterSpacing: 0.4, textTransform: "uppercase" },
  chip: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.brand, backgroundColor: c.surfaceSecondary },
  chipDone: { borderColor: c.resting, backgroundColor: c.restingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface },
  where: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  doneText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.restingText },
  progress: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
}));

export function HigginsChecks({ checks, askedAt, messageId, record = true, title = "Higgins suggests" }: { checks: CheckId[]; askedAt: string; messageId: string; /** Remember this suggestion so Higgins can follow up a day later (off for follow-up cards and the Home hero). */ record?: boolean; title?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const completed = useCheckCompletion();
  useEffect(() => { if (record && checks.length) void recordSuggestion(messageId, askedAt, checks); }, [record, messageId, askedAt, checks]);
  if (!checks.length) return null;
  const done = checks.filter((c) => isDone(completed[c], askedAt)).length;
  return (
    <View style={s.wrap} testID={`higgins-checks-${messageId}`}>
      <Text style={s.title}>{title}</Text>
      {checks.map((c) => {
        const d = isDone(completed[c], askedAt);
        return (
          <Pressable key={c} testID={`higgins-check-${c}`} accessibilityRole="link" accessibilityState={{ checked: d }} onPress={() => router.push(CHECKS[c].route as never)} style={[s.chip, d && s.chipDone]}>
            {d ? <Check size={18} color={colors.resting} /> : <ChevronRight size={18} color={colors.brand} />}
            <View style={{ flex: 1 }}><Text style={s.chipText}>{CHECKS[c].label}</Text><Text style={s.where}>{CHECKS[c].where}</Text></View>
            {d ? <Text style={s.doneText} testID={`higgins-check-${c}-done`}>Done</Text> : null}
          </Pressable>
        );
      })}
      <Text style={s.progress} testID={`higgins-checks-progress-${messageId}`}>{progressLine(done, checks.length)}</Text>
    </View>
  );
}
