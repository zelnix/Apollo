import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AlertPreviewSheet } from "@/src/components/AlertPreviewSheet";
import { Sheet } from "@/src/components/Sheet";
import { TimeStepper } from "@/src/components/TimeStepper";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import type { NotificationStatus } from "@/src/push/notifications";
import { useApollo } from "@/src/store/ApolloContext";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { minimiseApp } from "@/src/utils/minimise";
import { goBackOrHome } from "@/src/utils/navigation";
import { getHigginsAuto, setHigginsAuto, useHiggins } from "@/src/voice/higgins";

const ALERT_LABEL: Record<NotificationStatus, string> = { granted: "Allowed", denied: "Not allowed", undetermined: "Not decided", blocked: "Blocked in Settings", unsupported: "Not available here" };
// The voluntary "Support Apollo" contribution card stays feature-gated until the approved copy and real
// public Stripe Payment Links exist. It never unlocks protection or creates a paid security tier.
const SHOW_CONTRIBUTION = false;

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 28, color: c.onSurface },
  close: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  rowItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48, paddingVertical: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: c.divider },
  rowLabel: { fontFamily: fonts.textMedium, fontSize: 16, color: c.onSurface },
  rowHint: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted, marginTop: 2 },
  trustRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider },
  footer: { fontFamily: fonts.text, fontSize: 12, color: c.muted, textAlign: "center" },
}));

