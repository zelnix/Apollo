// Compact "about this check" header used at the top of the check screens. Instead of a wordy
// paragraph, it shows a short title and a "Find out more" link that opens a popup with the detail.
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Card } from "@/src/components/ui";
import { Sheet } from "@/src/components/Sheet";
import { fonts, makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  title: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
  link: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brandPrimary },
  tip: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
    gap: spacing.xs,
  },
  tipLabel: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.warning, letterSpacing: 0.3 },
  tipBody: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
}));

export function GateAbout({
  title,
  sheetTitle,
  control,
  children,
  tip,
  testID,
}: {
  title: string;
  sheetTitle?: string;
  control?: React.ReactNode;
  children: React.ReactNode;
  /** Short "what to look for" example shown at the bottom of the popup. */
  tip?: React.ReactNode;
  testID?: string;
}) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: spacing.sm }} testID={testID}>
      <View style={s.row}>
        <Pressable
          accessibilityRole="button"
          style={{ flex: 1 }}
          onPress={() => setOpen(true)}
          testID={testID ? `${testID}-more` : "gate-about-more"}
        >
          <Text style={s.title}>{title}</Text>
        </Pressable>
        {control ?? null}
      </View>
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => setOpen(true)}
        testID={testID ? `${testID}-more-link` : "gate-about-more-link"}
      >
        <Text style={s.link}>Find out more ›</Text>
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={sheetTitle ?? title}
        testID={testID ? `${testID}-sheet` : undefined}
      >
        {children}
        {tip ? (
          <View style={s.tip} testID={testID ? `${testID}-tip` : undefined}>
            <Text style={s.tipLabel}>WHAT TO LOOK FOR</Text>
            <Text style={s.tipBody}>{tip}</Text>
          </View>
        ) : null}
      </Sheet>
    </Card>
  );
}
