// The first card on every check screen: "pick one of my own things", as a hero button.
//
// Picking beats typing — a person checking an email, a caller, a message, a file or an app almost
// always has the thing on this phone already. So that choice leads the screen instead of sitting
// under the form, and tapping it opens the same popup a production build opens (SourcePickerSheet).
// The button is worded for production in every build; where the real list cannot be reached, the
// popup itself carries the PREVIEW ONLY tag.
import React from "react";
import { Text, View } from "react-native";

import { Button, Card } from "./ui";
import { fonts, makeStyles, spacing } from "@/src/theme";

export interface SourceHeroAction {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}

const useStyles = makeStyles((c) => ({
  card: { gap: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface, letterSpacing: -0.2 },
  caption: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  hero: { minHeight: 56 },
}));

export function SourceHero({ title, caption, actions, testID }: {
  title: string;
  caption: string;
  /** The first action is the hero; any others sit under it as secondary choices. */
  actions: SourceHeroAction[];
  testID: string;
}) {
  const s = useStyles();
  if (actions.length === 0) return null;
  return (
    <Card style={s.card} testID={testID}>
      <View style={{ gap: 4 }}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.caption}>{caption}</Text>
      </View>
      {actions.map((action, i) => (
        <Button
          key={action.testID}
          testID={action.testID}
          label={action.label}
          icon={action.icon}
          variant={i === 0 ? "primary" : "secondary"}
          disabled={action.disabled}
          onPress={action.onPress}
          style={i === 0 ? s.hero : undefined}
        />
      ))}
    </Card>
  );
}
