import { useRouter } from "expo-router";
import Eye from "lucide-react-native/icons/eye";
import Lock from "lucide-react-native/icons/lock";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill } from "@/src/components/ui";
import { PRIVACY_POLICY_SUMMARY } from "@/src/domain/privacy";
import { STATE_LABEL, STATE_MEANING, type ApolloState } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  eyebrow: { fontFamily: fonts.display, fontSize: 13, color: c.resting, letterSpacing: 1.4, textTransform: "uppercase" },
  title: { fontFamily: fonts.displayBold, fontSize: 34, color: c.onSurface, letterSpacing: -0.5, lineHeight: 40 },
  stateRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.sm },
  stateText: { flex: 1, gap: 2 },
  stateName: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  bullet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm },
  note: { fontFamily: fonts.text, fontSize: 12, color: c.muted, textAlign: "center" },
}));

const STATES: ApolloState[] = ["resting", "growling", "barking", "biting"];

export default function Onboarding() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { completeSetup, isMock, adapterLabel } = useApollo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true); setError(null);
    try { await completeSetup(); router.replace("/(tabs)/home"); }
    catch (e) { setError(e instanceof Error ? e.message : "Setup failed"); }
    finally { setBusy(false); }
  };

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + spacing["2xl"], paddingBottom: spacing.xl }]} testID="onboarding-screen">
        <Text style={s.eyebrow}>Apollo</Text>
        <Text style={s.title}>A calm guard dog for the links you tap.</Text>
        <Body>Apollo checks dangerous links, suspicious websites and known online threats. It tells you exactly what it can see, and never pretends to protect what it can&apos;t.</Body>

        <Card>
          {STATES.map((st) => (
            <View key={st} style={s.stateRow}>
              <Pill tone={st} label={st.charAt(0).toUpperCase() + st.slice(1)} />
              <View style={s.stateText}>
                <Text style={s.stateName}>{STATE_LABEL[st]}</Text>
                <Body>{STATE_MEANING[st]}</Body>
              </View>
            </View>
          ))}
        </Card>

        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md }}>
            <Lock size={18} color={colors.resting} />
            <Text style={s.stateName}>Privacy first</Text>
          </View>
          {PRIVACY_POLICY_SUMMARY.map((line) => (
            <View key={line} style={[s.bullet, { marginBottom: spacing.sm }]}>
              <Eye size={14} color={colors.muted} style={{ marginTop: 4 }} />
              <Body style={{ flex: 1 }}>{line}</Body>
            </View>
          ))}
        </Card>

        {isMock ? <Pill tone="unknown" label={`${adapterLabel} · development build`} testID="onboarding-mock-pill" /> : null}
        {error ? <Text style={{ color: colors.barking, fontFamily: fonts.textMedium }} testID="onboarding-error">{error}</Text> : null}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button testID="onboarding-start-button" label={busy ? "Setting up…" : "Set up Apollo"} onPress={start} disabled={busy} icon={busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <ShieldCheck size={18} color={colors.onBrandPrimary} />} />
        <Text style={s.note}>Creates an anonymous device identity. No account needed.</Text>
      </View>
    </View>
  );
}
