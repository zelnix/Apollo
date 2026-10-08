import { useFocusEffect, useRouter } from "expo-router";
import Settings from "lucide-react-native/icons/settings";
import React, { useRef } from "react";
import { Pressable, View } from "react-native";

import { InfoButton, type ScreenInfo } from "./InfoButton";
import { ScreenHeader } from "./ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  settings: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border },
}));

export function RootScreenHeader({ title, testID, rightAccessory, info }: { title: string; testID: string; rightAccessory?: React.ReactNode; info?: ScreenInfo }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const opening = useRef(false);
  useFocusEffect(React.useCallback(() => {
    opening.current = false;
    return () => undefined;
  }, []));
  const openSettings = () => {
    if (opening.current) return;
    opening.current = true;
    router.push("/settings");
  };
  return <ScreenHeader title={title} testID={testID} right={<View style={s.actions}>{rightAccessory}{info ? <InfoButton info={info} testID={`${testID}-info`} /> : null}<Pressable testID={`${testID}-settings`} accessibilityRole="button" accessibilityLabel="Settings" accessibilityHint="Opens Apollo settings" onPress={openSettings} style={({ pressed }) => [s.settings, { opacity: pressed ? 0.75 : 1 }]}><Settings size={23} color={colors.onSurface} /></Pressable></View>} />;
}