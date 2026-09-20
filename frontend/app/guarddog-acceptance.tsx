import { useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";

import { APP_ENV, SECURITY_CONFIG } from "@/src/config/appEnvironment";
import { getGuardDogCandidateConfig } from "@/src/security/guarddog/GuardDogCandidateConfig";
import { getNativeModule } from "@/src/security/nativeBridge";
import { makeStyles, spacing, useTheme } from "@/src/theme";

export default function GuardDogAcceptanceScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const enabled = APP_ENV !== "production" && SECURITY_CONFIG.androidEnforcementEngine === "guarddog_acceptance";

  async function grantPermission() {
    setBusy(true);
    try { setResult(await getNativeModule()?.requestProtectionPermission("vpn_config") ?? "Native module unavailable"); }
    catch (error) { setResult(String(error)); } finally { setBusy(false); }
  }

  async function runAcceptance() {
    setBusy(true);
    try {
      const native = getNativeModule(); if (!native) throw new Error("Apollo native module unavailable");
      const config = getGuardDogCandidateConfig();
      await native.configureGuardDogCandidate(JSON.stringify({ ...config, signedBundle: undefined }));
      const accepted = JSON.parse(await native.acceptGuardDogCandidateBundle(config.signedBundle)) as { accepted: boolean; reason?: string };
      if (!accepted.accepted) throw new Error(`Acceptance bundle rejected: ${accepted.reason ?? "unknown"}`);
      setResult(await native.runGuardDogCandidateAcceptance(8_000));
    } catch (error) { setResult(String(error)); } finally { setBusy(false); }
  }

  return <SafeAreaView testID="guarddog-acceptance-screen" style={s.safe}>
    <ScrollView contentContainerStyle={s.content}>
      <Text testID="guarddog-acceptance-title" style={s.title}>GuardDog Stage 1D Acceptance</Text>
      <Text testID="guarddog-acceptance-mode" style={s.body}>{enabled ? "Test-only candidate selected" : "Candidate disabled for this build"}</Text>
      <View style={s.actions}>
        <Pressable testID="guarddog-permission-button" accessibilityRole="button" accessibilityState={{ disabled: !enabled || busy }}
          disabled={!enabled || busy} onPress={grantPermission} style={[s.button, (!enabled || busy) && s.buttonDisabled]}>
          <Text style={s.buttonText}>Grant VPN permission</Text>
        </Pressable>
        <Pressable testID="guarddog-run-button" accessibilityRole="button" accessibilityState={{ disabled: !enabled || busy }}
          disabled={!enabled || busy} onPress={runAcceptance} style={[s.button, (!enabled || busy) && s.buttonDisabled]}>
          <Text style={s.buttonText}>Run consolidated acceptance</Text>
        </Pressable>
      </View>
      {busy ? <ActivityIndicator testID="guarddog-acceptance-loading" color={colors.brandPrimary} /> : null}
      <Text testID="guarddog-acceptance-result" selectable style={s.result}>{result || "No run recorded on this device."}</Text>
    </ScrollView>
  </SafeAreaView>;
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { color: colors.onSurface, fontSize: 30, fontWeight: "800" },
  body: { color: colors.onSurfaceSecondary, fontSize: 16 },
  actions: { gap: spacing.md },
  button: { minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  result: { color: colors.onSurface, fontSize: 13, lineHeight: 20, padding: spacing.md, borderRadius: 14, backgroundColor: colors.surfaceTertiary },
}));