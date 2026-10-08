// Gate 7 — Check My Device. Shows only what this platform/build can truthfully see, plus what the user
// reports. Produces a device security status (Protected / Review / Action / Recovery) — never a "full scan".
import { GateInvestigation } from "@/src/components/GateInvestigation";
import { Redirect, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markCheckDone } from "@/src/store/checkCompletion";
import { CheckHistoryCard } from "@/src/components/CheckHistoryCard";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { GateAbout } from "@/src/components/GateAbout";
import { assessDevice, deriveDeviceSecurityChanges, DEVICE_CHANGE_LABEL, DEVICE_STATUS, EMPTY_SIGNALS, SELF_REPORT, type DeviceFinding, type DevicePlatform, type DeviceSecurityChange, type DeviceSignals, type SelfReport } from "@/src/domain/deviceAnalysis";
import { groupByCategory, OUTCOME_LABEL, OUTCOME_TONE, overallState, runDeviceReview, type CheckResult, type ReviewPlatform } from "@/src/domain/deviceReview";
import { STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { AppDeviceSdk } from "@/src/security/appDeviceSdk";
import { securityAdapter } from "@/src/security/securityAdapter";
import { desktopHostKind } from "@/src/security/desktopHost";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { openDeviceSettings, type SettingsTarget } from "@/src/utils/deviceSettings";
import { goBackOrHome } from "@/src/utils/navigation";
import { storage } from "@/src/utils/storage";
import { issueContext } from "@/src/domain/higginsHandoff";

const TARGET: Record<string, SettingsTarget> = { D01: "apps", D01b: "apps", D02: "security", D03: "security", D04: "vpn", D05: "accessibility", D06: "apps", D07: "apps", D08: "unknown_sources", D09: "overlay", D10: "notification_access", D11: "developer" };
// Deep-link target for each review check so "Open Settings" lands the person on the right screen.
const REVIEW_TARGET: Record<string, SettingsTarget> = { lock: "security", os_updates: "security", developer_mode: "developer", apollo_protection: "vpn", antivirus: "security", unknown_sources: "unknown_sources", remote_access: "apps", accessibility: "accessibility", unexpected_app: "apps", sensitive_permissions: "apps", notification_access: "notification_access", sharing_services: "security", vpn: "vpn", firewall: "security", management_profile: "security", certificates: "security", encryption: "security", backup: "security" };
const DEVICE_SNAPSHOT_KEY = "apollo.device.signals.v1";
const DEVICE_CHANGELOG_KEY = "apollo.device.changelog.v1";
const SEVERITY_RANK: Record<DeviceFinding["severity"], number> = { high: 2, review: 1, info: 0 };
interface DeviceSubmission { submissionId: string; result: ReturnType<typeof assessDevice>; observedAt: string; source: "device_check" | "user_report" }

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  statusTitle: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  step: { flexDirection: "row", gap: spacing.sm },
  num: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brandPrimary, width: 20 },
  mono: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  catLabel: { fontFamily: fonts.textSemibold, fontSize: 13, letterSpacing: 0.3, color: c.muted, textTransform: "uppercase" },
}));

