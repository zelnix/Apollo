// Same Number Reminder card: shown above today's result when the same number was checked, or a case was about it,
// in the last 30 days. Says when, what Apollo said then, and opens the earlier case when there is one.
import { useRouter } from "expo-router";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import React from "react";
import { Text, View } from "react-native";

import { Button, Pill } from "@/src/components/ui";
import { resultChip } from "@/src/domain/messageVoice";
import { daysAgo, REMINDER_DAYS, reminderTitle, type EarlierCheck } from "@/src/domain/sameNumber";
import { formatDateTime } from "@/src/domain/threatCase";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 0.25, borderColor: c.border, padding: spacing.md, gap: spacing.md },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  badge: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.sniffingTint, alignItems: "center", justifyContent: "center" },
  headingWrap: { flex: 1, gap: 2 },
  heading: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  when: { fontFamily: fonts.text, fontSize: 14, color: c.muted },
  result: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  resultLabel: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurfaceSecondary },
  resultText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
}));

export function SameNumberReminder({ earlier, testID }: { earlier: EarlierCheck; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const eventId = earlier.eventId;
  return (
    <View style={s.card} testID={testID} accessibilityRole="summary">
      <View style={s.top}>
        <View style={s.badge}><RotateCcw size={22} color={colors.sniffingText} /></View>
        <View style={s.headingWrap}>
          <Text style={s.heading} testID={`${testID}-title`}>{reminderTitle(earlier)}</Text>
          <Text style={s.when} testID={`${testID}-when`}>{`${formatDateTime(earlier.at)} · ${daysAgo(earlier.at, Date.now())}`}</Text>
        </View>
      </View>
      <View style={s.result}>
        <Text style={s.resultLabel}>What Apollo said then</Text>
        <Text style={s.resultText} numberOfLines={3} testID={`${testID}-summary`}>{earlier.summary}</Text>
        <Pill tone={earlier.state} label={resultChip(earlier.state)} testID={`${testID}-state`} style={{ alignSelf: "flex-start" }} />
      </View>
      {earlier.count > 1 ? (
        <Text style={s.meta} testID={`${testID}-count`}>{`Seen ${earlier.count} times in the last ${REMINDER_DAYS} days.`}</Text>
      ) : null}
      <Text style={s.meta}>Today’s check is below. It can differ from before if new reports have come in.</Text>
      {eventId ? (
        <Button testID={`${testID}-open`} variant="secondary" label="View the earlier case"
          onPress={() => router.push({ pathname: "/patrol/[id]", params: { id: eventId } })} />
      ) : null}
    </View>
  );
}
