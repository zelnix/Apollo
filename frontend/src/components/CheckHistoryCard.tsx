// Plain-English history card for a manual Check result screen (History Everywhere). Shows the most
// recent manual checks for this gate — never a code, only an outcome chip, a short summary and a time.
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import { Body, Card, Pill, SectionTitle } from "@/src/components/ui";
import { resultChip } from "@/src/domain/messageVoice";
import { getCheckHistory, type CheckGate, type CheckHistoryEntry } from "@/src/store/checkHistoryStore";
import { fonts, makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  meta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
}));

/** `refreshKey` lets the host bump it after a new check so the card reloads. */
export function CheckHistoryCard({ gate, refreshKey = 0, testID = "check-history" }: { gate: CheckGate; refreshKey?: number; testID?: string }) {
  const s = useStyles();
  const [items, setItems] = useState<CheckHistoryEntry[]>([]);
  useEffect(() => { void getCheckHistory(gate).then(setItems); }, [gate, refreshKey]);
  if (items.length === 0) return null;
  return (
    <Card style={{ gap: spacing.sm }} testID={testID}>
      <SectionTitle>Your recent checks</SectionTitle>
      {items.map((e, i) => (
        <View key={`${e.at}-${i}`} style={{ gap: 2 }} testID={`${testID}-${i}`}>
          <View style={s.row}><Body style={{ flex: 1 }}>{e.summary}</Body><Pill tone={e.state} label={resultChip(e.state)} /></View>
          <Body style={s.meta}>{new Date(e.at).toLocaleString()}</Body>
        </View>
      ))}
    </Card>
  );
}
