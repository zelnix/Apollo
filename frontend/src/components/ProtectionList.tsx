/**
 * Exception-first protection lists, shared by Apollo Protections and Device Protections.
 *
 * `ProtectionGroup` is a titled section with a count — "Protected (12)" starts folded, so healthy items
 * never crowd out the ones that need the person. `ProtectionListRow` is one tappable protection with
 * its status, and a "Changed" tag while a change to it hasn't been opened yet.
 */
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { ProtectionHealth } from "@/src/domain/deviceProtectionTypes";
import { fonts, makeStyles, radius, spacing, useTheme, type ThemeColors } from "@/src/theme";

export type RowTone = "attention" | "review" | "check" | "protected" | "muted";

export function rowToneColors(tone: RowTone, c: ThemeColors): { dot: string; text: string } {
  switch (tone) {
    case "attention": return { dot: c.biting, text: c.bitingText };
    case "review": return { dot: c.growling, text: c.growlingText };
    case "check": return { dot: c.gold, text: c.onSurface };
    case "protected": return { dot: c.resting, text: c.restingText };
    default: return { dot: c.muted, text: c.unknownText };
  }
}

export function healthRowTone(health: ProtectionHealth): RowTone {
  switch (health) {
    case "action": return "attention";
    case "review": return "review";
    case "check_manually": case "unable": return "check";
    case "protected": return "protected";
    default: return "muted";
  }
}

const useStyles = makeStyles((c) => ({
  group: { gap: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  title: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface, flexShrink: 1 },
  count: { minWidth: 24, paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary, alignItems: "center" },
  countText: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.onSurfaceSecondary },
  intro: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary, marginTop: -spacing.xs },
  list: { borderWidth: 0.5, borderColor: c.border, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, overflow: "hidden" },

  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md, minHeight: 56 },
  rowDivider: { borderTopWidth: 0.5, borderTopColor: c.divider },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  rowTitle: { fontFamily: fonts.textSemibold, fontSize: 14, lineHeight: 19, color: c.onSurface, flexShrink: 1 },
  rowSub: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted, marginTop: 2 },
  status: { width: 112, flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: fonts.textMedium, fontSize: 11.5, lineHeight: 15, flex: 1 },
  changed: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: c.growlingTint },
  changedText: { fontFamily: fonts.textSemibold, fontSize: 10, letterSpacing: 0.3, color: c.growlingText },
}));

export function ChangedTag({ testID }: { testID?: string }) {
  const s = useStyles();
  return (
    <View style={s.changed} testID={testID}>
      <Text style={s.changedText}>Changed</Text>
    </View>
  );
}

export function ProtectionListRow({
  title, subtitle, statusLabel, tone, changed, first, onPress, testID,
}: {
  title: string; subtitle?: string; statusLabel: string; tone: RowTone; changed?: boolean; first?: boolean;
  onPress: () => void; testID: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const palette = rowToneColors(tone, colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${statusLabel}.${changed ? " Changed since you last looked." : ""}`}
      accessibilityHint="Opens what this is, why it matters and what to do"
      onPress={onPress}
      style={({ pressed }) => [s.row, !first && s.rowDivider, { backgroundColor: pressed ? colors.surfaceTertiary : "transparent" }]}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <View style={s.rowTitleLine}>
          <Text style={s.rowTitle}>{title}</Text>
          {changed ? <ChangedTag testID={`${testID}-changed`} /> : null}
        </View>
        {subtitle ? <Text style={s.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      <View style={s.status}>
        <View style={[s.dot, { backgroundColor: palette.dot }]} />
        <Text style={[s.statusText, { color: palette.text }]} testID={`${testID}-status`}>{statusLabel}</Text>
      </View>
      <ChevronRight size={16} color={colors.muted} />
    </Pressable>
  );
}

/** A titled section. `collapsible` sections start folded unless `initiallyOpen`. */
export function ProtectionGroup({
  title, intro, count, collapsible = false, initiallyOpen = false, bare = false, children, testID,
}: {
  title: string; intro?: string; count: number; collapsible?: boolean; initiallyOpen?: boolean;
  /** Section contents without the bordered list around them (for content that brings its own tables). */
  bare?: boolean;
  children: React.ReactNode; testID: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(!collapsible || initiallyOpen);
  const heading = (
    <>
      <Text style={s.title}>{title}</Text>
      <View style={s.count}><Text style={s.countText} testID={`${testID}-count`}>{count}</Text></View>
      {collapsible ? <View style={{ marginLeft: "auto" }}>{open ? <ChevronDown size={18} color={colors.muted} /> : <ChevronRight size={18} color={colors.muted} />}</View> : null}
    </>
  );
  return (
    <View style={s.group} testID={testID}>
      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${title}, ${count}. ${open ? "Tap to fold." : "Tap to show."}`}
          onPress={() => setOpen((v) => !v)}
          style={s.head}
          testID={`${testID}-toggle`}
        >
          {heading}
        </Pressable>
      ) : (
        <View style={s.head}>{heading}</View>
      )}
      {intro && open ? <Text style={s.intro}>{intro}</Text> : null}
      {open ? (bare ? <View testID={`${testID}-list`}>{children}</View> : <View style={s.list} testID={`${testID}-list`}>{children}</View>) : null}
    </View>
  );
}
