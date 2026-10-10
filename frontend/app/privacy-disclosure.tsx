// Australian privacy disclosure. Shown during setup (before the device
// identity is created) and reachable from Settings. Lists exactly what
// leaves the device, when, and what never does.

import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { goBackOrHome } from "@/src/utils/navigation";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { PRIVACY_FLOWS, LOCAL_ONLY_CONTENT, AI_PROCESSING_DISCLOSURE, PRIVACY_STANDARDS_DISCLOSURE } from '@/src/domain/privacyInventory';

export const DISCLOSURE_VERSION = "purpose-limited-v2";

const LEAVES_DEVICE = PRIVACY_FLOWS;
const NEVER_LEAVES = LOCAL_ONLY_CONTENT;

const SETUP_FAILURE_MESSAGE =
  "Apollo couldn\u2019t finish setting up protection. Nothing has been activated yet. Please try again shortly.";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  item: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  what: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  when: { fontFamily: fonts.textMedium, fontSize: 13, color: c.growlingText },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  legal: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.muted },
  errorBox: { gap: spacing.xs },
  errorText: { color: c.barkingText, fontFamily: fonts.textMedium, fontSize: 14 },
  detailToggle: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted, textDecorationLine: "underline" as const },
  detailText: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: spacing.xs },
}));

export default function PrivacyDisclosure() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setupDone, completeSetup } = useApollo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [technicalDetail, setTechnicalDetail] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const accept = async () => {
    setBusy(true); setError(null); setTechnicalDetail(null); setShowDetail(false);
    try { await completeSetup(); router.replace("/setup-gates"); }
    catch (e) {
      setError(SETUP_FAILURE_MESSAGE);
      setTechnicalDetail(e instanceof Error ? e.message : String(e));
    }
    finally { setBusy(false); }
  };

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Privacy disclosure</Text>
        {setupDone ? <Pressable testID="disclosure-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable> : null}
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: spacing.xl }]} testID="disclosure-scroll">
        <Body testID="disclosure-intro">Apollo is a brand of Harmony Wellness Group. Local detection is combined with purpose-limited online investigation only when you submit content or separately enable an optional connection. The inventory below explains what leaves your device, why and for how long. This engineering disclosure is not a legal compliance certification.</Body>

        <View>
          <SectionTitle>What leaves your device, and when</SectionTitle>
          <Card testID="disclosure-leaves">
            {LEAVES_DEVICE.map((row, i) => (
              <View key={row.what} style={s.item} testID={`disclosure-flow-${i}`}>
                <Text style={s.what}>{row.what}</Text>
                <Text style={s.when}>{row.when}</Text>
                <Body>{row.detail}</Body>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>What Apollo does not retain from assessments</SectionTitle>
          <Card testID="disclosure-never" style={{ gap: spacing.sm }}>
            {NEVER_LEAVES.map((line) => <Body key={line}>• {line}</Body>)}
            <Pill tone="resting" label="Enforced in code: an allow-list blocks anything else" />
          </Card>
        </View>

        <View>
          <SectionTitle>{AI_PROCESSING_DISCLOSURE.title}</SectionTitle>
          <Card testID="disclosure-ai-processing" style={{ gap: spacing.md }}>
            {AI_PROCESSING_DISCLOSURE.sections.map((section, i) => (
              <View key={section.heading} style={s.item} testID={`disclosure-ai-${i}`}>
                <Text style={s.what}>{section.heading}</Text>
                <Body>{section.text}</Body>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>{PRIVACY_STANDARDS_DISCLOSURE.title}</SectionTitle>
          <Card testID="disclosure-standards" style={{ gap: spacing.md }}>
            <Body>{PRIVACY_STANDARDS_DISCLOSURE.intro}</Body>
            {PRIVACY_STANDARDS_DISCLOSURE.standards.map((std, i) => (
              <View key={std.name} style={s.item} testID={`disclosure-std-${i}`}>
                <Text style={s.what}>{std.name}</Text>
                <Body>{std.role}</Body>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>Where data goes and how long it stays</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Body testID="disclosure-retention">Assessment request copies close immediately after success, failure, timeout or cancellation and never later than 15 minutes. Provider-side retention follows each configured API policy. Google, owner-managed storage and messaging services may process data outside Australia. Expiry of a cached reputation result is not deletion. Soft-deleted Patrol data and prior family deliveries may remain stored.</Body>
          </Card>
        </View>

        <View>
          <SectionTitle>Your controls</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Body>• Turn supported protection off at any time in Gates.</Body>
            <Body>• Revoke any trusted link and clear all history in Settings.</Body>
            <Body>• Disconnect Gmail OAuth or disable notification access to stop future monitoring.</Body>
            <Body>• Deleting the app does not erase server records or information already delivered to family.</Body>
          </Card>
        </View>
        <Text style={s.legal} testID="disclosure-version">Disclosure version {DISCLOSURE_VERSION}. Optional communication features transmit the content you choose to send; never include passwords or verification codes.</Text>
      </ScrollView>
      {!setupDone ? (
        <View style={[s.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {error ? (
            <View style={s.errorBox}>
              <Text style={s.errorText} testID="disclosure-error">{error}</Text>
              {technicalDetail ? (
                <>
                  <Pressable onPress={() => setShowDetail((v) => !v)} accessibilityRole="button">
                    <Text style={s.detailToggle}>{showDetail ? "Hide details" : "More details"}</Text>
                  </Pressable>
                  {showDetail ? <Text style={s.detailText} testID="disclosure-error-detail" selectable>{technicalDetail}</Text> : null}
                </>
              ) : null}
            </View>
          ) : null}
          <Button testID="disclosure-accept-button" label={busy ? "Setting up…" : "I understand — set up Apollo"} onPress={accept} disabled={busy} icon={busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : undefined} />
          <Button testID="disclosure-back-button" variant="ghost" label="Back" onPress={() => goBackOrHome(router)} />
        </View>
      ) : null}
    </View>
  );
}
