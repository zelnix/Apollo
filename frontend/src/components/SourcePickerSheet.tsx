// One picker, one shape: "choose something from my phone" for every kind of check. On a real phone the
// rows are the person's own items (connected inbox, installed apps, recent callers); in a preview build,
// where the real source cannot be reached, the same picker shows clearly-tagged sample items instead.
// Nothing here carries a verdict — whatever is picked becomes INPUT to Apollo's ordinary check.
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Body, Button } from "./ui";
import { Sheet } from "./Sheet";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export interface SourceChoice {
  id: string;
  primary: string;
  secondary?: string;
  /** What the item contains — never what Apollo will conclude about it. */
  meta?: string;
}

const useStyles = makeStyles((c) => ({
  note: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  tag: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.gold },
  tagText: { fontFamily: fonts.textSemibold, fontSize: 10, letterSpacing: 0.5, color: "#1B2437" },
  row: { paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.border, flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowSelected: { backgroundColor: c.restingTint },
  primary: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  secondary: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurface, marginTop: 1 },
  meta: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary, marginTop: 2 },
  center: { paddingVertical: spacing.lg, alignItems: "center", gap: spacing.sm },
}));

export function SourcePickerSheet({
  visible, title, note, preview, loading, error, items, emptyText, selectedId, onSelect, onClose, testID,
}: {
  visible: boolean;
  title: string;
  note: string;
  /** True when the rows are sample items because the real source cannot be reached in this build. */
  preview?: boolean;
  loading?: boolean;
  /** Why the real list could not be read. A failed read is never shown as "nothing found". */
  error?: string | null;
  items: SourceChoice[];
  emptyText: string;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  testID: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID={testID}>
      {preview ? <View style={s.tag}><Text style={s.tagText}>PREVIEW ONLY</Text></View> : null}
      <Text style={s.note}>{note}</Text>
      {loading ? (
        <View style={s.center} testID={`${testID}-loading`}>
          <ActivityIndicator color={colors.gold} />
          <Body>Reading the list…</Body>
        </View>
      ) : error ? (
        <View style={s.center} testID={`${testID}-error`}><Body>{error}</Body></View>
      ) : items.length === 0 ? (
        <View style={s.center} testID={`${testID}-empty`}><Body>{emptyText}</Body></View>
      ) : (
        items.map((item, i) => (
          <Pressable
            key={item.id}
            testID={`${testID}-${i}`}
            accessibilityRole="button"
            accessibilityLabel={`Use ${item.primary} for this check`}
            onPress={() => onSelect(item.id)}
            style={({ pressed }) => [s.row, item.id === selectedId && s.rowSelected, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.primary} numberOfLines={2}>{item.primary}</Text>
              {item.secondary ? <Text style={s.secondary} numberOfLines={2}>{item.secondary}</Text> : null}
              {item.meta ? <Text style={s.meta} numberOfLines={2}>{item.meta}</Text> : null}
            </View>
            <Text style={{ color: item.id === selectedId ? colors.resting : colors.muted, fontFamily: fonts.textSemibold, fontSize: 13 }}>
              {item.id === selectedId ? "Selected" : "Use this"}
            </Text>
          </Pressable>
        ))
      )}
      <Button testID={`${testID}-close`} variant="ghost" label="Back" onPress={onClose} />
    </Sheet>
  );
}
