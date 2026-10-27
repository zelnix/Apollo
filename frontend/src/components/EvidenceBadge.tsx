// The case's evidence level at a glance on the Threats list: a small "L3" pill (its level out of the strongest that
// kind of evidence can have). Screen readers hear the level's name from the case's evidence profile.
import React from "react";
import { Text, View } from "react-native";

import { evidenceStrength, type EvidenceProfile } from "@/src/domain/triage/evidenceProfile";
import { fonts, makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  pill: {
    alignSelf: "flex-start" as const, marginTop: 4, paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: 999, borderWidth: 1, borderColor: c.brandPrimary,
  },
  text: { fontFamily: fonts.textMedium, fontSize: 12, color: c.brandPrimary },
}));

export function evidenceCode(profile: Pick<EvidenceProfile, "type" | "rank">): string {
  return `L${evidenceStrength(profile).rank}`;
}

export function EvidenceBadge({ profile, testID }: { profile: EvidenceProfile; testID?: string }) {
  const s = useStyles();
  const { rank, max } = evidenceStrength(profile);
  return (
    <View style={s.pill} testID={testID} accessible accessibilityLabel={`Evidence level ${rank} of ${max}: ${profile.label}`}>
      <Text style={s.text}>{evidenceCode(profile)}</Text>
    </View>
  );
}
