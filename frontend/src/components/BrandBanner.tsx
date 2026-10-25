// The Apollo SG logo (owner's artwork, background removed). It sits on a white rounded panel so its navy
// lettering reads in both light and dark themes.
import { Image } from "expo-image";
import React from "react";
import { View } from "react-native";

import { radius, spacing } from "@/src/theme";

const LOGO = require("@/assets/images/apollo-sg-logo.png");

export function BrandBanner({ testID }: { testID?: string }) {
  return (
    <View style={{ borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#FFFFFF", alignSelf: "stretch", padding: spacing.md }} testID={testID}>
      <Image
        source={LOGO}
        style={{ width: "100%", aspectRatio: 1200 / 392 }}
        contentFit="contain"
        accessibilityLabel="Apollo SG Scam Guard"
      />
    </View>
  );
}
