// Australian privacy disclosure. Shown during setup (before the device
// identity is created) and reachable from Settings. Implements the
// "Transparent Data Use and Necessary Sharing" governing principle.

import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Smartphone from "lucide-react-native/icons/smartphone";
import Server from "lucide-react-native/icons/server";
import Globe from "lucide-react-native/icons/globe";
import React, { useState, useCallback } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { goBackOrHome } from "@/src/utils/navigation";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import {
  GOVERNING_PRINCIPLE,
  PROCESSING_LOCATIONS,
  CAPABILITY_DATA_USE,
  PRIVACY_FLOWS,
  LOCAL_ONLY_CONTENT,
  AI_PROCESSING_DISCLOSURE,
  PRIVACY_STANDARDS_DISCLOSURE,
  THIRD_PARTY_SERVICES_DISCLOSURE,
} from '@/src/domain/privacyInventory';

export const DISCLOSURE_VERSION = "transparent-data-use-v3";

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
  credo: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface, textAlign: "center" as const, paddingVertical: spacing.md },
  locationCard: { gap: spacing.sm, paddingVertical: spacing.md },
  locationHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  locationLabel: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
  locationSummary: { fontFamily: fonts.text, fontSize: 13, lineHeight: 20, color: c.onSurface },
  locationDetail: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.muted, marginTop: spacing.xs },
  capRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  capHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  capName: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface, flex: 1 },
  capDetail: { marginTop: spacing.sm, gap: spacing.xs },
  capLabel: { fontFamily: fonts.textMedium, fontSize: 12, color: c.growlingText },
  capText: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.muted },
  arrow: { flexDirection: "row", gap: 2, alignItems: "center", paddingHorizontal: spacing.xs },
  arrowText: { fontFamily: fonts.text, fontSize: 20, color: c.muted },
}));

const SETUP_FAILURE_MESSAGE =
  "Apollo couldn\u2019t finish setting up protection. Nothing has been activated yet. Please try again shortly.";

const LOCATION_ICONS = { device: Smartphone, server: Server, external: Globe } as const;

/* ─── Expandable capability row ──────────────────────────────────────────── */
function CapabilityRow({ item, index }: { item: typeof CAPABILITY_DATA_USE[number]; index: number }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(v => !v), []);
  const Icon = open ? ChevronUp : ChevronDown;
  return (
    <View style={s.capRow} testID={`cap-row-${index}`}>
      <Pressable onPress={toggle} style={s.capHeader} accessibilityRole="button" accessibilityLabel={`${item.capability} details`}>
        <Text style={s.capName}>{item.capability}</Text>
        <Icon size={18} color={colors.muted} />
      </Pressable>
      {open && (
        <View style={s.capDetail}>
          <Text style={s.capLabel}>On your device</Text>
          <Text style={s.capText}>{item.local}</Text>
          <Text style={s.capLabel}>Apollo&apos;s services</Text>
          <Text style={s.capText}>{item.backend}</Text>
          <Text style={s.capLabel}>Third-party services</Text>
          <Text style={s.capText}>{item.thirdParty}</Text>
          <Text style={s.capLabel}>Information shared</Text>
          <Text style={s.capText}>{item.shared}</Text>
          <Text style={s.capLabel}>Why this is necessary</Text>
          <Text style={s.capText}>{item.necessary}</Text>
          <Text style={s.capLabel}>Activation</Text>
          <Text style={s.capText}>{item.activation}</Text>
          <Text style={s.capLabel}>Information withheld or minimised</Text>
          <Text style={s.capText}>{item.withheld}</Text>
        </View>
      )}
    </View>
  );
}

