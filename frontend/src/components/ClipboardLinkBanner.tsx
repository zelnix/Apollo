// Clipboard link detection (native only). Uses hasUrlAsync() first so no
// paste banner appears until the user opts to check the link.

import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import React, { useCallback, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Body, Button } from "./ui";

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.growling, padding: spacing.lg, gap: spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
  actions: { flexDirection: "row", gap: spacing.sm },
}));

export function ClipboardLinkBanner() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const [hasLink, setHasLink] = useState(false);
  const dismissed = useRef(false);

  useFocusEffect(useCallback(() => {
    if (Platform.OS === "web" || dismissed.current) return;
    let alive = true;
    Clipboard.hasUrlAsync().then((has) => { if (alive) setHasLink(has); }).catch(() => {});
    return () => { alive = false; };
  }, []));

  if (!hasLink) return null;
  const check = async () => {
    const text = (await Clipboard.getStringAsync().catch(() => "")).trim();
    setHasLink(false);
    if (text) router.push({ pathname: "/check", params: { url: text, source: "clipboard" } });
  };
  return (
    <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={s.card} testID="clipboard-banner">
      <View style={s.head}><ClipboardPaste size={18} color={colors.growling} /><Text style={s.title}>There&apos;s a link on your clipboard</Text></View>
      <Body>Apollo hasn&apos;t read it. Want to check it before you open it?</Body>
      <View style={s.actions}>
        <Button testID="clipboard-check-button" label="Check it" variant="warning" onPress={check} style={{ flex: 1 }} />
        <Button testID="clipboard-dismiss-button" label="Not now" variant="ghost" onPress={() => { dismissed.current = true; setHasLink(false); }} />
      </View>
    </Animated.View>
  );
}
