// "What does this mean?" beside an investigation result: opens How Apollo checks at the results section,
// with this result highlighted.
import { useRouter } from "expo-router";
import CircleQuestionMark from "lucide-react-native/icons/circle-question-mark";
import React from "react";
import { Pressable, Text } from "react-native";

import { outcomeLabel } from "@/src/domain/messageVoice";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  link: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 44, paddingVertical: spacing.xs },
  text: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brandPrimary },
}));

export function OutcomeExplainerLink({ outcome, testID = "outcome-explainer-link" }: { outcome: string | null | undefined; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const label = outcomeLabel(outcome);
  if (!outcome || !label) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`What does ${label} mean?`}
      hitSlop={8}
      testID={testID}
      onPress={() => router.push({ pathname: "/how-apollo-checks", params: { outcome } })}
      style={({ pressed }) => [s.link, { opacity: pressed ? 0.7 : 1 }]}
    >
      <CircleQuestionMark size={15} color={colors.brandPrimary} />
      <Text style={s.text}>What does this mean?</Text>
    </Pressable>
  );
}
