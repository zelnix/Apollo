// Toast mounted at the root so it never sits under the tab bar.

import React from "react";
import { Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { toneColor } from "./ui";

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", left: spacing.lg, right: spacing.lg, alignItems: "center" },
  toast: { backgroundColor: c.surfaceTertiary, borderColor: c.borderStrong, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, flexDirection: "row", gap: spacing.sm, alignItems: "center", maxWidth: 520 },
  text: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface, flexShrink: 1 },
  bar: { width: 4, alignSelf: "stretch", borderRadius: 2 },
}));

export function ToastHost() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useApollo();
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={[s.wrap, { top: insets.top + spacing.sm }]}>
      <Animated.View entering={FadeInUp} exiting={FadeOutUp} style={s.toast} testID="toast">
        <View style={[s.bar, { backgroundColor: toneColor(colors, toast.tone) }]} />
        <Text style={s.text}>{toast.message}</Text>
      </Animated.View>
    </View>
  );
}
