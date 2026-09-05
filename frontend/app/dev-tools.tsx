// Developer tools — ONLY reachable when the build runs the mock adapters.
// Lets testers switch mock SecureCore scenarios and adapter behaviours.

import { Redirect, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { MockSecurityAdapter } from "@/src/security/MockSecurityAdapter";
import { IS_MOCK_SECURITY } from "@/src/security/securityAdapter";
import { IS_MOCK_SECURECORE, SecureCore, SecureCoreError, userMessageFor } from "@/src/security/securecore/SecureCore";
import { MockSecureCore } from "@/src/security/securecore/mock/MockSecureCore";
import { MOCK_SCENARIOS, MockScenarioEngine, type MockScenario } from "@/src/security/securecore/mock/MockSecureCoreScenarios";
import { SecureCoreLogger } from "@/src/security/securecore/SecureCoreLogger";
import { goBackOrHome } from "@/src/utils/navigation";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const ADAPTER_SCENARIOS = ["NORMAL", "PERMISSION_DENIED", "BLOCK_UNVERIFIED", "PROTECTION_UNAVAILABLE", "OPEN_WIFI", "CAPTIVE_PORTAL"] as const;

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, justifyContent: "center" },
  chipText: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurfaceSecondary },
  log: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
}));

export default function DevTools() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh, showToast } = useApollo();
  const [scenario, setScenario] = useState<MockScenario>(MockScenarioEngine.get());
  const [adapterScenario, setAdapterScenario] = useState<(typeof ADAPTER_SCENARIOS)[number]>(MockSecurityAdapter.scenario);
  const [result, setResult] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  useEffect(() => { const unsub = SecureCoreLogger.subscribe((e) => setLogs((l) => [`${e.at.slice(11, 19)} ${e.event}`, ...l].slice(0, 12))); return () => { unsub(); }; }, []);

  if (!IS_MOCK_SECURITY && !IS_MOCK_SECURECORE) return <Redirect href="/(tabs)/settings" />;

  const runOp = async (name: string, op: () => Promise<unknown>) => {
    try { const r = await op(); setResult(`${name}: ${JSON.stringify(r)}`); }
    catch (e) { setResult(`${name}: ${e instanceof SecureCoreError ? `${e.code} — ${userMessageFor(e.code)}` : String(e)}`); }
  };

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Developer tools</Text>
        <Pressable testID="dev-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="dev-scroll">
        <Pill tone="unknown" label="Mock builds only — never shipped" />

        <View>
          <SectionTitle>Security adapter scenario</SectionTitle>
          <Card style={{ gap: spacing.md }}>
            <View style={s.wrap}>
              {ADAPTER_SCENARIOS.map((sc) => (
                <Pressable key={sc} testID={`dev-adapter-${sc}`} style={[s.chip, adapterScenario === sc && { borderColor: colors.growling, backgroundColor: colors.growlingTint }]} onPress={() => { MockSecurityAdapter.setScenario(sc); setAdapterScenario(sc); void refresh(); showToast(`Adapter scenario: ${sc}`, "growling"); }}>
                  <Text style={[s.chipText, adapterScenario === sc && { color: colors.onSurface }]}>{sc}</Text>
                </Pressable>
              ))}
            </View>
            <Body>BLOCK_UNVERIFIED proves Biting is never shown without a verified block.</Body>
          </Card>
        </View>

        <View>
          <SectionTitle>SecureCore scenario</SectionTitle>
          <Card style={{ gap: spacing.md }}>
            <View style={s.wrap}>
              {MOCK_SCENARIOS.map((sc) => (
                <Pressable key={sc} testID={`dev-scenario-${sc}`} style={[s.chip, scenario === sc && { borderColor: colors.resting, backgroundColor: colors.restingTint }]} onPress={() => { MockSecureCore.setScenario(sc); setScenario(sc); }}>
                  <Text style={[s.chipText, scenario === sc && { color: colors.onSurface }]}>{sc}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.wrap}>
              <Button testID="dev-op-auth" variant="secondary" label="authenticate()" onPress={() => runOp("authenticate", () => SecureCore.authenticate("Test"))} />
              <Button testID="dev-op-sign" variant="secondary" label="signPayload()" onPress={() => runOp("signPayload", () => SecureCore.signPayload("apollo-test"))} />
              <Button testID="dev-op-attest" variant="secondary" label="getAttestation()" onPress={() => runOp("getAttestation", () => SecureCore.getAttestation())} />
              <Button testID="dev-op-status" variant="secondary" label="getSecurityStatus()" onPress={() => runOp("getSecurityStatus", () => SecureCore.getSecurityStatus())} />
              <Button testID="dev-op-caps" variant="secondary" label="getSecurityCapabilities()" onPress={() => runOp("getSecurityCapabilities", () => SecureCore.getSecurityCapabilities())} />
            </View>
            {result ? <Text style={s.log} selectable testID="dev-result">{result}</Text> : null}
          </Card>
        </View>

        <View>
          <SectionTitle>Safe log</SectionTitle>
          <Card>{logs.length === 0 ? <Body>No events yet.</Body> : logs.map((l, i) => <Text key={i} style={s.log}>{l}</Text>)}</Card>
        </View>
      </ScrollView>
    </View>
  );
}
