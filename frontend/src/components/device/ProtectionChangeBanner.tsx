/**
 * "Something changed on this device" — shown on Home while a Device Protection change hasn't been opened.
 * One changed protection opens that protection; several open the Device Protections list.
 */
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { changeBanner } from "@/src/domain/deviceProtectionChanges";
import { useDeviceProtections } from "@/src/store/deviceProtectionStore";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.md, borderWidth: 1, padding: spacing.md, minHeight: 56 },
  title: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  text: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary, marginTop: 2 },
}));

export function ProtectionChangeBanner({ style, testID }: { style?: StyleProp<ViewStyle>; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const assessment = useDeviceProtections();
  const banner = assessment ? changeBanner(assessment.unseen) : null;
  if (!banner) return null;
  const Icon = banner.worse ? ShieldAlert : ShieldCheck;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${banner.title}. ${banner.text}`}
      accessibilityHint={banner.protectionId ? "Opens that protection" : "Opens Device Protections"}
      onPress={() => banner.protectionId
        ? router.push({ pathname: "/capability/[id]", params: { id: banner.protectionId } })
        : router.push("/device-protection")}
      style={({ pressed }) => [
        s.banner,
        { backgroundColor: banner.worse ? colors.bitingTint : colors.restingTint, borderColor: banner.worse ? colors.biting : colors.resting, opacity: pressed ? 0.85 : 1 },
        style,
      ]}
      testID={testID}
    >
      <Icon size={20} color={banner.worse ? colors.bitingText : colors.restingText} />
      <View style={{ flex: 1 }}>
        <Text style={s.title} testID={`${testID}-title`}>{banner.title}</Text>
        <Text style={s.text} numberOfLines={3} testID={`${testID}-text`}>{banner.text}</Text>
      </View>
      <ChevronRight size={16} color={colors.muted} />
    </Pressable>
  );
}
