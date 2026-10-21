// The setup progress bar — one component shared by all four setup steps, so a
// person always knows where they are and can go back.
//
// Setup is: Welcome → Privacy → Protections → First check. Nothing is hidden and
// nothing is a dead end; every step after the first can be stepped back from.

import ChevronLeft from "lucide-react-native/icons/chevron-left";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export const SETUP_STEPS = ["Welcome", "Privacy", "Protections", "First check"] as const;
export type SetupStep = 1 | 2 | 3 | 4;

const useStyles = makeStyles((c) => ({
  root: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -spacing.md },
  // A fixed-width placeholder keeps the segments in the same place whether or not
  // this step can be stepped back from.
  backSpacer: { width: 44 - spacing.md, height: 44 },
  track: { flex: 1, flexDirection: "row", gap: 6 },
  segment: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  segmentDone: { backgroundColor: c.navyTintStrong },
  segmentNow: { backgroundColor: c.brandPrimary },
  label: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted, paddingLeft: 44 - spacing.md + spacing.sm },
}));

export function SetupProgress({ step, onBack, testID = "setup-progress" }: {
  step: SetupStep;
  /** Omit on the first step — there is nowhere to go back to. */
  onBack?: () => void;
  testID?: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={s.root} testID={testID}>
      <View style={s.row}>
        {onBack ? (
          <Pressable testID={`${testID}-back`} accessibilityRole="button" accessibilityLabel="Back a step" hitSlop={8} onPress={onBack} style={s.back}>
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
        ) : <View style={s.backSpacer} />}
        <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: SETUP_STEPS.length, now: step }}>
          {SETUP_STEPS.map((name, index) => (
            <View key={name} style={[s.segment, index < step - 1 && s.segmentDone, index === step - 1 && s.segmentNow]} testID={`${testID}-segment-${index + 1}`} />
          ))}
        </View>
      </View>
      <Text style={s.label} testID={`${testID}-label`}>{`Step ${step} of ${SETUP_STEPS.length} · ${SETUP_STEPS[step - 1]}`}</Text>
    </View>
  );
}
