// Higgins' once-a-day greeting card on Home. Shows on the first open of each local day, matches Apollo's state,
// can be read aloud (automatically if the person turned that on in Settings), and is dismissed with one tap.
import X from "lucide-react-native/icons/x";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { HigginsSpeakButton } from "@/src/components/HigginsSpeakButton";
import { Card, toneColor } from "@/src/components/ui";
import { dayKey, higginsGreeting } from "@/src/domain/higginsGreeting";
import type { ApolloState } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";
import { getHigginsAuto, speakHiggins } from "@/src/voice/higgins";

const K_DAY = "apollo.higgins.greeted";

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  who: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.muted, letterSpacing: 0.4, textTransform: "uppercase" },
  text: { fontFamily: fonts.display, fontSize: 17, lineHeight: 24, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginTop: -spacing.sm, marginRight: -spacing.sm },
}));

export function HigginsGreeting({ state }: { state: ApolloState | "lost" }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { deviceId, ready } = useApollo();
  const [visible, setVisible] = useState(false);
  const today = dayKey();
  const greeting = useMemo(() => higginsGreeting(state), [state]);

  // First open of the day: show the card and, if the person asked Higgins to read aloud automatically, speak it once.
  useEffect(() => {
    if (!ready) return;
    void storage.getItem<string | null>(K_DAY, null).then((last) => {
      if (last === today) return;
      setVisible(true);
      void getHigginsAuto().then((on) => { if (on) void speakHiggins(greeting.text, deviceId).catch(() => undefined); });
    });
  }, [ready, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => { setVisible(false); void storage.setItem(K_DAY, today); };
  if (!visible) return null;

  return (
    <Card style={{ gap: spacing.sm, borderColor: toneColor(colors, greeting.tone === "lost" ? "unknown" : greeting.tone) }} testID="higgins-greeting">
      <View style={s.row}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.who}>Higgins</Text>
          <Text style={s.text} testID="higgins-greeting-text">{greeting.text}</Text>
        </View>
        <Pressable testID="higgins-greeting-dismiss" accessibilityRole="button" accessibilityLabel="Dismiss greeting" onPress={dismiss} style={s.close} hitSlop={8}><X size={18} color={colors.muted} /></Pressable>
      </View>
      <HigginsSpeakButton text={greeting.text} testID="higgins-greeting-hear" />
    </Card>
  );
}
