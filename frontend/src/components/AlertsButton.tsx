// Reusable "🔔" header button: opens the Alerts tab, and carries a small warning dot when Apollo's
// notifications are switched off, so a person can see at a glance that alerts can't reach them.
// The dot only appears where it is actionable — never on a platform that has no notifications at all.
import { useFocusEffect, useRouter } from "expo-router";
import Bell from "lucide-react-native/icons/bell";
import React, { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { getNotificationHealth } from "@/src/push/notifications";
import { makeStyles, radius, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  // Matches InfoButton's 44pt touch target so header icons line up.
  button: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  dot: {
    position: "absolute", top: 10, right: 10, width: 9, height: 9, borderRadius: radius.pill,
    backgroundColor: c.warning, borderWidth: 1.5, borderColor: c.surface,
  },
}));

export function AlertsButton({ testID }: { testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const [notificationsOff, setNotificationsOff] = useState(false);

  useFocusEffect(useCallback(() => {
    let live = true;
    void getNotificationHealth()
      .then((health) => {
        // "unsupported" means there is nothing the person can turn on — don't nag about it.
        if (live) setNotificationsOff(!health.fullyEnabled && health.permission !== "unsupported");
      })
      .catch(() => { if (live) setNotificationsOff(false); });
    return () => { live = false; };
  }, []));

  return (
    <Pressable
      testID={testID ?? "alerts-button"}
      accessibilityRole="button"
      accessibilityLabel={notificationsOff ? "Alerts — notifications are off" : "Alerts"}
      hitSlop={8}
      onPress={() => router.push("/(tabs)/scams")}
      style={({ pressed }) => [s.button, { opacity: pressed ? 0.75 : 1 }]}
    >
      <Bell size={17} color={colors.onSurfaceSecondary} />
      {notificationsOff ? <View style={s.dot} testID={`${testID ?? "alerts-button"}-off-dot`} /> : null}
    </Pressable>
  );
}
