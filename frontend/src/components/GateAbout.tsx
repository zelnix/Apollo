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
}));

export function GateAbout({
  title,
  sheetTitle,
  control,
  children,
  testID,
}: {
  title: string;
  sheetTitle?: string;
  control?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: spacing.sm }} testID={testID}>
      <View style={s.row}>
        <Text style={s.title}>{title}</Text>
        {control ?? null}
      </View>
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => setOpen(true)}
        testID={testID ? `${testID}-more` : "gate-about-more"}
      >
        <Text style={s.link}>Find out more</Text>
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={sheetTitle ?? title}
        testID={testID ? `${testID}-sheet` : undefined}
      >
        {children}
      </Sheet>
    </Card>
  );
}
