// Scam Alert detail — four tabs: Overview | What to look for | How to stay safe | Source.
// Every section is taken from the official-source alert; empty sections are hidden, never filled in.
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import Banknote from "lucide-react-native/icons/banknote";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import ExternalLink from "lucide-react-native/icons/external-link";
import MessageSquareQuote from "lucide-react-native/icons/message-square-quote";
import Share2 from "lucide-react-native/icons/share-2";
import Target from "lucide-react-native/icons/target";
import Users from "lucide-react-native/icons/users";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, toneColor, toneTint } from "@/src/components/ui";
import type { GovernmentAlert } from "@/src/higgins/hubClient";
import { alertIcon, findAlert, RELEVANCE_LABEL, SEVERITY_TONE, severityLabel, shareScamAlert, shareScamAlertWithFamily, toBullets } from "@/src/higgins/scamAlertUi";
import { useApollo } from "@/src/store/ApolloContext";
import Users2 from "lucide-react-native/icons/users-round";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

type TabId = "overview" | "signs" | "safe" | "source";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "signs", label: "What to look for" },
  { id: "safe", label: "How to stay safe" }, { id: "source", label: "Source" },
];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: spacing.xl, gap: spacing.md },
  hero: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  heroIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  title: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  tabs: { flexDirection: "row", gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: c.border },
  tab: { flex: 1, paddingVertical: spacing.sm, minHeight: 48, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: c.brand },
  tabText: { fontFamily: fonts.textSemibold, fontSize: 13, lineHeight: 17, textAlign: "center", color: c.onSurfaceSecondary },
  tabTextOn: { color: c.brand },
  section: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  sectionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  sectionBody: { flex: 1, gap: 4 },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  bullet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  quote: { borderLeftWidth: 3, borderLeftColor: c.brand, paddingLeft: spacing.md, gap: 6 },
  quoteText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface, fontStyle: "italic" },
  kv: { gap: 2, paddingVertical: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: c.border },
  kvLabel: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.4 },
  kvValue: { fontFamily: fonts.text, fontSize: 15, lineHeight: 21, color: c.onSurface },
  link: { fontFamily: fonts.text, fontSize: 14, color: c.brand },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
}));

type Icon = React.ComponentType<{ size?: number; color?: string }>;
function Section({ icon: I, title, text }: { icon: Icon; title: string; text: string }) {
  const s = useStyles(); const { colors } = useTheme();
  return <View style={s.section}><View style={s.sectionIcon}><I size={18} color={colors.onSurface} /></View><View style={s.sectionBody}><Text style={s.sectionTitle}>{title}</Text><Body>{text}</Body></View></View>;
}
function Bullets({ items, color, testID }: { items: string[]; color: string; testID: string }) {
  const s = useStyles();
  return <View style={{ gap: spacing.sm }} testID={testID}>{items.map((t, i) => <View key={i} style={s.bullet}><View style={[s.dot, { backgroundColor: color }]} /><View style={{ flex: 1 }}><Body>{t}</Body></View></View>)}</View>;
}
function KV({ label, value, onPress }: { label: string; value: string | null | undefined; onPress?: () => void }) {
  const s = useStyles();
  if (!value) return null;
  return <View style={s.kv}><Text style={s.kvLabel}>{label}</Text><Text style={onPress ? s.link : s.kvValue} onPress={onPress}>{value}</Text></View>;
}
const Missing = ({ text }: { text: string }) => <Card><Body>{text}</Body></Card>;
const fmt = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

function OverviewTab({ a }: { a: GovernmentAlert }) {
  const intro = a.higgins.whatHappened || a.summary;
  const why = a.higgins.whyGrowling || a.higgins.whatItMeansForAustralia || a.severityReason;
  const parts: [Icon, string, string][] = ([[CircleAlert, "Why this matters", why], [Users, "Who it targets", a.facts.who], [Target, "How it works", a.facts.how], [Banknote, "What they want", a.facts.whatCriminalsWant]] as [Icon, string, string][]).filter(([, , t]) => !!t?.trim());
  if (!intro && parts.length === 0) return <Missing text="The official source has not published these details yet." />;
  return <View style={{ gap: spacing.lg }} testID="scam-tab-overview">{intro ? <Body>{intro}</Body> : null}{parts.map(([I, t, x]) => <Section key={t} icon={I} title={t} text={x} />)}</View>;
}
function SignsTab({ a }: { a: GovernmentAlert }) {
  const s = useStyles(); const { colors } = useTheme();
  const signs = toBullets(a.higgins.whatToWatch);
  if (signs.length === 0 && !a.facts.evidence) return <Missing text="The official source did not list specific warning signs for this scam." />;
  return (
    <View style={{ gap: spacing.lg }} testID="scam-tab-signs">
      {signs.length ? <View style={{ gap: spacing.sm }}><Text style={s.sectionTitle}>Signs it may be a scam</Text><Bullets items={signs} color={colors.barking} testID="scam-signs" /></View> : null}
      {a.facts.evidence ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={s.sectionTitle}>From the official report</Text>
          <Card style={s.quote}><MessageSquareQuote size={18} color={colors.brand} /><Text style={s.quoteText}>{a.facts.evidence}</Text></Card>
        </View>
      ) : null}
    </View>
  );
}
function SafeTab({ a }: { a: GovernmentAlert }) {
  const s = useStyles(); const { colors } = useTheme();
  const steps = toBullets(a.higgins.whatToDo);
  if (steps.length === 0) return <Missing text="The official source did not publish specific safety steps. Open the official alert for its full guidance." />;
  return (
    <View style={{ gap: spacing.md }} testID="scam-tab-safe">
      <Text style={s.sectionTitle}>What to do</Text>
      {steps.map((t, i) => <View key={i} style={s.bullet}><CircleCheck size={18} color={colors.resting} /><View style={{ flex: 1 }}><Body>{t}</Body></View></View>)}
    </View>
  );
}
function SourceTab({ a }: { a: GovernmentAlert }) {
  return (
    <View testID="scam-tab-source">
      <KV label="Published by" value={a.source} />
      <KV label="Reported" value={a.dateLabel} />
      <KV label="Last updated" value={fmt(a.updatedAt)} />
      <KV label="Last checked by Apollo" value={fmt(a.lastCheckedAt)} />
      <KV label="Region" value={[a.regionLabel, a.higgins.whereHappening].filter(Boolean).join(" — ")} />
      <KV label="Australian relevance" value={[RELEVANCE_LABEL[a.australianRelevance], a.australianRelevanceReason].filter(Boolean).join(" — ")} />
      <KV label="Severity" value={[severityLabel(a.severity), a.severityReason].filter(Boolean).join(" — ")} />
      <KV label="Official alert" value={a.url} onPress={() => void Linking.openURL(a.url)} />
      {a.sourceUrl && a.sourceUrl !== a.url ? <KV label="Source website" value={a.sourceUrl} onPress={() => void Linking.openURL(a.sourceUrl)} /> : null}
    </View>
  );
}

