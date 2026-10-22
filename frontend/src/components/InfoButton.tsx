// Reusable "ⓘ" button: shows a small info icon that opens a popup (Sheet) with the full explanatory
// text. Lets every screen show just a title + icon instead of a long paragraph. Pass `info` to
// RootScreenHeader / ChildScreenHeader, or drop <InfoButton/> anywhere.
import Info from "lucide-react-native/icons/info";
import React, { useState } from "react";
import { Pressable, Text } from "react-native";

import { Sheet } from "./Sheet";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export interface ScreenInfo { title: string; body: string | string[] }

const useStyles = makeStyles((c) => ({
  // Icon sits flush with the right edge of its 44pt touch target so it lines up at the far right of headers.
  button: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "flex-end", justifyContent: "center" },
  paragraph: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
}));

export function InfoButton({ info, testID }: { info: ScreenInfo; testID?: string }) {
  const s = useStyles(); const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const paragraphs = Array.isArray(info.body) ? info.body : [info.body];
  return (
    <>
      <Pressable testID={testID ?? "screen-info-button"} accessibilityRole="button" accessibilityLabel={`About ${info.title}`} onPress={() => setOpen(true)} style={({ pressed }) => [s.button, { opacity: pressed ? 0.75 : 1 }]}>
        <Info size={17} color={colors.onSurfaceSecondary} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={info.title} testID={`${testID ?? "screen-info"}-sheet`}>
        {paragraphs.map((p, i) => <Text key={i} style={s.paragraph}>{p}</Text>)}
      </Sheet>
    </>
  );
}
