// Full-screen blocking state shown by app/_layout.tsx when the security configuration is invalid
// (securityBoot.ts). Fail-closed, expressed as a controlled screen instead of an OS crash dialog.
// Nothing else mounts behind it: no providers, no navigation, no protection start-up.
import { reloadAppAsync } from "expo";
import { BackHandler, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { safeStartCopy } from "@/src/security/securityBoot";
import type { SecurityConfigurationError } from "@/src/security/securityConfig";
import { makeStyles } from "@/src/theme";

export function SafeStartScreen({ error }: { error: SecurityConfigurationError }) {
  const s = useStyles();
  const copy = safeStartCopy(error);

  const retry = async () => {
    // Configuration is baked into the build, so a retry is a full JS restart, not a re-render.
    try { await reloadAppAsync(); } catch { /* unavailable in some environments — the screen simply stays */ }
  };
  const close = () => { if (Platform.OS === "android") BackHandler.exitApp(); };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.root} testID="safe-start-screen">
        <ScrollView contentContainerStyle={s.content} bounces={false}>
          <View style={s.badge}><Text style={s.badgeText}>STOPPED</Text></View>
          <Text style={s.title} testID="safe-start-title">{copy.title}</Text>
          <Text style={s.meaning}>{copy.meaning}</Text>
          <View style={s.reasonCard}>
            <Text style={s.reasonLabel}>Why</Text>
            <Text style={s.reason} selectable testID="safe-start-reason">{copy.reason}</Text>
          </View>
          <Text style={s.guidance}>{copy.guidance}</Text>
          <Pressable onPress={retry} accessibilityRole="button" testID="safe-start-retry" style={({ pressed }) => [s.primary, pressed && s.pressed]}>
            <Text style={s.primaryText}>Try again</Text>
          </Pressable>
          {Platform.OS === "android" ? (
            <Pressable onPress={close} accessibilityRole="button" testID="safe-start-close" style={({ pressed }) => [s.secondary, pressed && s.pressed]}>
              <Text style={s.secondaryText}>Close Apollo</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 },
  badge: { alignSelf: "flex-start", backgroundColor: colors.barkingTint, borderColor: colors.barking, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { color: colors.barkingText, fontFamily: "Geist-600", fontSize: 12, letterSpacing: 1 },
  title: { color: colors.onSurface, fontFamily: "Outfit-700", fontSize: 28, lineHeight: 34 },
  meaning: { color: colors.onSurfaceSecondary, fontFamily: "Geist-400", fontSize: 16, lineHeight: 24 },
  reasonCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
  reasonLabel: { color: colors.onSurfaceSecondary, fontFamily: "Geist-600", fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" },
  reason: { color: colors.onSurface, fontFamily: "Geist-500", fontSize: 15, lineHeight: 22 },
  guidance: { color: colors.onSurfaceSecondary, fontFamily: "Geist-400", fontSize: 14, lineHeight: 21 },
  primary: { minHeight: 48, borderRadius: 14, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryText: { color: colors.onBrandPrimary, fontFamily: "Geist-600", fontSize: 16 },
  secondary: { minHeight: 48, borderRadius: 14, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.brandPrimary, fontFamily: "Geist-600", fontSize: 16 },
  pressed: { opacity: 0.85 },
}));