export default function ScamAlertDetailScreen() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [alert, setAlert] = useState<GovernmentAlert | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [tab, setTab] = useState<TabId>("overview");
  const { deviceId, showToast } = useApollo();
  const [sending, setSending] = useState(false);
  const [noFamily, setNoFamily] = useState(false);
  const sendToFamily = async () => {
    if (!alert || !deviceId || sending) return;
    setSending(true); setNoFamily(false);
    try {
      const r = await shareScamAlertWithFamily(deviceId, alert.url);
      if (r.shared_with === 0) setNoFamily(true);
      else showToast(`Sent to ${r.shared_with} family member${r.shared_with === 1 ? "" : "s"} in Apollo.`, "resting");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Apollo couldn't send this alert right now.", "neutral");
    } finally { setSending(false); }
  };
  useEffect(() => {
    if (!id) { setState("missing"); return; }
    void findAlert(String(id)).then((a) => { setAlert(a); setState(a ? "ready" : "missing"); }).catch(() => setState("missing"));
  }, [id]);

  const header = (
    <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="scam-detail-back" accessibilityRole="button" accessibilityLabel="Back to Scam Alerts" onPress={() => goBackOrHome(router)} style={s.iconBtn}><ChevronLeft size={24} color={colors.onSurface} /></Pressable>
      <Text style={s.headerTitle}>Scam Alert</Text>
      {alert ? <Pressable testID="scam-detail-share" accessibilityRole="button" accessibilityLabel="Share this scam alert" onPress={() => void shareScamAlert(alert)} style={s.iconBtn}><Share2 size={22} color={colors.onSurface} /></Pressable> : <View style={s.iconBtn} />}
    </View>
  );
  if (state !== "ready" || !alert) {
    return <View style={s.root} testID="scam-detail-screen">{header}<View style={s.center}>{state === "loading" ? <ActivityIndicator color={colors.brand} /> : <Body>This alert is no longer listed by the official sources Apollo checks.</Body>}</View></View>;
  }
  const tone = SEVERITY_TONE[alert.severity]; const Icon = alertIcon(alert);
  return (
    <View style={s.root} testID="scam-detail-screen">
      {header}
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={s.hero}>
          <View style={[s.heroIcon, { backgroundColor: toneTint(colors, tone) }]}><Icon size={26} color={toneColor(colors, tone)} /></View>
          <View style={{ flex: 1, gap: 6 }}>
            <View style={s.pills}><Pill tone={tone} label={severityLabel(alert.severity)} testID="scam-detail-severity" /><Pill tone="neutral" label={alert.regionLabel} /></View>
            <Text style={s.title} testID="scam-detail-title">{alert.title}</Text>
            <Text style={s.meta}>{`${alert.source} · ${alert.dateLabel}`}</Text>
          </View>
        </View>
        <View style={s.tabs} accessibilityRole="tablist">
          {TABS.map((t) => {
            const on = tab === t.id;
            return <Pressable key={t.id} testID={`scam-detail-tab-${t.id}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(t.id)} style={[s.tab, on && s.tabOn]}><Text style={[s.tabText, on && s.tabTextOn]} numberOfLines={2}>{t.label}</Text></Pressable>;
          })}
        </View>
        {tab === "overview" ? <OverviewTab a={alert} /> : tab === "signs" ? <SignsTab a={alert} /> : tab === "safe" ? <SafeTab a={alert} /> : <SourceTab a={alert} />}
        <Button testID="scam-detail-official" label="Read the official alert" icon={<ExternalLink size={18} color={colors.onBrandPrimary} />} onPress={() => void Linking.openURL(alert.url)} style={{ marginTop: spacing.md }} />
        <Button testID="scam-detail-family" variant="secondary" label={sending ? "Sending…" : "Send to my family"} disabled={sending || !deviceId} icon={<Users2 size={18} color={colors.onSurface} />} accessibilityHint="Sends this alert to family linked in Apollo" onPress={() => void sendToFamily()} />
        {noFamily ? (
          <Card testID="scam-detail-no-family" style={{ gap: spacing.sm }}>
            <Body>No family members are linked in Apollo yet. Link a family device to send alerts to them in one tap.</Body>
            <Button testID="scam-detail-link-family" variant="secondary" label="Link family" onPress={() => router.push("/family")} />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
