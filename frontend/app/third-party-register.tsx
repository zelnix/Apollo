// HWG Third-Party Service Register — accessible from Settings → Privacy.
// Displays the verified register of all external services Apollo uses,
// categorised as active, optional or unconfigured.

import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React from "react";
import { ScrollView, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Card, SectionTitle } from "@/src/components/ui";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { THIRD_PARTY_REGISTER, THIRD_PARTY_SERVICES_DISCLOSURE } from "@/src/domain/privacyInventory";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface, flex: 1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  svcItem: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  svcName: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  svcPurpose: { fontFamily: fonts.textMedium, fontSize: 13, color: c.growlingText },
  svcDetail: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  statusBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  statusText: { fontFamily: fonts.textMedium, fontSize: 11 },
  footer: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.muted },
}));

export default function ThirdPartyRegisterScreen() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <View style={s.root} testID="third-party-register-screen">
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title} testID="register-title">{THIRD_PARTY_REGISTER.title}</Text>
        <Pressable testID="register-close" accessibilityRole="button" accessibilityLabel="Close" onPress={() => goBackOrHome(router)} style={s.close}>
          <X size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="register-scroll">
        <Card testID="register-intro" style={{ gap: spacing.sm }}>
          <Text style={s.svcName}>Accountable organisation</Text>
          <Body>{THIRD_PARTY_REGISTER.accountable}</Body>
          <Body>{THIRD_PARTY_REGISTER.intro}</Body>
        </Card>

        <View>
          <SectionTitle>Active services</SectionTitle>
          <Card testID="register-active" style={{ gap: 0 }}>
            {THIRD_PARTY_REGISTER.active.map((svc, i) => (
              <View key={svc.name} style={s.svcItem} testID={`register-active-${i}`}>
                <Text style={s.svcName}>{svc.name}</Text>
                <Text style={s.svcPurpose}>{svc.purpose}</Text>
                <Text style={s.svcDetail}>Shared: {svc.shared}</Text>
                <Text style={s.svcDetail}>Controls: {svc.controls}</Text>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>Optional services</SectionTitle>
          <Card testID="register-optional" style={{ gap: 0 }}>
            {THIRD_PARTY_REGISTER.optional.map((svc, i) => (
              <View key={svc.name} style={s.svcItem} testID={`register-optional-${i}`}>
                <Text style={s.svcName}>{svc.name}</Text>
                <Text style={s.svcPurpose}>{svc.purpose}</Text>
                <Text style={s.svcDetail}>Shared: {svc.shared}</Text>
                <Text style={s.svcDetail}>Activates: {svc.activation}</Text>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>Unconfigured services</SectionTitle>
          <Card testID="register-unconfigured" style={{ gap: 0 }}>
            <Body>These integrations exist in code but are not active in the current deployment.</Body>
            {THIRD_PARTY_REGISTER.unconfigured.map((svc, i) => (
              <View key={svc.name} style={s.svcItem} testID={`register-unconfigured-${i}`}>
                <Text style={s.svcName}>{svc.name}</Text>
                <Text style={s.svcPurpose}>{svc.purpose}</Text>
                <Text style={s.svcDetail}>{svc.activation}</Text>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>Privacy requirements</SectionTitle>
          <Card testID="register-requirements" style={{ gap: spacing.sm }}>
            {THIRD_PARTY_SERVICES_DISCLOSURE.services.length > 0 && (
              <>
                <Body>Apollo applies its purpose-based privacy controls to information sent to external services.</Body>
                <Body>Authentication secrets must not be sent to Gemini. Personal information unrelated to the investigation is minimised or withheld. Material security evidence is preserved where necessary.</Body>
              </>
            )}
          </Card>
        </View>

        <View>
          <SectionTitle>Changes to services</SectionTitle>
          <Card testID="register-changes" style={{ gap: spacing.sm }}>
            <Body>{THIRD_PARTY_SERVICES_DISCLOSURE.changes}</Body>
          </Card>
        </View>

        <Text style={s.footer}>HWG retains responsibility and accountability for the selection, oversight and management of Apollo&apos;s third-party services and integrations.</Text>
      </ScrollView>
    </View>
  );
}
