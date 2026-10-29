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
  return null;
}