export default function CheckDevice() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, upsertEvent, deviceId, adapterLabel, showToast, protection, permissions, verifyNow } = useApollo();
  const platform: DevicePlatform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  // On a desktop (Tauri) host Platform.OS is "web", but the host can observe Windows/macOS settings — review as that OS.
  const hostKind = desktopHostKind();
  const [signals, setSignals] = useState<DeviceSignals>(EMPTY_SIGNALS(hostKind ?? platform));
  const [self, setSelf] = useState<SelfReport>({});
  const [event, setEvent] = useState<PatrolEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(true);
  const [changes, setChanges] = useState<DeviceSecurityChange[]>([]);
  const [changeLog, setChangeLog] = useState<DeviceSecurityChange[]>([]);
  const [logReviewOnly, setLogReviewOnly] = useState(false);
  const [settingsGuidance, setSettingsGuidance] = useState<string | null>(null);
  const [checkSequence, setCheckSequence] = useState(0);
  const refreshDevice = useCallback(async (notify = false) => {
    setChecking(true);
    try {
      const collectSignals = hostKind && securityAdapter.getDeviceSecuritySignals ? securityAdapter.getDeviceSecuritySignals() : AppDeviceSdk.getDeviceSecuritySignals(platform);
      const [nextSignals, recent, previousRaw] = await Promise.all([collectSignals, AppDeviceSdk.getRecentAppSecurityEvents(), storage.getItem<string | null>(DEVICE_SNAPSHOT_KEY, null), verifyNow()]);
      const previous = previousRaw ? JSON.parse(previousRaw) as DeviceSignals : null;
      const observedChanges = deriveDeviceSecurityChanges(previous, nextSignals, new Date().toISOString(), protection?.running === true);
      setSignals(nextSignals);
      setChanges([...recent, ...observedChanges].filter((item, index, all) => all.findIndex((candidate) => candidate.eventType === item.eventType && candidate.appName === item.appName) === index));
      await storage.setItem(DEVICE_SNAPSHOT_KEY, JSON.stringify(nextSignals));
      // Dated log of security/privacy/protection setting changes. Apollo-caused changes keep their
      // "apollo" attribution; everything else is "user_or_unknown". Newest first, capped at 50.
      if (observedChanges.length) {
        const priorRaw = await storage.getItem<string | null>(DEVICE_CHANGELOG_KEY, null);
        const prior = priorRaw ? JSON.parse(priorRaw) as DeviceSecurityChange[] : [];
        const merged = [...observedChanges, ...prior].slice(0, 50);
        await storage.setItem(DEVICE_CHANGELOG_KEY, JSON.stringify(merged));
        setChangeLog(merged);
      }
      void markCheckDone("device");
      if (notify) showToast("Device Gate checked the signals this platform exposes.", "neutral");
    } catch {
      if (notify) showToast("Device Gate couldn't refresh every signal. The visible limits are listed below.", "growling");
    } finally { setChecking(false); setCheckSequence((value) => value + 1); }
  }, [platform, hostKind, showToast, verifyNow, protection?.running, storage]);
  useEffect(() => { void refreshDevice(false); }, [refreshDevice]);
  useEffect(() => { void storage.getItem<string | null>(DEVICE_CHANGELOG_KEY, null).then((raw) => { if (raw) setChangeLog(JSON.parse(raw) as DeviceSecurityChange[]); }); }, [storage]);
  const context = useMemo(() => ({
    protection: protection ? { requested: protection.requested, operational: protection.operational, degradedReason: protection.degradedReason,
      permissionIssues: permissions.filter((permission) => permission.status === "denied" || permission.status === "blocked").map((permission) => permission.title), checkedAt: protection.checkedAt } : null,
    recentChanges: changes,
  }), [changes, permissions, protection]);
  const result = useMemo(() => assessDevice(signals, self, context), [signals, self, context]);
  const meta = DEVICE_STATUS[result.status];
  // Cross-platform Security & Privacy Review — every applicable setting gets an explicit outcome.
  const reviewPlatform: ReviewPlatform | null = hostKind ?? (platform === "web" ? null : platform);
  const review = useMemo(() => reviewPlatform ? runDeviceReview({ platform: reviewPlatform, signals, self, protection: context.protection }) : null, [reviewPlatform, signals, self, context.protection]);
  const reviewGroups = useMemo(() => review ? groupByCategory(review) : [], [review]);
  const openCheck = (r: CheckResult) => {
    if (!r.settings) return;
    if (platform === "web") setSettingsGuidance(`${r.title}: ${r.settings}`);
    else void openDeviceSettings(REVIEW_TARGET[r.id] ?? "security", r.settings, (m) => showToast(m, "neutral"));
  };
  const anySelf = Object.values(self).some(Boolean);
  // Each completed device check is a fresh timestamped observation. GateInvestigation uses a continuity key, so a
  // new submission appends to the SAME case rather than replacing its accepted history.
  const [submission, setSubmission] = useState<DeviceSubmission | null>(null);
  useEffect(() => { if (checkSequence) setSubmission({ submissionId: Crypto.randomUUID(), result, observedAt: new Date().toISOString(), source: "device_check" }); }, [checkSequence]); // eslint-disable-line react-hooks/exhaustive-deps
  const [historyKey, setHistoryKey] = useState(0);
  useEffect(() => { if (checkSequence) { void recordCheck("device", { at: new Date().toISOString(), state: result.state, summary: meta.title }); setHistoryKey((k) => k + 1); } }, [checkSequence]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    try {
      const ev = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "device", state: result.state, status: "active", headline: `Device: ${meta.title}`, what_happened: result.summary, why: result.findings.map((f) => `${f.title}: ${f.plain}`), what_to_do: result.recoverySteps[0] ?? result.findings[0]?.action ?? "Review the items Apollo listed.", indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: null, scenario: result.findings[0]?.id ?? "D00" });
      setEvent(ev);
      showToast("Saved to Patrol. Apollo will stay with you.", "neutral");
    } finally { setSaving(false); }
  };
  const open = (f: DeviceFinding) => {
    const dynamic: SettingsTarget | null = f.id.includes("vpn_change") ? "vpn" : f.id.includes("profile_change") ? "security" : f.id.includes("service_enabled") ? "accessibility" : null;
    if (platform === "web") setSettingsGuidance(`${f.title}: ${f.settings}`);
    else void openDeviceSettings(dynamic ?? TARGET[f.id] ?? (f.id === "D12" || f.id === "D13" ? "vpn" : "apps"), f.settings, (m) => showToast(m, "neutral"));
  };
  const openChange = (change: DeviceSecurityChange) => {
    const target: SettingsTarget = change.eventType === "vpn_change" ? "vpn" : change.eventType === "profile_change" ? "security" : change.eventType === "service_enabled" ? "accessibility" : "apps";
    const label = DEVICE_CHANGE_LABEL[change.eventType];
    if (platform === "web") setSettingsGuidance(`${label}: open the matching settings screen to confirm this change.`);
    else void openDeviceSettings(target, label, (m) => showToast(m, "neutral"));
  };
  const firstAction = [...result.findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0] ?? null;
  const submissionFirstAction = useMemo(() => submission ? [...submission.result.findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0] ?? null : null, [submission]);

  if (ready && !setupDone) return <Redirect href="/" />;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Device Gate</Text>
        <Pressable testID="device-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="device-scroll">
        <GateAbout title="What the Device Gate checks" testID="device-gate-scope"
          tip="An app you don't remember installing, one with camera, microphone or Accessibility access it shouldn't need, or security settings (lock screen, Play Protect, updates) switched off.">
          <Body>Device Gate checks existing apps with visible sensitive access, current security settings and Apollo&apos;s own protection health—not only recent installs. It does not continuously scan every dormant app, and app capabilities are not proof of malicious behaviour.</Body>
        </GateAbout>
        <Card testID="device-status" style={{ borderColor: toneColor(colors, review ? overallState(review.overall) : result.state), gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><ShieldCheck size={22} color={toneColor(colors, review ? overallState(review.overall) : result.state)} /><Pill tone={review ? overallState(review.overall) : result.state} label={review ? review.overallLabel : STATE_NAME[result.state]} testID="device-state" /></View>
          <Text style={s.statusTitle} testID="device-status-title">{review ? review.overallLabel : meta.title}</Text>
          <Text style={s.why} testID="device-summary">{review ? review.summary : result.summary}</Text>
          {review ? <Body testID="device-coverage">{review.coverage.automated} of {review.coverage.total} settings checked automatically here; Higgins can help with the rest below.</Body> : <Body>{meta.meaning}</Body>}
        </Card>
        {settingsGuidance ? <Card testID="device-settings-guidance" style={{ gap: spacing.sm }}><SectionTitle>Settings steps</SectionTitle><Body>{settingsGuidance}</Body><Button testID="device-settings-guidance-close" variant="ghost" label="Hide instructions" onPress={() => setSettingsGuidance(null)} /></Card> : null}
        {changeLog.length ? (
          <Card testID="device-change-log" style={{ gap: spacing.sm }}>
            <SectionTitle>Recent security setting changes</SectionTitle>
            <Body>Changes Apollo has observed to security, privacy or protection settings. Changes Apollo made for its own protection are tagged “Apollo”. Tap any entry to open the matching settings screen.</Body>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button testID="device-log-filter-all" variant={logReviewOnly ? "ghost" : "secondary"} label="All" onPress={() => setLogReviewOnly(false)} />
              <Button testID="device-log-filter-review" variant={logReviewOnly ? "secondary" : "ghost"} label="Review only" onPress={() => setLogReviewOnly(true)} />
            </View>
            {(() => { const shown = (logReviewOnly ? changeLog.filter((c) => c.attributedTo !== "apollo") : changeLog).slice(0, 8); return shown.length ? shown.map((change, i) => (
              <Pressable key={`${change.eventType}-${change.occurredAt}-${i}`} testID={`device-change-${i}`} accessibilityRole="button" accessibilityHint="Opens the matching settings screen to confirm this change" onPress={() => openChange(change)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs, opacity: pressed ? 0.7 : 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.why, { fontFamily: fonts.textSemibold }]}>{DEVICE_CHANGE_LABEL[change.eventType]}{change.appName ? `: ${change.appName}` : ""}</Text>
                  <Text style={s.mono}>{new Date(change.occurredAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
                </View>
                <Pill tone={change.attributedTo === "apollo" ? "resting" : "growling"} label={change.attributedTo === "apollo" ? "Apollo" : "Review"} testID={`device-change-${i}-tag`} />
              </Pressable>
            )) : <Body testID="device-log-empty">No changes need review.</Body>; })()}
          </Card>
        ) : null}

        <Card testID="device-protection-health" style={{ gap: spacing.sm, borderColor: result.protectionHealth.status === "active" ? colors.resting : result.protectionHealth.status === "unavailable" ? colors.border : colors.growling }}>
          <View style={s.row}><SectionTitle>Apollo protection health</SectionTitle><Pill testID="device-protection-health-status" tone={result.protectionHealth.status === "active" ? "resting" : result.protectionHealth.status === "unavailable" ? "unknown" : "growling"} label={result.protectionHealth.status === "active" ? "Active" : result.protectionHealth.status === "off" ? "Off" : result.protectionHealth.status === "needs_attention" ? "Needs attention" : "Unavailable"} /></View>
          <Text style={s.label} testID="device-protection-health-title">{result.protectionHealth.title}</Text>
          <Body testID="device-protection-health-detail">{result.protectionHealth.detail}</Body>
        </Card>

        {result.recoverySteps.length ? (
          <Card style={{ gap: spacing.sm, borderColor: colors.barking }} testID="device-recovery">
            <SectionTitle>Stay with me — do these in order</SectionTitle>
            {result.recoverySteps.map((st, i) => <View key={i} style={s.step}><Text style={s.num}>{i + 1}</Text><Text style={[s.why, { flex: 1 }]} testID={`device-recovery-step-${i}`}>{st}</Text></View>)}
            <Body>Apollo can&apos;t tell whether anything was taken — only that the access was risky. Don&apos;t assume the worst, but do the steps.</Body>
          </Card>
        ) : null}

        {reviewGroups.length ? (
          <View style={{ gap: spacing.md }} testID="device-review">
            <SectionTitle>Security & privacy review</SectionTitle>
            <Body>Every setting Apollo checks on this {review!.osLabel}, with a clear result for each. Tap “Open Settings” and Higgins takes you to the exact place to make a change.</Body>
            {reviewGroups.map((group) => (
              <View key={group.category} style={{ gap: spacing.sm }} testID={`device-review-cat-${group.category}`}>
                <Text style={s.catLabel}>{group.label}</Text>
                {group.results.map((r) => {
                  const tone = OUTCOME_TONE[r.outcome];
                  return (
                    <Card key={r.id} style={{ gap: spacing.xs, borderColor: toneColor(colors, tone) }} testID={`device-check-${r.id}`}>
                      <View style={s.row}><Text style={[s.label, { flex: 1 }]}>{r.title}</Text><Pill tone={tone} label={OUTCOME_LABEL[r.outcome]} testID={`device-check-${r.id}-outcome`} /></View>
                      {r.risk ? <Text style={s.why}>{r.risk}</Text> : null}
                      {r.remediation ? <><Text style={s.label}>What to do</Text><Text style={s.why}>{r.remediation}</Text></> : null}
                      <Text style={s.mono}>{r.evidence}{r.verifiedBy === "user_confirmed" ? " · You confirmed this." : r.verifiedBy === "observation" ? " · Verified by Apollo." : ""}</Text>
                      {r.settings && r.outcome !== "checked" ? (
                        <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", alignItems: "center" }}>
                          <Button testID={`device-check-${r.id}-open`} variant={r.outcome === "action" ? "danger" : "secondary"} label={platform === "web" ? "Show Settings steps" : "Open Settings"} onPress={() => openCheck(r)} />
                          <Text style={s.mono}>{r.settings}</Text>
                        </View>
                      ) : null}
                    </Card>
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}

        <Card testID="device-higgins" style={{ gap: spacing.sm, borderColor: colors.navyBorder }}>
          <SectionTitle>Higgins</SectionTitle>
          <Body testID="device-higgins-explanation">{firstAction ? `${firstAction.title} is the first item to review. ${firstAction.action}` : "Apollo did not identify a meaningful concern within the signals this platform exposes. The visibility limits below still apply."}</Body>
          {firstAction ? <Button testID="device-higgins-open-settings" label={platform === "web" ? "Show relevant Settings steps" : "Open relevant Settings"} onPress={() => open(firstAction)} /> : null}
          <Button testID="device-higgins-recheck" variant="secondary" icon={<RefreshCw size={17} color={colors.brand} />} label={checking ? "Checking again…" : "I changed it — check again"} onPress={() => void refreshDevice(true)} disabled={checking} />
          <Body testID="device-higgins-tampering-rule">Apollo reports suspected tampering only when a specific high-confidence configuration or permission change was observed. A stopped service or missing permission alone is a protection gap, not proof of tampering.</Body>
        </Card>

        <Card style={{ gap: spacing.sm }} testID="device-self-report">
          <SectionTitle>Tell Higgins what you&apos;ve noticed</SectionTitle>
          <Body>{platform === "ios" ? "You and Higgins review iPhone profiles and app access together, alongside Apollo's automatic checks." : signals.thirdPartyAccessibilityServices === null ? "Tell Higgins what you've noticed and he'll check it with you, alongside Apollo's automatic checks." : "Higgins keeps your report distinct from the results Apollo observed automatically."}</Body>
          {SELF_REPORT.filter((o) => !(platform === "ios" && o.id === "unknownSourcesOn")).map((o) => (
            <View key={o.id} style={s.row}><Text style={[s.why, { flex: 1 }]}>{o.label}</Text><Switch testID={`device-self-${o.id}`} value={!!self[o.id]} onValueChange={(v) => setSelf((c) => ({ ...c, [o.id]: v }))} trackColor={{ true: o.id === "managementExpected" ? colors.resting : colors.growling, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
          ))}
          <Button testID="device-submit-self-report" variant="secondary" label="Add my report to Higgins" disabled={!anySelf}
            onPress={() => setSubmission({ submissionId: Crypto.randomUUID(), result, observedAt: new Date().toISOString(), source: "user_report" })} />
        </Card>

        <Card style={{ gap: spacing.xs }} testID="device-cannot-see">
          <SectionTitle>Where Higgins can help</SectionTitle>
          {result.cannotSee.length ? result.cannotSee.map((c, i) => <Body key={i} testID={`device-cannot-${i}`}>• {c}</Body>) : <Body>Everything above was read straight from your device.</Body>}
          <Body>For anything your device keeps private from apps, Higgins walks you through it so nothing is left unchecked.</Body>
        </Card>

        <Card style={{ gap: spacing.sm }} testID="device-actions">
          {result.status !== "protected" && !event ? <Button testID="device-save" label={saving ? "Saving…" : "Save to Patrol & stay with me"} onPress={() => void save()} disabled={saving} /> : null}
          {event ? <RecoveryFlow event={event} kinds={["remote", "banking_during_access", "accessibility", "profile", "password", "code"]} testID="device-recovery-flow" /> : null}
          <Button testID="device-check-app" variant="secondary" label="Check a specific app" onPress={() => router.push("/app-check")} />
          {submission ? <GateInvestigation submission={submission} continuityKey="device" eventId={event?.event_id} testID="device-ask" label="Ask Higgins about my device" context={issueContext({ gate: "device", issue_summary: DEVICE_STATUS[submission.result.status].title, assessment_state: submission.result.state, findings: submission.result.findings.slice(0, 6).map((finding) => ({ summary: `${finding.title}: ${finding.plain}`, provenance: submission.source === "user_report" ? "user_reported" : "observed", status: finding.severity === "high" ? "warning" : "uncertain" })), uncertainty: submission.result.cannotSee, confirmed_protective_actions: [], user_reported_actions: Object.keys(self).filter((key) => self[key as keyof SelfReport]), event_id: event?.event_id, original_evidence: [{ kind: "text", value: `Observation timestamp: ${submission.observedAt}\nObservation source: ${submission.source}\nDevice assessment (visible settings and Apollo health only):\n${submission.result.summary}\n${submission.result.findings.map((f) => `${f.severity.toUpperCase()} ${f.title}: ${f.plain}`).join("\n")}\nApollo cannot see: ${submission.result.cannotSee.join("; ") || "nothing additional listed"}`, label: submission.source === "user_report" ? "fresh device observations and explicit user report" : "fresh device observations" }], available_actions: [
            ...(submissionFirstAction ? [{ label: platform === "web" ? "Show relevant Settings steps" : "Open relevant Settings", instruction: `${submissionFirstAction.action} ${submissionFirstAction.settings}` }] : []),
            { label: "I changed it — check again", instruction: "Return to Device Gate and choose I changed it — check again so Apollo refreshes the signals this platform exposes." },
          ] })} question={anySelf ? "What should I do first?" : "How do I keep my phone secure?"} /> : null}
        </Card>
        <CheckHistoryCard gate="device" refreshKey={historyKey} testID="device-history" />
      </ScrollView>
    </View>
  );
}
