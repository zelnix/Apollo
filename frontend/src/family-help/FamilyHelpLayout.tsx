import { useRouter } from "expo-router";
import React, { type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CloseButton } from "@/src/components/CloseButton";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({ root: { flex: 1, backgroundColor: c.surface }, top: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, title: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface }, close: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceTertiary }, content: { paddingHorizontal: spacing.xl, gap: spacing.xl } }));
export function FamilyHelpLayout({ children, title = "Family Help" }: { children: ReactNode; title?: string }) {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  return <View style={s.root} testID="family-help-screen"><View style={[s.top, { paddingTop: insets.top + spacing.md }]}><Text style={s.title} testID="family-help-title">{title}</Text><CloseButton testID="family-help-close" label="Close Family Help" onPress={() => router.back()} /></View><ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing["2xl"] }]}>{children}</ScrollView></View>;
}