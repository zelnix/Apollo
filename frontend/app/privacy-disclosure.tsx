// Australian privacy disclosure. Shown during setup (before the device
// identity is created) and reachable from Settings. Lists exactly what
// leaves the device, when, and what never does.

import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export const DISCLOSURE_VERSION = "2026-06";

const LEAVES_DEVICE = [
  { what: "The link you ask Apollo to check", when: "Only when you tap “Check with Apollo” (or share a link into Apollo)", detail: "Credentials and #fragments are removed first. Sent to Apollo's server and, for reputation, to Google Safe Browsing. Stored only as a keyed digest, never the raw link." },
  { what: "A Patrol event summary", when: "After each check or protection change", detail: "Headline, plain-language reasons, the website domain and Apollo's state. The full link stays on your device." },
  { what: "Your question to Ask Apollo", when: "Only when you send a message", detail: "Plus, if you tap “Ask Apollo to explain” on an event, a short event summary (domain and reasons). Processed by Google Gemini." },
  { what: "An anonymous device ID", when: "With every request", detail: "A random identifier created on this device. Not linked to your name, phone number, email, Apple ID or Google account." },
];
const NEVER_LEAVES = ["Your messages, emails, contacts or photos", "The content of web pages you visit", "Your browsing history", "Your location", "Device identifiers such as IMEI, serial number or advertising ID", "Anything from your clipboard unless you choose to check it"];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  item: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  what: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  when: { fontFamily: fonts.textMedium, fontSize: 13, color: c.growling },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  legal: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.muted },
}));

export default function PrivacyDisclosure() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setupDone, completeSetup } = useApollo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true); setError(null);
    try { await completeSetup(); router.replace("/(tabs)/home"); }
    catch (e) { setError(e instanceof Error ? e.message : "Setup failed"); }
    finally { setBusy(false); }
  };

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Privacy disclosure</Text>
        {setupDone ? <Pressable testID="disclosure-close" accessibilityRole="button" onPress={() => router.back()} style={s.close}><X size={20} color={colors.onSurface} /></Pressable> : null}
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: spacing.xl }]} testID="disclosure-scroll">
        <Body>Apollo is built for Australians under the Privacy Act 1988 and the Australian Privacy Principles. This page lists exactly what leaves your phone and when. Nothing else does.</Body>

        <View>
          <SectionTitle>What leaves your device, and when</SectionTitle>
          <Card testID="disclosure-leaves">
            {LEAVES_DEVICE.map((row) => (
              <View key={row.what} style={s.item}>
                <Text style={s.what}>{row.what}</Text>
                <Text style={s.when}>{row.when}</Text>
                <Body>{row.detail}</Body>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>What never leaves your device</SectionTitle>
          <Card testID="disclosure-never" style={{ gap: spacing.sm }}>
            {NEVER_LEAVES.map((line) => <Body key={line}>• {line}</Body>)}
            <Pill tone="resting" label="Enforced in code: an allow-list blocks anything else" />
          </Card>
        </View>

        <View>
          <SectionTitle>Where data goes and how long it stays</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Body>• Apollo&apos;s server keeps Patrol summaries and trusted-link digests for your device ID until you clear them (Settings → Clear Patrol history / Revoke).</Body>
            <Body>• Reputation results are cached by digest for at most the time Google allows (minutes to hours), then expire automatically.</Body>
            <Body>• Ask Apollo conversation history is kept for your device ID until you clear it.</Body>
            <Body>• Overseas disclosure: reputation checks (Google Safe Browsing) and Ask Apollo (Google Gemini) are processed by Google, which may be outside Australia (APP 8).</Body>
          </Card>
        </View>

        <View>
          <SectionTitle>Your controls</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Body>• Turn protection off at any time in Guard.</Body>
            <Body>• Revoke any trusted link and clear all history in Settings.</Body>
            <Body>• Deleting the app removes the device identity; server-side summaries become unlinkable.</Body>
          </Card>
        </View>
        <Text style={s.legal}>Disclosure version {DISCLOSURE_VERSION}. Apollo does not sell data, run advertising, or use your data to train AI models.</Text>
      </ScrollView>
      {!setupDone ? (
        <View style={[s.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {error ? <Text style={{ color: colors.barking, fontFamily: fonts.textMedium }} testID="disclosure-error">{error}</Text> : null}
          <Button testID="disclosure-accept-button" label={busy ? "Setting up…" : "I understand — set up Apollo"} onPress={accept} disabled={busy} icon={busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : undefined} />
          <Button testID="disclosure-back-button" variant="ghost" label="Back" onPress={() => router.back()} />
        </View>
      ) : null}
    </View>
  );
}
