// A colourful icon tile that leads a screen title (Threats, Scam Alerts) — same size as Higgins' avatar on Learn.
import type { LucideIcon } from "lucide-react-native";
import React from "react";
import { View } from "react-native";

import { makeStyles } from "@/src/theme";

const useStyles = makeStyles(() => ({
  tile: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
}));

export function HeaderIconTile({ icon: Icon, color, fg, testID }: { icon: LucideIcon; color: string; fg: string; testID: string }) {
  const s = useStyles();
  return (
    <View style={[s.tile, { backgroundColor: color }]} testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon size={22} color={fg} strokeWidth={2.2} />
    </View>
  );
}
