import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import React, { useRef } from "react";
import { Pressable, Text, View } from "react-native";

import type { AppDestinationAction as DestinationAction } from "@/src/domain/appDestination";
import { safeDestinationParams } from "@/src/domain/appDestination";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.brand, backgroundColor: c.surfaceSecondary },
  label: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
  purpose: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary, marginTop: 2 },
}));

export function AppDestinationAction({ action, testID, onBeforeNavigate }: { action: DestinationAction; testID: string; onBeforeNavigate?: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const navigating = useRef(false);
  const activate = () => {
    if (navigating.current) return;
    navigating.current = true;
    onBeforeNavigate?.();
    const params = safeDestinationParams(action.context);
    requestAnimationFrame(() => router.push(Object.keys(params).length ? { pathname: action.route as never, params } : action.route as never));
  };
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={action.label} accessibilityHint={action.purpose} onPress={activate} style={({ pressed }) => [s.row, { opacity: pressed ? 0.8 : 1 }]}><View style={{ flex: 1 }}><Text style={s.label}>{action.label}</Text><Text style={s.purpose}>{action.purpose}</Text></View><ChevronRight size={21} color={colors.brand} /></Pressable>;
}