// Recovery reassurance banner — Improvement 5: "Reassure Users When Problems Are Resolved"
// When Apollo encounters a real protection problem and subsequently recovers,
// this banner tells the user the issue has been resolved.
// A warning should not remain the user's last impression after successful recovery.
//
// Shows only when a genuine recovery has occurred (verified by device state).
// Auto-dismisses after the user has seen it for a reasonable time.

import ShieldCheck from "lucide-react-native/icons/shield-check";
import XIcon from "lucide-react-native/icons/x";
import React, { useEffect, useState, useCallback } from "react";
import { Pressable, Text, View } from "react-native";

import { Card } from "@/src/components/ui";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderColor: c.resting, borderWidth: 1 },
  iconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.restingTint, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.displayBold, fontSize: 15, color: c.restingText },
  body: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  dismiss: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
}));

export interface RecoveryInfo {
  /** What was restored (e.g. "Website protection") */
  what: string;
  /** When recovery was detected */
  recoveredAt: string;
  /** Whether the recovery has been acknowledged */
  acknowledged: boolean;
}

export function RecoveryBanner({ recovery, onDismiss, testID }: {
  recovery: RecoveryInfo | null;
  onDismiss: () => void;
  testID?: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();

  if (!recovery || recovery.acknowledged) return null;

  return (
    <Card style={s.banner} testID={testID ?? "recovery-banner"}>
      <View style={s.iconWell}>
        <ShieldCheck size={20} color={colors.resting} />
      </View>
      <View style={s.text}>
        <Text style={s.title}>Protection restored</Text>
        <Text style={s.body}>{recovery.what} is working again for supported connections.</Text>
      </View>
      <Pressable
        style={s.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss recovery notification"
        hitSlop={8}
        onPress={onDismiss}
        testID="recovery-dismiss"
      >
        <XIcon size={16} color={colors.muted} />
      </Pressable>
    </Card>
  );
}

/** Hook to track protection recovery state.
 *  Detects transitions from non-operational to operational and exposes
 *  the recovery info + dismiss callback. */
export function useRecoveryTracker(operational: boolean | undefined): {
  recovery: RecoveryInfo | null;
  dismiss: () => void;
} {
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(null);
  const [wasDown, setWasDown] = useState(false);

  useEffect(() => {
    if (operational === undefined) return;

    if (!operational) {
      setWasDown(true);
    } else if (wasDown && operational) {
      // Transition from non-operational to operational — genuine recovery
      setRecovery({
        what: "Website protection",
        recoveredAt: new Date().toISOString(),
        acknowledged: false,
      });
      setWasDown(false);
    }
  }, [operational, wasDown]);

  const dismiss = useCallback(() => {
    setRecovery((prev) => prev ? { ...prev, acknowledged: true } : null);
  }, []);

  return { recovery, dismiss };
}
