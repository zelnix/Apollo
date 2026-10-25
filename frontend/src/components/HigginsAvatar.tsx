// Higgins' face: the same rounded square everywhere, placed on the left of the title it leads.
import { Image } from "expo-image";
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { makeStyles } from "@/src/theme";

const higginsFace = require("@/assets/images/higgins-avatar.png");

/** Corner radius as a share of the side, so every size reads as the same rounded square. */
export const HIGGINS_AVATAR_CORNER = 0.25;

const useStyles = makeStyles((c) => ({
  wrap: { overflow: "hidden", backgroundColor: c.surfaceTertiary, flexShrink: 0 },
}));

export function HigginsAvatar({ size = 44, style, testID }: { size?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const s = useStyles();
  return (
    <View style={[s.wrap, { width: size, height: size, borderRadius: Math.round(size * HIGGINS_AVATAR_CORNER) }, style]} testID={testID}>
      <Image source={higginsFace} style={{ width: size, height: size }} contentFit="cover" accessibilityLabel="Higgins" />
    </View>
  );
}
