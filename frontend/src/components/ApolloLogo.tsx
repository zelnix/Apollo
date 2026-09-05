import { Image } from "expo-image";
import React from "react";

/** Apollo brand mark (shield + guard dog). Source: assets/images/logo.png. */
export function ApolloLogo({ size = 40, testID = "apollo-logo" }: { size?: number; testID?: string }) {
  return <Image testID={testID} source={require("../../assets/images/logo.png")} style={{ width: size, height: size, borderRadius: size * 0.22 }} contentFit="cover" accessibilityLabel="Apollo logo" />;
}
