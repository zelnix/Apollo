import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, flex: 1 },
  section: { paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  body: { fontFamily: fonts.text, fontSize: 14, lineHeight: 22, color: c.onSurfaceSecondary },
  principleRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start", paddingVertical: spacing.sm },
  principleIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(16,185,129,0.1)", alignItems: "center", justifyContent: "center", marginTop: 2 },
  principleText: { flex: 1 },
  principleTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  principleDesc: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
}));

const PRINCIPLES = [
  { title: "Local-first processing", desc: "Apollo processes your data on-device whenever possible. Your messages, calls and personal information stay on your phone." },
  { title: "No data selling", desc: "We never sell, share or monetise your personal data. Apollo exists to protect you, not to profit from your information." },
  { title: "Minimal data collection", desc: "When AI analysis is needed, Apollo sends only the minimum required data. Personal details are redacted before any external call." },
  { title: "Transparent AI usage", desc: "When Apollo uses Google Gemini for analysis, we tell you. You can see what was sent and what came back in the Magnum DI record." },
  { title: "Your data, your control", desc: "You can export or delete your data at any time. Uninstalling Apollo removes all local data from your device." },
];

export default function Privacy() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={s.root} testID="privacy-screen">
      <View style={{ paddingTop: insets.top }}>
        <View style={s.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="privacy-back"
            onPress={() => goBackOrHome(router)}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle}>Privacy</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
        <View style={s.section}>
          <Text style={s.body}>
            Your privacy is at the heart of everything Apollo does. Here are the principles that guide how we handle your data.
          </Text>
        </View>
        <View style={s.section}>
          <Text style={s.sectionTitle}>Our Privacy Principles</Text>
          {PRINCIPLES.map((p) => (
            <View key={p.title} style={s.principleRow}>
              <View style={s.principleIcon}>
                <ShieldCheck size={16} color="#10B981" />
              </View>
              <View style={s.principleText}>
                <Text style={s.principleTitle}>{p.title}</Text>
                <Text style={s.principleDesc}>{p.desc}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={s.section}>
          <Text style={s.sectionTitle}>Data Processing</Text>
          <Text style={s.body}>
            When Apollo uses Google Gemini for scam analysis, it operates under Google's published Gemini API terms. Apollo does not control Google's internal retention practices. Apollo's own request-scoped processing copies are closed after completion.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
