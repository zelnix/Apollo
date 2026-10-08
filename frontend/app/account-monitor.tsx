// Account Gate — Check My Accounts. The owner manages their own monitored email addresses, runs a
// breach-exposure check on demand, and reads the Higgins Weekly Account Exposure Report. Manual controls
// live here (Check It); the Gates tab shows only a read-only status. Apollo never asks for a password.
import { Redirect, useRouter } from "expo-router";
import KeyRound from "lucide-react-native/icons/key-round";
import Trash2 from "lucide-react-native/icons/trash";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { deriveGateState, maskEmail, nextScanLabel, type AccountScan, type MonitoredEmail, type WeeklyReport } from "@/src/domain/accountMonitor";
import { addMonitoredEmail, getLastCheckedAt, getLastReport, getLastScan, getMonitoredEmails, isValidEmail, removeMonitoredEmail, runScan } from "@/src/store/accountMonitorStore";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  input: { minHeight: 48, flex: 1, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  statTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  remove: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  link: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brandPrimary },
}));

export default function CheckMyAccounts() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, deviceId, showToast } = useApollo();
  const [emails, setEmails] = useState<MonitoredEmail[]>([]);
  const [scan, setScan] = useState<AccountScan | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const [e, sc, rp, ca] = await Promise.all([getMonitoredEmails(), getLastScan(), getLastReport(), getLastCheckedAt()]);
    setEmails(e); setScan(sc); setReport(rp); setLastCheckedAt(ca);
  };
  useEffect(() => { void reload(); }, []);

  const add = async () => {
    const value = input.trim().toLowerCase();
    if (!isValidEmail(value)) { setError("Enter a valid email address."); return; }
    setError(null); setInput("");
    setEmails(await addMonitoredEmail(value));
  };
  const remove = async (email: string) => { setEmails(await removeMonitoredEmail(email)); };

  const check = async () => {
    if (!deviceId) { setError("Apollo is still preparing this device."); return; }
    setBusy(true); setError(null);
    try {
      const outcome = await runScan(deviceId);
      setScan(outcome.scan); setReport(outcome.report); setLastCheckedAt(outcome.scan.at);
      showToast(outcome.diff.newExposures.length ? "Check complete — new exposure found. See the report below." : "Check complete. See the report below.", outcome.diff.newExposures.length ? "growling" : "neutral");
    } catch (e) { setError(e instanceof Error ? e.message : "Apollo couldn't complete the check. Try again in a moment."); }
    finally { setBusy(false); }
  };

  if (ready && !setupDone) return <Redirect href="/" />;
  const status = deriveGateState({ monitoredCount: emails.length, lastScan: scan, lastCheckedAt, checking: busy });

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check My Accounts</Text>
        <Pressable testID="monitor-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="monitor-scroll">
        <Body testID="monitor-intro">Apollo watches your own email addresses for appearing in known data breaches. Checks run weekly when you open the app, and you can run one any time. Apollo never asks for or stores a password.</Body>

        <Card testID="monitor-status" style={{ gap: spacing.sm, borderColor: toneColor(colors, status.tone) }}>
          <View style={s.row}><View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 }}><KeyRound size={20} color={toneColor(colors, status.tone)} /><Text style={s.statTitle} testID="monitor-status-title">{status.title}</Text></View></View>
          <Body testID="monitor-status-detail">{status.detail}</Body>
          {lastCheckedAt ? <Body testID="monitor-last-checked">Last checked {new Date(lastCheckedAt).toLocaleString()} · next weekly check around {nextScanLabel(lastCheckedAt)}.</Body> : null}
        </Card>

        <Card style={{ gap: spacing.sm }} testID="monitor-emails">
          <SectionTitle>Addresses you monitor</SectionTitle>
          {emails.length === 0 ? <Body testID="monitor-emails-empty">No addresses yet. Add one below to start monitoring.</Body> : emails.map((m) => (
            <View key={m.email} style={s.row} testID={`monitor-email-${m.email}`}>
              <Text style={[s.why, { flex: 1 }]} numberOfLines={1}>{maskEmail(m.email)}</Text>
              <Pressable testID={`monitor-remove-${m.email}`} accessibilityRole="button" accessibilityLabel={`Stop monitoring ${maskEmail(m.email)}`} onPress={() => void remove(m.email)} style={s.remove}><Trash2 size={18} color={colors.barking} /></Pressable>
            </View>
          ))}
          <View style={s.row}>
            <TextInput testID="monitor-input" style={s.input} value={input} onChangeText={(v) => { setInput(v); setError(null); }} placeholder="you@example.com" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" onSubmitEditing={() => void add()} returnKeyType="done" />
            <Button testID="monitor-add" variant="secondary" label="Add" onPress={() => void add()} disabled={!input.trim()} />
          </View>
          <Body testID="monitor-privacy">You're confirming these are your addresses. Removing one deletes its stored findings from this device. Addresses are sent only during a check and are never stored on Apollo's server.</Body>
        </Card>

        {error ? <Card testID="monitor-error"><Body>{error}</Body></Card> : null}
        <Button testID="monitor-run" label={busy ? "Checking…" : emails.length ? "Check my accounts now" : "Add an address first"} onPress={() => void check()} disabled={busy || emails.length === 0} />

        {report ? (
          <Card testID="monitor-report" style={{ gap: spacing.sm, borderColor: toneColor(colors, report.overall) }}>
            <View style={s.row}><Text style={s.statTitle} testID="monitor-report-headline">{report.headline}</Text><Pill tone={report.overall} label={report.overall === "resting" ? "All clear" : report.overall === "growling" ? "Action needed" : report.overall === "ears_up" ? "Worth a look" : "Partly checked"} testID="monitor-report-chip" /></View>
            <Body testID="monitor-report-generated">Higgins Weekly Account Exposure Report · {new Date(report.generatedAt).toLocaleString()}</Body>
            {report.sections.map((section, i) => (
              <View key={section.title} style={{ gap: 2 }} testID={`monitor-report-section-${i}`}>
                <Text style={s.label}>{section.title}</Text>
                {section.lines.length ? section.lines.map((line, j) => <Text key={j} style={s.why} testID={`monitor-report-section-${i}-line-${j}`}>• {line}</Text>) : <Body>Nothing to report here.</Body>}
              </View>
            ))}
            <Body testID="monitor-report-next">Next check around {report.nextScan}.</Body>
          </Card>
        ) : null}

        <Card style={{ gap: spacing.xs }} testID="monitor-attribution">
          <Body>Breach data provided by {report?.sourceLabel ?? scan?.sourceLabel ?? "XposedOrNot"}.</Body>
          <Pressable testID="monitor-attribution-link" accessibilityRole="link" onPress={() => void Linking.openURL("https://xposedornot.com/")}><Text style={s.link}>xposedornot.com</Text></Pressable>
          <Body>Appearing in a breach means your details were in leaked data — it is not the same as your account being broken into. A result of &quot;not found&quot; means not in this source, not proof you&apos;ve never been exposed.</Body>
        </Card>
      </KeyboardAwareScrollView>
    </View>
  );
}
