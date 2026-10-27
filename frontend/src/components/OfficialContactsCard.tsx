// "Official contacts" on every check result: the Official Organisation Directory's verdict on each website, number and
// address the check held. A warning ("not the official contact") comes first, with the organisation's own contacts to
// use instead and the page ApolloSG traced them to. Presentation only — it never changes the result.

import ExternalLink from "lucide-react-native/icons/external-link";
import React from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { Card, Pill } from "@/src/components/ui";
import { officialContactLines, type OfficialVerdict } from "@/src/domain/officialContacts";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  label: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted, textTransform: "uppercase" },
  line: { gap: spacing.xs, paddingTop: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: c.divider },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  text: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },
  muted: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  link: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
  linkText: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand, textDecorationLine: "underline" as const },
}));

function LinkRow({ label, url, testID }: { label: string; url: string; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => [s.link, pressed && { opacity: 0.7 }]} testID={testID}>
      <ExternalLink size={16} color={colors.brand} />
      <Text style={s.linkText}>{label}</Text>
    </Pressable>
  );
}

/** `verdicts`: undefined → nothing to compare (no card); null → the lookup didn't answer; [] → nothing listed. */
export function OfficialContactsCard({ verdicts, testID = "check-result-official" }: { verdicts: OfficialVerdict[] | null | undefined; testID?: string }) {
  const s = useStyles();
  if (verdicts === undefined || (verdicts && verdicts.length === 0)) return null;
  if (verdicts === null) {
    return (
      <Card style={{ gap: spacing.xs }} testID={testID}>
        <Text style={s.label}>Official contacts</Text>
        <Text style={s.muted} testID={`${testID}-unavailable`}>{"ApolloSG couldn't compare the contacts with its Official Organisation Directory right now, so it can't say whether they are the organisation's own."}</Text>
      </Card>
    );
  }
  const lines = officialContactLines(verdicts);
  return (
    <Card style={{ gap: 0 }} testID={testID}>
      <Text style={s.label}>Official contacts</Text>
      {lines.map((line, i) => (
        <View key={line.id} style={[s.line, i > 0 && s.divider]} testID={`${testID}-${i}`}>
          <View style={s.head}>
            <Text style={s.title}>{line.title}</Text>
            <Pill tone={line.warning ? "barking" : "resting"} label={line.warning ? "Not the official contact" : "Official"} compact testID={`${testID}-${i}-status`} />
          </View>
          <Text style={s.text} testID={`${testID}-${i}-text`}>{line.text}</Text>
          {line.useInstead.map((c, j) => <LinkRow key={c.url} label={c.label} url={c.url} testID={`${testID}-${i}-use-${j}`} />)}
          {line.source ? <LinkRow label={line.source.label} url={line.source.url} testID={`${testID}-${i}-source`} /> : null}
        </View>
      ))}
    </Card>
  );
}
