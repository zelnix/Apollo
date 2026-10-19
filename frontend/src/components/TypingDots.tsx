// Small "Higgins is typing…" indicator: three dots that fade in sequence. Pure RN Animated so it
// works everywhere without extra deps.
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { useTheme } from "@/src/theme";

export function TypingDots({ color }: { color?: string }) {
  const { colors } = useTheme();
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 320, useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots]);
  return (
    <View style={styles.row} accessibilityLabel="Higgins is typing">
      {dots.map((d, i) => (
        <Animated.View key={i} style={[styles.dot, { backgroundColor: color ?? colors.muted, opacity: d }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
