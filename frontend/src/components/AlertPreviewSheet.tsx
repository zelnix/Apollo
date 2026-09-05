// In-app preview of an Apollo alert: a mock system-notification card + the bundled sound,
// so people can see and hear an alert before installing a native build.
import { useAudioPlayer } from "expo-audio";
import { Image } from "expo-image";
import Volume2 from "lucide-react-native/icons/volume-2";
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Body, Button, Pill } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Sheet } from "./Sheet";

type Kind = "threat" | "family";

const SAMPLES: Record<Kind, { chip: string; title: string; body: string; sub: string; sound: number }> = {
  threat: {
    chip: "Threat alert · bark",
    title: "Apollo is barking",
    body: "commbank-secure-login-verify.xyz looks like a fake bank sign-in page.",
    sub: "Don't enter any details. Close the page and open your bank's app instead.",
    sound: require("../../assets/sounds/apollo_bark.wav"),
  },
  family: {
    chip: "Family reply · chime",
    title: "Mum replied: I called them",
    body: "Blocked a known phishing site",
    sub: "Tap to see the alert in Family sharing.",
    sound: require("../../assets/sounds/apollo_chime.wav"),
  },
};

const useStyles = makeStyles((c) => ({
  notif: { backgroundColor: c.surfaceTertiary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.borderStrong, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  app: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurfaceSecondary, flex: 1 },
  when: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  title: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  body: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },
  sub: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: { flex: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, alignItems: "center" },
  tabOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  tabText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
}));

export function AlertPreviewSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [kind, setKind] = useState<Kind>("threat");
  const sample = SAMPLES[kind];
  const player = useAudioPlayer(sample.sound);

  const play = () => { void player.seekTo(0); player.play(); };
  useEffect(() => { if (visible) play(); }, [visible, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet visible={visible} onClose={onClose} title="What an alert looks like" testID="alert-preview-sheet">
      <View style={s.tabs}>
        {(["threat", "family"] as Kind[]).map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} style={[s.tab, kind === k && s.tabOn]} testID={`alert-preview-tab-${k}`} accessibilityRole="button" accessibilityState={{ selected: kind === k }}>
            <Text style={s.tabText}>{k === "threat" ? "Threat alert" : "Family reply"}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.notif} testID="alert-preview-card">
        <View style={s.head}>
          <Image source={require("../../assets/images/logo.png")} style={{ width: 22, height: 22 }} contentFit="contain" />
          <Text style={s.app}>APOLLO</Text>
          <Text style={s.when}>now</Text>
        </View>
        <Text style={s.title} testID="alert-preview-title">{sample.title}</Text>
        <Text style={s.body}>{sample.body}</Text>
        <Text style={s.sub}>{sample.sub}</Text>
      </View>
      <Pill tone={kind === "threat" ? "barking" : "resting"} label={sample.chip} />
      <Body>Real alerts name the website and tell you exactly what to do — never the full link. On your phone they arrive even when Apollo is closed.</Body>
      <Button testID="alert-preview-play" label="Play sound again" icon={<Volume2 size={18} color={colors.onBrandPrimary} />} onPress={play} />
      <Button testID="alert-preview-close" variant="ghost" label="Done" onPress={onClose} />
    </Sheet>
  );
}
