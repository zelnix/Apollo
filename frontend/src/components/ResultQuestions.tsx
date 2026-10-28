// The question buttons on each result (Higgins Luddish L1). Each question shows only when it adds something, and its
// answer opens right under the buttons, one at a time. "Show the technical detail" is Apollo's own wording exactly as
// recorded; Higgins' plain words sit beside a piece, never in place of it. General knowledge is labelled as such.
import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { resultQuestions, type AnswerItem, type AnswerSection, type LuddishExplanation, type QuestionId } from "@/src/domain/luddish";
import { fonts, makeStyles, radius, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { gap: spacing.sm },
  eyebrow: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: c.brand, borderColor: c.brand },
  chipLabel: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  chipLabelActive: { color: c.onBrand },
  answer: { gap: spacing.md, paddingTop: spacing.xs },
  section: { gap: spacing.xs },
  heading: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  text: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, color: c.onSurface },
  detail: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  plainNote: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary, fontStyle: "italic" },
  knowledge: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.goldTint },
  technical: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceTertiary },
  technicalLabel: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted, textTransform: "uppercase" },
  technicalItem: { gap: 2, paddingVertical: spacing.xs },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
}));

function Item({ item }: { item: AnswerItem }) {
  const s = useStyles();
  return (
    <View style={{ gap: 2 }}>
      <Text style={s.text}>{item.label ? <Text style={s.label}>{`${item.label}: `}</Text> : null}{item.text}</Text>
      {item.detail ? <Text style={s.detail}>{item.detail}</Text> : null}
    </View>
  );
}

function Section({ section, testID }: { section: AnswerSection; testID: string }) {
  const s = useStyles();
  if (section.kind === "knowledge") {
    return (
      <View style={s.knowledge} testID={testID}>
        <Text style={s.technicalLabel}>{`General knowledge · ${section.source ?? "ApolloSG"}`}</Text>
        {section.heading ? <Text style={s.heading}>{section.heading}</Text> : null}
        {section.items.map((item, i) => <Text key={i} style={s.text}>{item.text}</Text>)}
        <Text style={s.detail}>Background only, not a finding about this result.</Text>
      </View>
    );
  }
  if (section.kind === "technical") {
    // Apollo's locked wording, shown exactly as recorded: nothing here is reworded.
    return (
      <View style={s.technical} testID={testID}>
        {section.heading ? <Text style={s.heading}>{section.heading}</Text> : null}
        {section.items.map((item, i) => (
          <View key={i} style={[s.technicalItem, i > 0 && s.divider]} testID={`${testID}-${i}`}>
            {item.label ? <Text style={s.technicalLabel}>{item.label}</Text> : null}
            <Text style={s.text} selectable testID={`${testID}-${i}-text`}>{item.text}</Text>
            {item.detail ? <Text style={s.detail}>{item.detail}</Text> : null}
            {item.plain ? <Text style={s.plainNote} testID={`${testID}-${i}-plain`}>{`In plain words: ${item.plain}`}</Text> : null}
            {item.note ? <Text style={s.plainNote}>{item.note}</Text> : null}
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={s.section} testID={testID}>
      {section.heading ? <Text style={s.heading}>{section.heading}</Text> : null}
      {section.items.map((item, i) => <Item key={i} item={item} />)}
    </View>
  );
}

export function ResultQuestions({ explanation, shown, testID }: {
  explanation: LuddishExplanation;
  /** What the screen already says, so no answer repeats it. */
  shown: readonly (string | null | undefined)[];
  testID: string;
}) {
  const s = useStyles();
  const questions = useMemo(() => resultQuestions(explanation, shown), [explanation, shown]);
  const [open, setOpen] = useState<QuestionId | null>(null);
  if (!questions.length) return null;
  const current = questions.find((q) => q.id === open) ?? null;
  return (
    <View style={s.root} testID={testID}>
      <Text style={s.eyebrow}>Ask Higgins about this</Text>
      <View style={s.chips}>
        {questions.map((q) => {
          const active = q.id === open;
          return (
            <Pressable key={q.id} accessibilityRole="button" accessibilityState={{ expanded: active }} onPress={() => setOpen(active ? null : q.id)}
              style={({ pressed }) => [s.chip, active && s.chipActive, pressed && { opacity: 0.8 }]} testID={`${testID}-${q.id}`}>
              <Text style={[s.chipLabel, active && s.chipLabelActive]}>{q.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {current ? (
        <View style={s.answer} testID={`${testID}-answer`} accessibilityLiveRegion="polite">
          {current.sections.map((section, i) => <Section key={`${current.id}-${i}`} section={section} testID={`${testID}-answer-${section.kind}-${i}`} />)}
        </View>
      ) : null}
    </View>
  );
}
