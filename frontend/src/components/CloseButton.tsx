// The one close control for every screen: an X at the FAR RIGHT of the header, with the same icon
// size and 44pt touch target as the other header icons (InfoButton, AlertsButton), so every screen
// header lines up. Screens dismiss with this or with a back chevron — never a "Done"/"Close" button.
import X from "lucide-react-native/icons/x";
import React from "react";
import { Pressable } from "react-native";

import { makeStyles, radius, useTheme } from "@/src/theme";

const useStyles = makeStyles(() => ({
  // Icon sits flush with the right edge of its 44pt touch target, matching InfoButton.
  button: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "flex-end", justifyContent: "center" },
}));

export function CloseButton({ onPress, testID, label = "Close" }: { onPress: () => void; testID: string; label?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.button, { opacity: pressed ? 0.75 : 1 }]}
    >
      <X size={23} color={colors.onSurface} />
    </Pressable>
  );
}
