// Ask Higgins only: a quiet, dismissible note that a stopped Magnum DI investigation can now be resubmitted.
// Not a pop-up — it sits in the screen above the conversation and disappears once it is opened or dismissed.
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import X from "lucide-react-native/icons/x";
import React from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import type { StoppedCase } from "@/src/investigation/resubmit";
import { dismissStopped, useDueResubmitReminder } from "@/src/store/resubmitReminderStore";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: c.goldTint,
    borderColor: c.goldBorder, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs },
  body: { flex: 1, minHeight: 44, justifyContent: "center", gap: 2 },
  title: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  detail: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  open: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: c.surface, borderWidth: 1, borderColor: c.goldBorder, justifyContent: "center" },
  openText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
}));

export function ResubmitReminder({ openCaseId, disabled, onOpen }: { openCaseId: string | null; disabled?: boolean; onOpen: (stopped: StoppedCase) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const due = useDueResubmitReminder(openCaseId);
  if (!due) return null;
  const open = () => { if (disabled) return; void dismissStopped(due.caseId); onOpen(due); };
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={s.card} testID="resubmit-reminder">
      <RotateCcw size={18} color={colors.gold} />
      <Pressable style={s.body} onPress={open} disabled={disabled} accessibilityRole="button" accessibilityLabel="Open the investigation that can be resubmitted">
        <Text style={s.title}>Ready to resubmit</Text>
        <Text style={s.detail}>An investigation that stopped can go to Magnum DI again. Everything you submitted is kept.</Text>
      </Pressable>
      <Pressable style={[s.open, disabled && { opacity: 0.5 }]} onPress={open} disabled={disabled} testID="resubmit-reminder-open" accessibilityRole="button" accessibilityLabel="Open">
        <Text style={s.openText}>Open</Text>
      </Pressable>
      <Pressable style={s.close} onPress={() => void dismissStopped(due.caseId)} testID="resubmit-reminder-dismiss" accessibilityRole="button" accessibilityLabel="Dismiss reminder">
        <X size={18} color={colors.muted} />
      </Pressable>
    </Animated.View>
  );
}
