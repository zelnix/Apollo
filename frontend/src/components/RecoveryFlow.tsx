// Recovery ("Stay With Me") — shared by the message check and the link check.
// Renders the trigger button plus the two sheets: pick what happened → numbered steps.
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";

import { Body, Button } from "@/src/components/ui";
import type { PatrolEvent } from "@/src/domain/types";
import { RECOVERY_STEPS, type RecoveryKind, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing } from "@/src/theme";
import { Sheet } from "./Sheet";

export const RECOVERY_TITLE: Record<RecoveryKind, string> = {
  clicked: "I only opened the page", password: "I entered my password", card: "I entered card / bank details", code: "I gave a verification code",
  money: "I sent money", info: "I shared personal information", download: "I downloaded something", app: "I installed something", called: "I called the number shown",
  remote: "I gave someone remote access", accessibility: "I granted accessibility access", profile: "I installed a profile / certificate", banking_during_access: "I used banking while they had access",
  mfa_approved: "I approved the login prompt", locked_out: "I'm locked out of the account",
};

const useStyles = makeStyles((c) => ({
  step: { flexDirection: "row", gap: spacing.sm },
  num: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brandPrimary, width: 20 },
  text: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface, flex: 1 },
}));

export function RecoveryFlow({ event, kinds, linkToCheck, testID = "recovery" }: { event: PatrolEvent; kinds: RecoveryKind[]; linkToCheck?: string | null; testID?: string }) {
  const s = useStyles();
  const router = useRouter();
  const { recordRecovery } = useApollo();
  const [pick, setPick] = useState(false);
  const [kind, setKind] = useState<RecoveryKind | null>(null);
  return (
    <>
      <Button testID={`${testID}-open`} variant="warning" label="I already clicked / paid / shared…" onPress={() => setPick(true)} />
      <Sheet visible={pick} onClose={() => setPick(false)} title="What happened?" testID={`${testID}-pick-sheet`}>
        {kinds.map((k) => <Button key={k} testID={`${testID}-pick-${k}`} variant="secondary" label={RECOVERY_TITLE[k]} onPress={() => { setPick(false); setKind(k); void recordRecovery(event, k); }} />)}
        <Button testID={`${testID}-pick-cancel`} variant="ghost" label="Cancel" onPress={() => setPick(false)} />
      </Sheet>
      <Sheet visible={!!kind} onClose={() => setKind(null)} title="Stay with me — here's what to do" testID={`${testID}-sheet`}>
        {kind ? RECOVERY_STEPS[kind].map((step, i) => <View key={i} style={s.step}><Text style={s.num}>{i + 1}</Text><Text style={s.text} testID={`${testID}-step-${i}`}>{step}</Text></View>) : null}
        {kind === "clicked" && linkToCheck ? <Button testID={`${testID}-check-link`} label="Check the link now" onPress={() => { setKind(null); router.push({ pathname: "/check", params: { url: linkToCheck.startsWith("http") ? linkToCheck : `https://${linkToCheck}`, source: "message" } }); }} /> : null}
        {kind === "clicked" && !linkToCheck ? <Body>If you only looked at the page and didn't type anything, you're most likely fine. Apollo has recorded it.</Body> : null}
        <Body>This is recorded in Patrol so you can come back to it. Ask Apollo any time.</Body>
        <Button testID={`${testID}-close`} variant="ghost" label="Done" onPress={() => setKind(null)} />
      </Sheet>
    </>
  );
}
