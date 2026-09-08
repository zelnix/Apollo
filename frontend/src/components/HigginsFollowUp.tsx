// Home card: a day after Higgins suggested checks that are still not done, he mentions it once, gently, with the links.
import React from "react";
import { Text, View } from "react-native";

import { HigginsChecks } from "@/src/components/HigginsChecks";
import { Button, Card } from "@/src/components/ui";
import { followUpLine, pendingFollowUps, SNOOZE_MS } from "@/src/domain/higginsChecks";
import { useCheckCompletion } from "@/src/store/checkCompletion";
import { snoozeSuggestion, useSuggestions } from "@/src/store/higginsSuggestions";
import { fonts, makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  eyebrow: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 1, color: c.onSurfaceSecondary, textTransform: "uppercase" },
  text: { fontFamily: fonts.display, fontSize: 17, lineHeight: 24, color: c.onSurface },
  row: { flexDirection: "row", justifyContent: "flex-end" },
}));

export function HigginsFollowUp() {
  const s = useStyles();
  const suggestions = useSuggestions();
  const completed = useCheckCompletion();
  const due = pendingFollowUps(suggestions, completed);
  if (!due.length) return null;
  const { suggestion, outstanding } = due[0]; // one gentle nudge at a time
  return (
    <Card testID="higgins-followup" style={{ gap: spacing.sm }}>
      <Text style={s.eyebrow}>Higgins</Text>
      <Text style={s.text} testID="higgins-followup-text">{followUpLine(outstanding, suggestion.askedAt)}</Text>
      <HigginsChecks checks={outstanding} askedAt={suggestion.askedAt} messageId={`followup-${suggestion.messageId}`} record={false} />
      <View style={s.row}><Button testID="higgins-followup-later" variant="ghost" label="Remind me tomorrow" onPress={() => void snoozeSuggestion(suggestion.messageId, new Date(Date.now() + SNOOZE_MS).toISOString())} /></View>
    </Card>
  );
}
