import { useRouter } from "expo-router";
import BatteryCharging from "lucide-react-native/icons/battery-charging";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Clock from "lucide-react-native/icons/clock";
import FileSearch from "lucide-react-native/icons/file-search";
import KeyRound from "lucide-react-native/icons/key-round";
import Link2 from "lucide-react-native/icons/link-2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquareWarning from "lucide-react-native/icons/message-square-warning";
import PhoneIncoming from "lucide-react-native/icons/phone-incoming";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import ScanLine from "lucide-react-native/icons/scan-line";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import Sparkles from "lucide-react-native/icons/sparkles";
import Wifi from "lucide-react-native/icons/wifi";
import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApolloHero } from "@/src/components/ApolloHero";
import { HigginsFollowUp } from "@/src/components/HigginsFollowUp";
import { HigginsGreeting } from "@/src/components/HigginsGreeting";
import { ClipboardLinkBanner } from "@/src/components/ClipboardLinkBanner";
import { PatrolItem } from "@/src/components/PatrolItem";
import { ServiceBanner } from "@/src/components/ServiceBanner";
import { Body, Button, Card, DevTag, Pill, ScreenHeader, SectionTitle, toneColor } from "@/src/components/ui";
import { buildScents } from "@/src/domain/threatScent";
import { STATE_NAME } from "@/src/domain/types";
import { visibilityFrom } from "@/src/domain/capability";
import { buildWeeklyDigest } from "@/src/domain/digest";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { minimiseApp } from "@/src/utils/minimise";

/** Below this window width, Protection and Verification sit side by side instead of stacked. */
const WIDE_BREAKPOINT = 700;

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  empty: { alignItems: "flex-start", gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
  link: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.restingText },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardIconWell: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brand },
  cardLinkRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, minHeight: 32 },
  // Quick Checks is one understated white strip, not four separate cards — dividers between actions
  // instead of individual borders, gold icons (unboxed) for the primary four, a light gold wash on
  // press instead of a dark outline. Secondary ("All checks") rows reuse the same strip but keep the
  // icon in navy, so the four primary actions still read as the fastest path.
  checksPanel: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border },
  checksRow: { flexDirection: "row", alignItems: "stretch" },
  checksRowDivider: { height: 1, backgroundColor: c.divider, marginHorizontal: spacing.md },
  checkDivider: { width: 1, backgroundColor: c.divider, marginVertical: spacing.md },
  checkItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.md },
  checkItemPressed: { backgroundColor: c.goldTint },
  checkLabel: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurface },
  quickChecksHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  allChecksLink: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 32, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
  allChecksLinkText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brand },
}));

type QuickCheck = { testID: string; label: string; icon: React.ReactNode; route: string };

/** One row of the Quick Checks strip: N equal actions separated by thin vertical dividers, sharing a
 *  single panel surface — never individually boxed. */
