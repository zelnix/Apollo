import FileSearch from "lucide-react-native/icons/file-search";
import KeyRound from "lucide-react-native/icons/key-round";
import Link2 from "lucide-react-native/icons/link-2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquareWarning from "lucide-react-native/icons/message-square-warning";
import PhoneIncoming from "lucide-react-native/icons/phone-incoming";
import ScanLine from "lucide-react-native/icons/scan-line";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import Wifi from "lucide-react-native/icons/wifi";
import React from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { CHECK_IT_ITEMS, type CheckItIcon } from "@/src/domain/checkIt";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const ICONS: Record<CheckItIcon, React.ComponentType<{ size?: number; color?: string }>> = { message: MessageSquareWarning, link: Link2, file: FileSearch, call: PhoneIncoming, scan: ScanLine, email: Mail, app: Smartphone, account: KeyRound, device: ShieldCheck, network: Wifi };
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface }, content: { paddingHorizontal: spacing.xl, gap: spacing.lg }, intro: { fontFamily: fonts.text, fontSize: 17, lineHeight: 25, color: c.onSurfaceSecondary }, grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: { minHeight: 148, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, gap: spacing.sm }, icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 23, color: c.onSurface }, purpose: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
}));

export default function CheckItScreen() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter(); const { width, fontScale } = useWindowDimensions();
  const oneColumn = width < 360 || fontScale >= 1.35;
  const cardWidth = oneColumn ? "100%" : width >= 760 ? "31%" : "47%";
  return <View style={s.root} testID="check-it-screen"><View style={{ paddingTop: insets.top + spacing.md }}><RootScreenHeader title="Check It" testID="check-it-header" /></View><ScrollView testID="check-it-scroll" contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 110 }]}><Text style={s.intro} testID="check-it-intro">Choose what you want Apollo to check. These checks start only when you tap one.</Text><View style={s.grid} testID="check-it-grid">{CHECK_IT_ITEMS.map((item) => { const Icon = ICONS[item.icon]; return <Pressable key={item.id} testID={`check-it-${item.id}`} accessibilityRole="button" accessibilityLabel={item.label} accessibilityHint={item.purpose} onPress={() => router.push(item.route)} style={({ pressed }) => [s.card, { width: cardWidth, opacity: pressed ? 0.78 : 1 }]}><View style={s.icon}><Icon size={23} color={colors.brand} /></View><Text style={s.label}>{item.label}</Text><Text style={s.purpose}>{item.purpose}</Text></Pressable>; })}</View></ScrollView></View>;
}