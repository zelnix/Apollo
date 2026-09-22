import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({ root: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 28, color: c.onSurface }, close: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" } }));
export function ChildScreenHeader({ title, testID }: { title: string; testID: string }) { const s = useStyles(); const insets = useSafeAreaInsets(); const router = useRouter(); const { colors } = useTheme(); return <View style={[s.root, { paddingTop: insets.top + spacing.md }]} testID={testID}><Text style={s.title}>{title}</Text><Pressable testID={`${testID}-close`} accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={() => goBackOrHome(router)} style={s.close}><X size={22} color={colors.onSurface} /></Pressable></View>; }