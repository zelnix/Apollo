// The rule book as closed sections: the intro stays open, and each part (Apollo detection, TC FlyBy, Privacy…)
// opens with a tap on its title. "Open all" / "Close all" open or close every part at once.
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import React, { useState } from "react";
import { LayoutAnimation, Pressable, Text, View } from "react-native";

import { RuleBookView } from "@/src/components/RuleBookView";
import type { Block, RuleBookSection } from "@/src/domain/ruleBook";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { gap: spacing.md },
  tools: { flexDirection: "row", justifyContent: "flex-end", marginTop: -spacing.sm },
  toolButton: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: "center" },
  toolText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brandPrimary },
  list: { gap: spacing.sm },
  card: { borderWidth: 1, borderColor: c.divider, borderRadius: radius.md, backgroundColor: c.surface, overflow: "hidden" },
  header: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 23, color: c.onSurface },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
}));

export function RuleBookSections({ intro, sections, initiallyOpen, onSectionLayout }: {
  intro: Block[];
  sections: RuleBookSection[];
  /** Opened from a result's "See the rule": that section starts open. */
  initiallyOpen?: string;
  /** y of each section's card, relative to this view — for opening the book at a section. */
  onSectionLayout?: (id: string, y: number) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState<Set<string>>(() => new Set(initiallyOpen ? [initiallyOpen] : []));
  const allOpen = sections.length > 0 && sections.every((section) => open.has(section.id));

  const change = (next: Set<string>) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(next);
  };
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    change(next);
  };

  return (
    <View style={s.root} testID="rule-book">
      {intro.length ? <RuleBookView blocks={intro} testID="rule-book-intro" /> : null}
      <View style={s.tools}>
        <Pressable testID="rule-book-toggle-all" accessibilityRole="button" style={({ pressed }) => [s.toolButton, { opacity: pressed ? 0.7 : 1 }]}
          onPress={() => change(allOpen ? new Set() : new Set(sections.map((section) => section.id)))}>
          <Text style={s.toolText}>{allOpen ? "Close all" : "Open all"}</Text>
        </Pressable>
      </View>
      <View style={s.list}>
        {sections.map((section) => {
          const expanded = open.has(section.id);
          const Chevron = expanded ? ChevronUp : ChevronDown;
          return (
            <View key={section.id} style={s.card} collapsable={false}
              onLayout={onSectionLayout ? (e) => onSectionLayout(section.id, e.nativeEvent.layout.y) : undefined}>
              <Pressable testID={`rule-book-section-${section.id}`} accessibilityRole="button" accessibilityState={{ expanded }}
                accessibilityHint={expanded ? "Closes this part of the rule book" : "Opens this part of the rule book"}
                onPress={() => toggle(section.id)} style={({ pressed }) => [s.header, { opacity: pressed ? 0.7 : 1 }]}>
                <Text style={s.title} accessibilityRole="header">{section.title}</Text>
                <Chevron size={20} color={colors.muted} />
              </Pressable>
              {expanded ? (
                <View style={s.body} testID={`rule-book-section-body-${section.id}`}>
                  <RuleBookView blocks={section.blocks} testID={`rule-book-blocks-${section.id}`} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