export default function SettingsScreen() {
  const s = useStyles(); const insets = useSafeAreaInsets(); const router = useRouter(); const { colors } = useTheme();
  const { deviceId, trust, revokeTrust, clearPatrol, notificationStatus, enableNotifications, quietHours, quietNow, setQuietHours, lowPower, setLowPower, showToast, enableSiteProtection } = useApollo();
  const [higginsAuto, setHigginsAutoState] = useState(false); const [confirmClear, setConfirmClear] = useState(false); const [preview, setPreview] = useState(false);
  const [showTrust, setShowTrust] = useState(false); const [showShare, setShowShare] = useState(false);
  useEffect(() => { void getHigginsAuto().then(setHigginsAutoState); }, []);
  const higgins = useHiggins(deviceId);

  // Site Gate (Android VPN-filter): show a contextual enable action only when setup/action is required.
  // Verified coverage and health live in Gates — no duplicate status dashboard here.
  const health = useProtectionHealth();
  const siteGate = health.gates.find((gate) => gate.id === "site");
  const siteState = siteGate?.capability.automatic?.state;
  const canEnableSite = !!siteState && !["running", "checking", "unsupported"].includes(siteState);
  const [enablingSite, setEnablingSite] = useState(false);
  const grantSiteGate = async () => {
    setEnablingSite(true);
    try {
      const granted = await enableSiteProtection();
      showToast(granted ? "Site Gate is on." : "Site Gate needs VPN permission. Your other protection stays active.", granted ? "resting" : "growling");
    } catch { showToast("Android could not open the VPN permission screen. Try again shortly.", "growling"); }
    finally { setEnablingSite(false); }
  };

  const NavRow = ({ label, hint, onPress, testID, first }: { label: string; hint?: string; onPress: () => void; testID: string; first?: boolean }) => (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[s.rowItem, !first && s.divider]}>
      <View style={{ flex: 1 }}><Text style={s.rowLabel}>{label}</Text>{hint ? <Text style={s.rowHint}>{hint}</Text> : null}</View>
      <ChevronRight size={20} color={colors.muted} />
    </Pressable>
  );
  const SwitchRow = ({ label, hint, value, onValueChange, testID, first }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void; testID: string; first?: boolean }) => (
    <View style={[s.rowItem, !first && s.divider]}>
      <View style={{ flex: 1 }}><Text style={s.rowLabel}>{label}</Text>{hint ? <Text style={s.rowHint}>{hint}</Text> : null}</View>
      <Switch testID={testID} value={value} onValueChange={onValueChange} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} />
    </View>
  );

  return <View style={s.root} testID="settings-screen">
    <View style={[s.top, { paddingTop: insets.top + spacing.md }]}><Text style={s.title} testID="settings-title">Settings</Text><Pressable testID="settings-close" accessibilityRole="button" accessibilityLabel="Close Settings" onPress={() => goBackOrHome(router)} style={s.close}><X size={22} color={colors.onSurface} /></Pressable></View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="settings-scroll">

      <View><SectionTitle>Protection &amp; permissions</SectionTitle>
        <Card testID="settings-protection">
          <NavRow first label="Website protection" hint="See its verified coverage in Gates" onPress={() => router.push("/(tabs)/guard?gate=site")} testID="settings-site-gates" />
          {Platform.OS === "android" && canEnableSite ? (
            <View style={[s.rowItem, s.divider, { flexDirection: "column", alignItems: "stretch", gap: spacing.sm }]} testID="settings-site-gate">
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}><Text style={s.rowLabel}>Site Gate (VPN filter)</Text><Pill tone="growling" label={siteGate?.statusLabel ?? "Setup available"} testID="settings-site-status" /></View>
              <Body>Grant VPN permission anytime to filter known dangerous websites. Your other protection keeps working whether or not this is on.</Body>
              <Button testID="settings-site-enable" variant="secondary" label={enablingSite ? "Turning on…" : "Turn on Site Gate"} disabled={enablingSite} onPress={() => void grantSiteGate()} />
            </View>
          ) : null}
        </Card>
      </View>

      <View><SectionTitle>Alerts &amp; voice</SectionTitle>
        <Card testID="settings-alerts">
          <View style={s.rowItem}>
            <View style={{ flex: 1 }}><Text style={s.rowLabel}>Important security alerts</Text><Text style={s.rowHint}>Permission alone does not prove an alert was delivered.</Text></View>
            <Pill tone={notificationStatus === "granted" ? "resting" : notificationStatus === "unsupported" ? "unknown" : "growling"} label={ALERT_LABEL[notificationStatus]} testID="settings-push-status" />
          </View>
          {notificationStatus === "denied" || notificationStatus === "undetermined" ? <Button testID="settings-push-enable" variant="secondary" label="Allow security alerts" onPress={() => void enableNotifications()} /> : null}
          {notificationStatus === "blocked" ? <Button testID="settings-push-settings" variant="secondary" label="Open notification settings" onPress={() => void Linking.openSettings()} /> : null}
          <View style={[s.rowItem, s.divider]}><View style={{ flex: 1 }}><Text style={s.rowLabel}>Preview an alert</Text></View><Button testID="settings-alert-preview" variant="ghost" label="Preview" onPress={() => setPreview(true)} /></View>
          <SwitchRow label="Quiet hours" hint="Silence non-urgent reminders at night. Urgent threat and family alerts still appear." value={quietHours.enabled} onValueChange={(value) => void setQuietHours({ ...quietHours, enabled: value })} testID="settings-quiet-switch" />
          {quietHours.enabled ? <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}><View style={{ flexDirection: "row", gap: spacing.md }}><TimeStepper testID="settings-quiet-start" label="From" minutes={quietHours.start_minutes} onChange={(minutes) => void setQuietHours({ ...quietHours, start_minutes: minutes })} /><TimeStepper testID="settings-quiet-end" label="Until" minutes={quietHours.end_minutes} onChange={(minutes) => void setQuietHours({ ...quietHours, end_minutes: minutes })} /></View><Pill tone={quietNow ? "unknown" : "resting"} label={quietNow ? "Quiet hours are active" : "Quiet hours are not active now"} testID="settings-quiet-now" /></View> : null}
          <SwitchRow label="Higgins reads urgent explanations aloud" hint="Written guidance stays available when audio is off." value={higginsAuto} onValueChange={(value) => { setHigginsAutoState(value); void setHigginsAuto(value); }} testID="settings-higgins-auto" />
          <View style={[s.rowItem, s.divider]}><View style={{ flex: 1 }}><Text style={s.rowLabel}>Hear a sample</Text></View><Button testID="settings-higgins-sample" variant="ghost" label={higgins.busy ? "Preparing…" : higgins.speaking ? "Stop" : "Play"} onPress={() => void higgins.speak("Higgins here. I will explain what Apollo found and what you can do next.").catch(() => showToast("Audio isn't available right now.", "neutral"))} /></View>
        </Card>
      </View>

      <View><SectionTitle>App preferences</SectionTitle>
        <Card testID="settings-preferences">
          <SwitchRow first label="Battery saver" hint="Reduces animation and checks status less often. It does not change the protection status in Gates." value={lowPower} onValueChange={(value) => void setLowPower(value)} testID="settings-lowpower-switch" />
          <NavRow label="Minimise Apollo" hint="Move Apollo to the background" onPress={() => void minimiseApp(showToast)} testID="settings-minimise" />
        </Card>
      </View>

      <View><SectionTitle>Family &amp; trusted links</SectionTitle>
        <Card testID="settings-family-trust">
          <NavRow first label="Family sharing" hint="Choose a trusted person for alerts you deliberately share" onPress={() => router.push("/family")} testID="settings-family" />
          <Pressable testID="settings-trust" accessibilityRole="button" onPress={() => setShowTrust((v) => !v)} style={[s.rowItem, s.divider]}>
            <View style={{ flex: 1 }}><Text style={s.rowLabel}>Trusted links</Text><Text style={s.rowHint}>Trust applies to one exact link and never overrides a confirmed threat.</Text></View>
            <Pill tone="neutral" label={String(trust.length)} testID="settings-trust-count" /><ChevronRight size={20} color={colors.muted} />
          </Pressable>
          {showTrust ? (trust.length === 0 ? <Body testID="settings-trust-empty" style={{ paddingTop: spacing.sm }}>No trusted links.</Body> : trust.map((entry) => <View key={entry.trust_id} style={s.trustRow} testID={`settings-trust-${entry.trust_id}`}><View style={{ flex: 1 }}><Text style={s.rowLabel}>{entry.indicator_host}</Text><Body>Exact link · {new Date(entry.created_at).toLocaleDateString()}</Body></View><Button testID={`settings-revoke-${entry.trust_id}`} variant="secondary" label="Remove" onPress={() => revokeTrust(entry)} /></View>)) : null}
        </Card>
      </View>

      <View><SectionTitle>Privacy &amp; data</SectionTitle>
        <Card testID="settings-privacy">
          <NavRow first label="Privacy statement" hint="What Apollo stores, shares and why" onPress={() => router.push("/privacy-disclosure")} testID="settings-privacy-disclosure" />
          <NavRow label="Clear Patrol history" hint="Hide local summaries and ask the service to hide synced ones" onPress={() => setConfirmClear(true)} testID="settings-clear-patrol" />
        </Card>
      </View>

      <View><SectionTitle>Help &amp; about</SectionTitle>
        <Card testID="settings-help">
          <NavRow first label="Get help with Apollo" hint="App details, protection issues, Higgins checkup and support email" onPress={() => router.push("/support")} testID="settings-open-support" />
          <Pressable testID="settings-share" accessibilityRole="button" onPress={() => setShowShare((v) => !v)} style={[s.rowItem, s.divider]}>
            <View style={{ flex: 1 }}><Text style={s.rowLabel}>How to share into Apollo</Text></View><ChevronRight size={20} color={colors.muted} />
          </Pressable>
          {showShare ? <Body testID="settings-share-help" style={{ paddingBottom: spacing.sm }}>Use Share in Messages, Mail or your browser, then choose Apollo. Apollo always waits for you to confirm before it checks anything you share.</Body> : null}
          <View style={[s.rowItem, s.divider, { flexDirection: "column", alignItems: "stretch", gap: 4 }]} testID="settings-about">
            <Text style={s.rowLabel}>About Apollo</Text>
            <Body>Apollo is a brand of Harmony Wellness Group. Apollo performs supported checks and protection; Higgins explains findings and the next step.</Body>
          </View>
        </Card>
      </View>

      {SHOW_CONTRIBUTION ? <View testID="settings-contribution"><SectionTitle>Support Apollo</SectionTitle><Card><Body>Apollo protects everyone. If you believe in the mission, help keep Apollo on watch.</Body></Card></View> : null}

      <Text style={s.footer} testID="settings-footer">Apollo V1 · No account · No advertising tracking</Text>
    </ScrollView>
    <AlertPreviewSheet visible={preview} onClose={() => setPreview(false)} />
    <Sheet visible={confirmClear} onClose={() => setConfirmClear(false)} title="Clear Patrol history?" testID="clear-sheet"><Body>This hides Patrol items on this device and asks the service to hide synced summaries. Trusted links are kept.</Body><Button testID="clear-confirm" variant="danger" label="Clear history" onPress={() => { setConfirmClear(false); void clearPatrol(); }} /><Button testID="clear-cancel" variant="ghost" label="Keep history" onPress={() => setConfirmClear(false)} /></Sheet>
  </View>;
}
