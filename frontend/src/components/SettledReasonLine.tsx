// One plain sentence under a finished result naming the rule that settled it, e.g. "Settled by TC FlyBy —
// Known scam, every step: …". Tapping it opens the rule book at the settling rules. Hidden when the person
// turned it off in Settings, and when the case's record doesn't say (never guessed).
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, Text } from "react-native";

import type { SettledReason } from "@/src/investigation/types";
import { useShowResultReasons } from "@/src/store/resultReasonsStore";
import { fonts, makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  wrap: { minHeight: 44, justifyContent: "center", paddingVertical: spacing.xs },
  text: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  link: { fontFamily: fonts.textSemibold, color: c.brandPrimary },
}));

export function SettledReasonLine({ reason, testID = "settled-reason" }: { reason: Pick<SettledReason, "sentence"> | null | undefined; testID?: string }) {
  const s = useStyles();
  const router = useRouter();
  const show = useShowResultReasons();
  if (!reason?.sentence || !show) return null;
  return (
    <Pressable accessibilityRole="link" accessibilityHint="Opens the rule book at this rule" testID={testID} style={({ pressed }) => [s.wrap, { opacity: pressed ? 0.7 : 1 }]}
      onPress={() => router.push({ pathname: "/settings/rule-book", params: { section: "settling-rules" } })}>
      <Text style={s.text}>{reason.sentence} <Text style={s.link}>See the rule</Text></Text>
    </Pressable>
  );
}
