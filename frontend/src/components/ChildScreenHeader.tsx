import { useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CloseButton } from "./CloseButton";
import { InfoButton, type ScreenInfo } from "./InfoButton";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { flexShrink: 1, fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  titleGroup: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexShrink: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
}));

export function ChildScreenHeader({ title, testID, leading, info }: { title: string; testID: string; leading?: React.ReactNode; info?: ScreenInfo }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.md }]} testID={testID}>
      <View style={s.titleGroup}>
        {leading}
        <Text style={s.title}>{title}</Text>
      </View>
      {/* The X is always the last icon, so it sits at the far right of every screen. */}
      <View style={s.actions}>
        {info ? <InfoButton info={info} testID={`${testID}-info`} /> : null}
        <CloseButton testID={`${testID}-close`} label={`Close ${title}`} onPress={() => goBackOrHome(router)} />
      </View>
    </View>
  );
}
