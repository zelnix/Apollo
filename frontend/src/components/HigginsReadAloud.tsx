// "Higgins, read this aloud" — reads a Patrol event or incident timeline step by step, showing which part is playing.
import BookOpen from "lucide-react-native/icons/book-open";
import Square from "lucide-react-native/icons/square";
import React from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { Body, Button } from "@/src/components/ui";
import type { NarrationChunk } from "@/src/domain/higginsNarration";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";
import { useHigginsReader } from "@/src/voice/higgins";

const useStyles = makeStyles((c) => ({
  wrap: { gap: spacing.sm },
  now: { fontFamily: fonts.textMedium, fontSize: 13, color: c.restingText },
}));

export function HigginsReadAloud({ chunks, label = "Higgins, read this aloud", testID = "higgins-read" }: { chunks: NarrationChunk[]; label?: string; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { deviceId, showToast } = useApollo();
  const { read, stop, progress, busy } = useHigginsReader(deviceId);
  const reading = !!progress;
  const start = () => { void read(chunks.map((c) => c.text)).catch((e: Error) => showToast(e.message || "Higgins couldn't read just now.", "neutral")); };
  return (
    <View style={s.wrap} testID={testID}>
      <Button testID={`${testID}-button`} variant={reading ? "ghost" : "secondary"} label={busy ? "Higgins is clearing his throat…" : reading ? "Stop reading" : label} icon={busy ? <ActivityIndicator size="small" color={colors.onSurface} /> : reading ? <Square size={16} color={colors.onSurface} /> : <BookOpen size={18} color={colors.onSurface} />} onPress={reading ? stop : start} disabled={busy} />
      {reading && progress ? <Text style={s.now} testID={`${testID}-progress`}>Reading {progress.index + 1} of {progress.total} — {chunks[progress.index]?.label}</Text> : <Body>{chunks.length} short parts: {chunks.map((c) => c.label).slice(0, 4).join(", ")}{chunks.length > 4 ? "…" : ""}.</Body>}
    </View>
  );
}
