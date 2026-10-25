// One line under a finished result: when the pictures and files sent for it left Apollo's server. Read from this
// phone's saved record, or from the live case before it is saved. Tapping it opens the rule book at Your data.
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";

import { serverCopyNote, serverLeavesBy } from "@/src/domain/serverCopyNote";
import { getInvestigation, subscribeDeviceInvestigations, type DeviceInvestigation } from "@/src/investigation/deviceStore";
import type { InvestigationCase } from "@/src/investigation/types";
import { fonts, makeStyles, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  wrap: { minHeight: 44, justifyContent: "center", paddingVertical: spacing.xs },
  text: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  link: { fontFamily: fonts.textSemibold, color: c.brandPrimary },
}));

export function ServerCopyNote({ caseId, live, testID = "server-copy-note" }: {
  caseId: string | null | undefined;
  /** The live case, used until the result is saved on this phone. */
  live?: InvestigationCase | null;
  testID?: string;
}) {
  const s = useStyles();
  const router = useRouter();
  const [saved, setSaved] = useState<DeviceInvestigation | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!caseId) return;
    let active = true;
    const load = () => {
      void getInvestigation(caseId).then((record) => { if (active) { setSaved(record); setNow(Date.now()); } }).catch(() => undefined);
    };
    load();
    const unsubscribe = subscribeDeviceInvestigations(load);
    return () => { active = false; unsubscribe(); };
  }, [caseId]);

  const note = saved ? serverCopyNote(saved.serverCopy, saved.completedAt, now)
    // A result reopened from this phone carries no server deadline of its own, so only a live case is used.
    : live && live.retentionClass !== "device_local" ? serverCopyNote({ removedAt: null, leavesBy: serverLeavesBy(live) }, live.updatedAt, now)
    : null;
  if (!note) return null;
  return (
    <Pressable accessibilityRole="link" accessibilityHint="Opens the rule book at Your data" testID={testID} style={({ pressed }) => [s.wrap, { opacity: pressed ? 0.7 : 1 }]}
      onPress={() => router.push({ pathname: "/settings/rule-book", params: { section: "your-data" } })}>
      <Text style={s.text}>{note} <Text style={s.link}>See the rule</Text></Text>
    </Pressable>
  );
}
