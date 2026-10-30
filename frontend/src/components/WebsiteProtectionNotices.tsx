// Website protection notices (Android): the two phone settings that decide whether Apollo's website
// protection actually works, raised where the person looks at that protection.
//   • "Block connections without VPN" on Apollo — Apollo's tunnel only carries website lookups, so
//     with this on Android can stop apps from connecting. Read only while Apollo's tunnel is up.
//   • Private DNS — Higgins recommends Automatic; Off and a provider hostname get a prompt with a
//     button straight to the setting. The status is re-read when the person returns to Apollo.
// Renders nothing when there is nothing to change, and nowhere but Android.
import CircleCheck from "lucide-react-native/icons/circle-check";
import Globe from "lucide-react-native/icons/globe";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/src/components/ui";
import { PRIVATE_DNS_SETTINGS_PATH, privateDnsAdvice, privateDnsMode, privateDnsNote } from "@/src/domain/privateDnsAdvice";
import { usePrivateDnsStatus } from "@/src/hooks/usePrivateDnsStatus";
import type { ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import { openDeviceSettings, openPrivateDnsSettings } from "@/src/utils/deviceSettings";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const VPN_SETTINGS_PATH = "Settings → Network & internet → VPN → ApolloSG ⚙ → Block connections without VPN";

const useStyles = makeStyles((c) => ({
  wrap: { gap: spacing.md },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  body: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  path: { fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 18, color: c.onSurface },
  done: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, paddingHorizontal: spacing.xs },
  doneText: { flex: 1, fontFamily: fonts.textMedium, fontSize: 14, color: c.restingText },
  noteText: { flex: 1, fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
}));

export function WebsiteProtectionNotices({ protection, testID = "site-notices" }: { protection: ProtectionStatus | null; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { status } = usePrivateDnsStatus();
  const advice = privateDnsAdvice(status);
  const adviceId = advice?.id;
  const [prompted, setPrompted] = useState(false);
  const [dnsPath, setDnsPath] = useState(false);
  const [vpnPath, setVpnPath] = useState(false);

  useEffect(() => { if (adviceId) setPrompted(true); }, [adviceId]);

  const lockdown = protection?.lockdown === true;
  // Already Automatic on a network without encrypted lookups: confirm it, explain the network, ask nothing.
  const note = privateDnsNote(status);
  const nowAutomatic = !note && prompted && !advice && !!status && privateDnsMode(status) === "automatic";
  if (!lockdown && !advice && !nowAutomatic && !note) return null;

  const openDns = async () => { setDnsPath((await openPrivateDnsSettings()) !== "private_dns"); };

  return (
    <View style={s.wrap} testID={testID}>
      {lockdown ? (
        <View style={[s.card, { backgroundColor: colors.barkingWash, borderColor: colors.barkingText }]} testID={`${testID}-lockdown`}>
          <View style={s.head}>
            <TriangleAlert size={18} color={colors.barkingText} />
            <Text style={s.title}>Android may be blocking your internet</Text>
          </View>
          <Text style={s.body}>“Block connections without VPN” is on for ApolloSG. Apollo’s protection only checks website lookups — it doesn’t carry the rest of your internet traffic — so with this switch on, Android can stop apps from connecting. Turn it off and keep Always-on VPN on.</Text>
          {vpnPath ? <Text style={s.path} testID={`${testID}-lockdown-path`}>{VPN_SETTINGS_PATH}</Text> : null}
          <Button testID={`${testID}-lockdown-open`} variant="secondary" label="Open VPN settings"
            onPress={() => void openDeviceSettings("vpn", VPN_SETTINGS_PATH, () => setVpnPath(true)).then(() => setVpnPath(true))} />
        </View>
      ) : null}
      {advice ? (
        <View style={[s.card, { backgroundColor: colors.growlingWash, borderColor: colors.growling }]} testID={`${testID}-private-dns`}>
          <View style={s.head}>
            <Globe size={18} color={colors.growlingText} />
            <Text style={s.title} testID={`${testID}-private-dns-title`}>{advice.title}</Text>
          </View>
          <Text style={s.body} testID={`${testID}-private-dns-body`}>{advice.body}</Text>
          {dnsPath ? <Text style={s.path} testID={`${testID}-private-dns-path`}>Then go to {PRIVATE_DNS_SETTINGS_PATH} and choose Automatic.</Text> : null}
          <Button testID={`${testID}-private-dns-open`} variant="secondary" label={advice.actionLabel} onPress={() => void openDns()} />
        </View>
      ) : null}
      {nowAutomatic ? (
        <View style={s.done} testID={`${testID}-private-dns-done`}>
          <CircleCheck size={18} color={colors.restingText} />
          <Text style={s.doneText}>Private DNS is set to Automatic.</Text>
        </View>
      ) : null}
      {note ? (
        <View style={s.done} testID={`${testID}-private-dns-automatic`}>
          <CircleCheck size={18} color={colors.restingText} />
          <Text style={s.noteText} testID={`${testID}-private-dns-automatic-text`}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}
