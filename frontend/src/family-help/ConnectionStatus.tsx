// Family Help: shows both people whether the picture goes direct, through a relay, or is reconnecting.
// Reads this phone's own WebRTC route for this session only; shows nothing until there is one.
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import type { ConnectionPath } from "@/modules/apollo-family-assist";
import { Body, Pill } from "@/src/components/ui";
import { spacing } from "@/src/theme";

import { connectionStatus } from "./connection";
import { getNativeFamilyHelpState, observeNativeFamilyHelp } from "./native";

export function FamilyHelpConnectionStatus({ sessionId, generation }: { sessionId?: string; generation?: string }) {
  const [path, setPath] = useState<ConnectionPath | null>(null);
  useEffect(() => {
    if (!sessionId || !generation) return;
    let live = true;
    const read = () => {
      void getNativeFamilyHelpState().then((state) => {
        if (live) setPath(state.sessionId === sessionId && state.generation === generation ? state.connectionPath ?? null : null);
      }).catch(() => undefined);
    };
    read();
    const subscription = observeNativeFamilyHelp(read);
    return () => { live = false; subscription.remove(); };
  }, [sessionId, generation]);
  const status = connectionStatus(path);
  if (!status) return null;
  return (
    <View testID="family-help-connection" style={{ gap: spacing.xs }} accessibilityLiveRegion="polite">
      <Pill testID="family-help-connection-status" label={status.label} tone={status.tone} />
      <Body testID="family-help-connection-detail">{status.detail}</Body>
    </View>
  );
}
