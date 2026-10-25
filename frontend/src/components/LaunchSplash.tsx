// Full-screen ApolloSG launch artwork on phones. Android 12+ and iOS draw only a small centred icon in the
// native splash, so the owner's full portrait artwork is shown here, straight after the native splash, then
// fades away. Tablets and wide windows keep the native splash only.
import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

const ARTWORK = require("@/assets/images/splash-full.webp");
// The artwork's own white, so the edges around it are invisible in light and dark themes alike.
const ARTWORK_WHITE = "#FFFFFF";
const SHOW_MS = 1800;
const FADE_MS = 400;

export function LaunchSplash() {
  const { width, height } = useWindowDimensions();
  const isPhone = Math.min(width, height) < 600;
  const [visible, setVisible] = useState(isPhone);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!visible) return;
    opacity.value = withDelay(SHOW_MS, withTiming(0, { duration: FADE_MS }, (done) => { if (done) runOnJS(setVisible)(false); }));
  }, [visible, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!visible) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.root, fade]} pointerEvents="none" testID="launch-splash">
      <Image source={ARTWORK} style={s.art} contentFit="contain" accessibilityLabel="ApolloSG Scam Guard. Better Protection. Safer You. Safer Tomorrows." />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { backgroundColor: ARTWORK_WHITE, zIndex: 1000, elevation: 1000 },
  art: { flex: 1, width: "100%" },
});
