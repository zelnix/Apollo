// The Apollo SG banner (owner's artwork). Its own white background is part of the artwork, so it sits on a
// white rounded panel in both light and dark themes.
import { Image } from "expo-image";
import React from "react";
import { View } from "react-native";

import { radius } from "@/src/theme";

const BANNER = require("@/assets/images/apollo_sg_banner.jpg");

export function BrandBanner({ testID }: { testID?: string }) {
  return (
    <View style={{ borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#FFFFFF", alignSelf: "stretch" }} testID={testID}>
      <Image
        source={BANNER}
        style={{ width: "100%", aspectRatio: 1200 / 408 }}
        contentFit="contain"
        accessibilityLabel="Apollo SG Scam Guard. Better Protection. Safer You. Safer Tomorrows."
      />
    </View>
  );
}