function ChecksRow({ items, onPress }: { items: QuickCheck[]; onPress: (route: string) => void }) {
  const s = useStyles();
  return (
    <View style={s.checksRow}>
      {items.map((chk, i) => (
        <React.Fragment key={chk.testID}>
          {i > 0 ? <View style={s.checkDivider} /> : null}
          <Pressable
            testID={chk.testID}
            accessibilityRole="button"
            onPress={() => onPress(chk.route)}
            style={({ pressed }) => [s.checkItem, pressed && s.checkItemPressed]}
          >
            {chk.icon}
            <Text style={s.checkLabel} numberOfLines={1}>{chk.label}</Text>
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );
}

export default function Home() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const [allChecksOpen, setAllChecksOpen] = useState(false);
  const { resolution, capabilities, protection, adapterLabel, isMock, refreshing, verifyNow, events, lastVerifiedAt, lowPower, quietNow, showToast, identityReset, reRegisterDevice } = useApollo();
  const visibility = visibilityFrom(capabilities, !!(protection?.requested ?? protection?.running));
  // Recent Patrol on Home is a glance, not the archive — at most 2-3 items; the full history lives on Patrol.
  const recent = events.slice(0, 3);
  const digest = buildWeeklyDigest(events);
  const scents = buildScents(events);
  const activeCount = capabilities.filter((c) => c.status === "active").length;
  const attentionCount = capabilities.filter((c) => c.status === "permission_required").length;

  const primaryChecks: QuickCheck[] = [
    { testID: "home-check-link-button", label: "Link", icon: <Link2 size={20} color={colors.gold} />, route: "/check" },
    { testID: "home-check-message-button", label: "Message", icon: <MessageSquareWarning size={20} color={colors.gold} />, route: "/message" },
    { testID: "home-check-call-button", label: "Call", icon: <PhoneIncoming size={20} color={colors.gold} />, route: "/call" },
    { testID: "home-scan-button", label: "Scan code", icon: <ScanLine size={20} color={colors.gold} />, route: "/scan" },
  ];
  const moreChecks: QuickCheck[] = [
    { testID: "home-check-file-button", label: "Check a file", icon: <FileSearch size={20} color={colors.brand} />, route: "/file" },
    { testID: "home-check-app-button", label: "Check an app", icon: <Smartphone size={20} color={colors.brand} />, route: "/app-check" },
    { testID: "home-check-device-button", label: "Check my device", icon: <ShieldCheck size={20} color={colors.brand} />, route: "/device" },
    { testID: "home-check-network-button", label: "Network Guard", icon: <Wifi size={20} color={colors.brand} />, route: "/network" },
    { testID: "home-check-account-button", label: "Account Guard", icon: <KeyRound size={20} color={colors.brand} />, route: "/account" },
    { testID: "home-check-email-button", label: "Check an email", icon: <Mail size={20} color={colors.brand} />, route: "/email" },
  ];

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <ScreenHeader title="Apollo" testID="home-header" right={isMock ? <DevTag label="Mock" testID="home-mock-pill" /> : null} />
      </View>
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={verifyNow} tintColor={colors.resting} />} testID="home-scroll">
        <ApolloHero resolution={resolution} visibility={visibility} adapterLabel={adapterLabel} isMock={isMock} capabilities={capabilities} animate={!lowPower} quietNow={quietNow} sniffing={refreshing} />
        {identityReset ? (
          <Card style={{ gap: spacing.sm, borderColor: colors.barking }} testID="identity-reset-card">
            <Text style={s.cardTitle}>Apollo needs to re-register this phone</Text>
            <Body testID="identity-reset-why">{identityReset}</Body>
            <Body>Your on-phone Patrol history is untouched. Family pairings and shared incidents were tied to the old identity — after re-registering, pair with family again. Nothing is sent to Apollo&apos;s servers until you do.</Body>
            <Button testID="identity-reset-register" label="Register this phone again" onPress={() => void reRegisterDevice().catch((e: Error) => showToast(e.message, "barking"))} />
          </Card>
        ) : null}
        <ServiceBanner />
        <HigginsGreeting state={resolution.visibilityLost ? "lost" : resolution.state} />
        <HigginsFollowUp />
        <ClipboardLinkBanner />
        {protection?.operational ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }} testID="home-background-card">
            <BatteryCharging size={20} color={colors.resting} />
            <View style={{ flex: 1 }}><Body>Guarding in the background — minimise to save battery.</Body></View>
            <Button testID="home-minimise" variant="ghost" label="Minimise" onPress={() => void minimiseApp(showToast)} />
          </Card>
        ) : null}

        <View style={{ gap: spacing.md }}>
          <View style={s.quickChecksHeaderRow}>
            <SectionTitle>Quick checks</SectionTitle>
            <Pressable testID="home-all-checks-toggle" accessibilityRole="button" onPress={() => setAllChecksOpen((v) => !v)} style={s.allChecksLink}>
              <Text style={s.allChecksLinkText}>{allChecksOpen ? "Fewer checks" : "All checks"}</Text>
              {allChecksOpen ? <ChevronUp size={14} color={colors.brand} /> : <ChevronRight size={14} color={colors.brand} />}
            </Pressable>
          </View>
          <View style={s.checksPanel}>
            <ChecksRow items={primaryChecks} onPress={(route) => router.push(route as never)} />
            {allChecksOpen ? (
              <View testID="home-all-checks">
                <View style={s.checksRowDivider} />
                <ChecksRow items={moreChecks.slice(0, 3)} onPress={(route) => router.push(route as never)} />
                <View style={s.checksRowDivider} />
                <ChecksRow items={moreChecks.slice(3)} onPress={(route) => router.push(route as never)} />
              </View>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: isWide ? "row" : "column", gap: spacing.md }}>
          <Card style={[{ gap: 4 }, isWide ? { flex: 1 } : undefined]} testID="home-protection-summary">
            <View style={s.cardTitleRow}>
              <View style={s.cardIconWell}><ShieldCheck size={16} color={colors.brand} /></View>
              <Text style={s.cardTitle}>Protection</Text>
            </View>
            <Body>{activeCount} active{attentionCount ? ` · ${attentionCount} need${attentionCount > 1 ? "" : "s"} attention` : ""}</Body>
            <Pressable testID="home-open-guard" accessibilityRole="button" onPress={() => router.push("/(tabs)/guard")} style={s.cardLinkRow}>
              <Text style={s.link}>Manage in Guard</Text>
              <ChevronRight size={14} color={colors.restingText} />
            </Pressable>
          </Card>
          <Card style={[{ gap: 4 }, isWide ? { flex: 1 } : undefined]} testID="home-verification-card">
            <View style={s.cardTitleRow}>
              <View style={s.cardIconWell}><Clock size={16} color={colors.brand} /></View>
              <Text style={s.cardTitle}>Verification</Text>
            </View>
            <Body>{lastVerifiedAt ? `Last verified ${new Date(lastVerifiedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not yet verified"}</Body>
            <Button testID="home-verify-button" label="Verify now" variant="secondary" onPress={verifyNow} icon={<RefreshCw size={16} color={colors.brand} />} style={{ marginTop: spacing.xs }} />
          </Card>
        </View>

        {scents.length ? (
          <View>
            <SectionTitle>Connected events (Threat Scent)</SectionTitle>
            {scents.slice(0, 2).map((sc) => (
              <Pressable key={sc.scent_id} testID={`home-scent-${sc.scent_id}`} accessibilityRole="button" onPress={() => router.push({ pathname: "/patrol/scent/[id]", params: { id: sc.scent_id } })}>
                <Card style={{ gap: spacing.xs, borderColor: toneColor(colors, sc.state) }}>
                  <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}><Pill tone={sc.state} label={STATE_NAME[sc.state]} />{sc.brand ? <Pill tone="neutral" label={sc.brand} /> : null}<Pill tone="neutral" label={`${sc.events.length} events`} /></View>
                  <Body>{sc.summary}</Body>
                  <Body>Tap to see the timeline and one Stay With Me plan for the whole incident.</Body>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View>
          <SectionTitle>Recent patrol</SectionTitle>
          {recent.length === 0 ? (
            <Card style={s.empty} testID="home-patrol-empty">
              <Text style={s.emptyTitle}>All quiet</Text>
              <Body>Apollo is patrolling within the checks he can see.</Body>
            </Card>
          ) : (
            <View>
              {recent.map((e, i) => <PatrolItem key={e.event_id} event={e} isLast={i === recent.length - 1} />)}
              <Text style={s.link} onPress={() => router.push("/(tabs)/patrol")} testID="home-open-patrol">See all</Text>
            </View>
          )}
        </View>

        <View>
          <SectionTitle>This week</SectionTitle>
          <Pressable testID="home-digest-card" accessibilityRole="button" onPress={() => router.push("/digest")}>
            <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={s.cardIconWell}><Sparkles size={16} color={colors.brand} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{digest.headline}</Text>
                <Body numberOfLines={2}>{digest.summary}</Body>
              </View>
              <ChevronRight size={18} color={colors.onSurfaceSecondary} />
            </Card>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
