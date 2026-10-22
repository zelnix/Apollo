// Shared header for all Check tool detail screens.
// Provides: back chevron (left), title, info button (right).
// No settings gear. Consistent sizing, styling and touch targets.

import ChevronLeft from "lucide-react-native/icons/chevron-left";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { InfoButton, type ScreenInfo } from "@/src/components/InfoButton";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, spacing, useTheme } from "@/src/theme";

interface CheckToolHeaderProps {
  /** Screen title shown in the header. */
  title: string;
  /** Info popup content. Pass `undefined` to hide the info button. */
  info?: ScreenInfo;
  /** Override back behaviour (defaults to goBackOrHome). */
  onBack?: () => void;
  /** testID prefix for accessibility testing. */
  testID?: string;
}

export function CheckToolHeader({
  title,
  info,
  onBack,
  testID = "check-tool",
}: CheckToolHeaderProps) {
  const { colors } = useTheme();
  const router = useRouter();

  const handleBack = onBack ?? (() => goBackOrHome(router));

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID={`${testID}-back`}
        onPress={handleBack}
        style={styles.backBtn}
      >
        <ChevronLeft size={18} color={colors.onSurface} />
      </Pressable>

      {/* No line clamp: the title wraps rather than being cut off by the icons beside it. */}
      <Text style={[styles.title, { color: colors.onSurface }]}>
        {title}
      </Text>

      {info ? (
        <InfoButton info={info} testID={`${testID}-info`} />
      ) : (
        <View style={styles.spacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    width: "100%",
    gap: spacing.sm,
    minHeight: 48,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontFamily: fonts.displayBold,
    fontSize: 22,
    letterSpacing: -0.3,
  },
  spacer: {
    width: 44,
  },
});
