import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppMenuButton } from "@/src/components/AppMenu";
import { Image } from "expo-image";

import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, flex: 1 },
  section: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  body: { fontFamily: fonts.text, fontSize: 14, lineHeight: 22, color: c.onSurfaceSecondary },
  version: { fontFamily: fonts.text, fontSize: 12, color: c.muted, textAlign: "center", marginTop: spacing.xl },
}));

export default function About() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={s.root} testID="about-screen">
      <View style={{ paddingTop: insets.top }}>
        <View style={s.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="about-back"
            onPress={() => goBackOrHome(router)}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle}>About Apollo</Text>
          <AppMenuButton testID="about-menu" />
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"], gap: spacing.lg }}>
        <View style={{ alignItems: "center", paddingVertical: spacing.xl }}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: 80, height: 80 }}
            contentFit="contain"
          />
        </View>
        <View style={s.section}>
          <Text style={s.title}>Apollo SG</Text>
          <Text style={s.body}>
            Apollo is your personal scam protection companion. With Higgins by your side, Apollo watches over your digital life — checking messages, calls, emails and websites for scams and threats.
          </Text>
          <Text style={s.body}>
            Apollo operates locally on your device whenever possible, keeping your personal information private. When AI analysis is needed, Apollo uses Google Gemini with strict privacy controls.
          </Text>
          <Text style={s.body}>
            Built to protect people from the rising tide of scams and online fraud. Better protection. Safer you. Safer tomorrows.
          </Text>
        </View>
        <Text style={s.version}>Version 1.0.0</Text>
      </ScrollView>
    </View>
  );
}