/* ─── Main screen ────────────────────────────────────────────────────────── */
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
  const [expandedLocations, setExpandedLocations] = useState<Record<number, boolean>>({});

  const toggleLocation = useCallback((i: number) => setExpandedLocations(prev => ({ ...prev, [i]: !prev[i] })), []);

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
        <Text style={s.title}>Privacy statement</Text>
        {setupDone ? <Pressable testID="disclosure-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable> : null}
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: spacing.xl }]} testID="disclosure-scroll">

        {/* ── Governing Principle ── */}
        <Card testID="disclosure-principle" style={{ gap: spacing.sm }}>
          <Text style={s.what}>{GOVERNING_PRINCIPLE.title}</Text>
          {GOVERNING_PRINCIPLE.body.map((p, i) => <Body key={i}>{p}</Body>)}
          <Text style={s.credo}>{GOVERNING_PRINCIPLE.credo}</Text>
          <Body>{GOVERNING_PRINCIPLE.accountability}</Body>
        </Card>

        {/* ── Three Processing Locations ── */}
        <View>
          <SectionTitle>{PROCESSING_LOCATIONS.title}</SectionTitle>
          <Card testID="disclosure-locations" style={{ gap: 0 }}>
            {PROCESSING_LOCATIONS.locations.map((loc, i) => {
              const Icon = LOCATION_ICONS[loc.icon];
              const expanded = expandedLocations[i];
              return (
                <Pressable key={loc.label} onPress={() => toggleLocation(i)} accessibilityRole="button" testID={`disclosure-loc-${i}`}>
                  <View style={s.locationCard}>
                    <View style={s.locationHeader}>
                      <Icon size={20} color={colors.growlingText} />
                      <Text style={s.locationLabel}>{loc.label}</Text>
                    </View>
                    <Text style={s.locationSummary}>{loc.summary}</Text>
                    {expanded && <Text style={s.locationDetail}>{loc.detail}</Text>}
                  </View>
                </Pressable>
              );
            })}
            <View style={s.arrow}>
              <Text style={s.arrowText}>{'\u2191'}</Text>
              <Body>Tap each location for more detail</Body>
            </View>
          </Card>
        </View>

        {/* ── Capability Data Use ── */}
        <View>
          <SectionTitle>How each capability uses your information</SectionTitle>
          <Body>Tap a capability to see what information goes where, why, and what is withheld.</Body>
          <Card testID="disclosure-capabilities" style={{ gap: 0, marginTop: spacing.sm }}>
            {CAPABILITY_DATA_USE.map((item, i) => (
              <CapabilityRow key={item.capability} item={item} index={i} />
            ))}
          </Card>
        </View>

        {/* ── What leaves your device ── */}
        <View>
          <SectionTitle>What leaves your device, and when</SectionTitle>
          <Card testID="disclosure-leaves">
            {PRIVACY_FLOWS.map((row, i) => (
              <View key={row.what} style={s.item} testID={`disclosure-flow-${i}`}>
                <Text style={s.what}>{row.what}</Text>
                <Text style={s.when}>{row.when}</Text>
                <Body>{row.detail}</Body>
              </View>
            ))}
          </Card>
        </View>

        {/* ── What never leaves ── */}
        <View>
          <SectionTitle>What Apollo does not retain from assessments</SectionTitle>
          <Card testID="disclosure-never" style={{ gap: spacing.sm }}>
            {LOCAL_ONLY_CONTENT.map((line) => <Body key={line}>{'\u2022'} {line}</Body>)}
            <Pill tone="resting" label="Enforced in code: an allow-list blocks anything else" />
          </Card>
        </View>

        {/* ── AI Investigation ── */}
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

        {/* ── Third-party services ── */}
        <View>
          <SectionTitle>{THIRD_PARTY_SERVICES_DISCLOSURE.title}</SectionTitle>
          <Card testID="disclosure-third-party" style={{ gap: spacing.md }}>
            <Body>{THIRD_PARTY_SERVICES_DISCLOSURE.intro}</Body>
            {THIRD_PARTY_SERVICES_DISCLOSURE.services.map((svc, i) => (
              <View key={svc.name} style={s.item} testID={`disclosure-svc-${i}`}>
                <Text style={s.what}>{svc.name}</Text>
                <Text style={s.when}>{svc.purpose}</Text>
                <Body>{svc.shared}</Body>
              </View>
            ))}
            <Body>{THIRD_PARTY_SERVICES_DISCLOSURE.footer}</Body>
            <Body>{THIRD_PARTY_SERVICES_DISCLOSURE.changes}</Body>
          </Card>
        </View>

        {/* ── Standards ── */}
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

        {/* ── Retention ── */}
        <View>
          <SectionTitle>Where data goes and how long it stays</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Body testID="disclosure-retention">Assessment request copies close immediately after success, failure, timeout or cancellation and never later than 15 minutes. Provider-side retention follows each configured API policy. Google, owner-managed storage and messaging services may process data outside Australia. Expiry of a cached reputation result is not deletion. Soft-deleted Patrol data and prior family deliveries may remain stored.</Body>
          </Card>
        </View>

        {/* ── Controls ── */}
        <View>
          <SectionTitle>Your controls</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Body>{'\u2022'} Turn supported protection off at any time in Gates.</Body>
            <Body>{'\u2022'} Revoke any trusted link and clear all history in Settings.</Body>
            <Body>{'\u2022'} Disconnect Gmail OAuth or disable notification access to stop future monitoring.</Body>
            <Body>{'\u2022'} Deleting the app does not erase server records or information already delivered to family.</Body>
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
          <Button testID="disclosure-accept-button" label={busy ? "Setting up\u2026" : "I understand \u2014 set up Apollo"} onPress={accept} disabled={busy} icon={busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : undefined} />
          <Button testID="disclosure-back-button" variant="ghost" label="Back" onPress={() => goBackOrHome(router)} />
        </View>
      ) : null}
    </View>
  );
}
