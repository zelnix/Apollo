import { useRouter } from "expo-router";
import BatteryCharging from "lucide-react-native/icons/battery-charging";
import FileSearch from "lucide-react-native/icons/file-search";
import KeyRound from "lucide-react-native/icons/key-round";
import Link2 from "lucide-react-native/icons/link-2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquareWarning from "lucide-react-native/icons/message-square-warning";
import PhoneIncoming from "lucide-react-native/icons/phone-incoming";
import ScanLine from "lucide-react-native/icons/scan-line";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import Wifi from "lucide-react-native/icons/wifi";
import React from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApolloHero } from "@/src/components/ApolloHero";
import { ApolloLogo } from "@/src/components/ApolloLogo";
import { HigginsFollowUp } from "@/src/components/HigginsFollowUp";
import { HigginsGreeting } from "@/src/components/HigginsGreeting";
import { ClipboardLinkBanner } from "@/src/components/ClipboardLinkBanner";
import { PatrolItem } from "@/src/components/PatrolItem";
import { ServiceBanner } from "@/src/components/ServiceBanner";
import { Body, Button, Card, Pill, ScreenHeader, SectionTitle, capabilityTone, toneColor } from "@/src/components/ui";
import { buildScents } from "@/src/domain/threatScent";
import { STATE_NAME } from "@/src/domain/types";
import { CAPABILITY_STATUS_LABEL, visibilityFrom } from "@/src/domain/capability";
import { buildWeeklyDigest } from "@/src/domain/digest";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";
import { minimiseApp } from "@/src/utils/minimise";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  actions: { flexDirection: "row", gap: spacing.md },
  capRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.md },
  capTitle: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface, flex: 1 },
  empty: { alignItems: "flex-start", gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
  link: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.restingText },
}));

export default function Home() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { resolution, capabilities, protection, adapterLabel, isMock, refreshing, verifyNow, events, lastVerifiedAt, lowPower, quietNow, showToast, identityReset, reRegisterDevice } = useApollo();
  const visibility = visibilityFrom(capabilities, !!(protection?.requested ?? protection?.running));
  const recent = events.slice(0, 4);
  const digest = buildWeeklyDigest(events);
  const scents = buildScents(events);

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <ScreenHeader title="Apollo" testID="home-header" right={<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>{isMock ? <Pill tone="unknown" label="Mock" testID="home-mock-pill" /> : null}<ApolloLogo size={40} testID="home-logo" /></View>} />
      </View>
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={verifyNow} tintColor={colors.resting} />} testID="home-scroll">
        <ApolloHero resolution={resolution} visibility={visibility} adapterLabel={adapterLabel} isMock={isMock} animate={!lowPower} quietNow={quietNow} sniffing={refreshing} />
        {identityReset ? (
          <Card style={{ gap: spacing.sm, borderColor: colors.barking }} testID="identity-reset-card">
            <Text style={s.capTitle}>Apollo needs to re-register this phone</Text>
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

        <View style={s.actions}>
          <Button testID="home-check-link-button" label="Check a link" onPress={() => router.push("/check")} icon={<Link2 size={18} color={colors.onBrandPrimary} />} style={{ flex: 1 }} />
          <Button testID="home-check-message-button" label="Check a message" variant="secondary" onPress={() => router.push("/message")} icon={<MessageSquareWarning size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button testID="home-check-call-button" label="Check this call" variant="secondary" onPress={() => router.push("/call")} icon={<PhoneIncoming size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
          <Button testID="home-scan-button" label="Scan a code" variant="secondary" onPress={() => router.push("/scan")} icon={<ScanLine size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button testID="home-check-file-button" label="Check a file" variant="secondary" onPress={() => router.push("/file")} icon={<FileSearch size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
          <Button testID="home-check-app-button" label="Check an app" variant="secondary" onPress={() => router.push("/app-check")} icon={<Smartphone size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button testID="home-check-device-button" label="Check my device" variant="secondary" onPress={() => router.push("/device")} icon={<ShieldCheck size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
          <Button testID="home-check-network-button" label="Network Guard" variant="secondary" onPress={() => router.push("/network")} icon={<Wifi size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button testID="home-check-account-button" label="Account Guard" variant="secondary" onPress={() => router.push("/account")} icon={<KeyRound size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
          <Button testID="home-check-email-button" label="Check an email" variant="secondary" onPress={() => router.push("/email")} icon={<Mail size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
        </View>
        <Button testID="home-verify-button" label="Verify now" variant="ghost" onPress={verifyNow} icon={<RefreshCw size={18} color={colors.onSurface} />} />
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
        {lastVerifiedAt ? <Body style={{ marginTop: -spacing.md }} >Last verified {new Date(lastVerifiedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Body> : null}

        <View>
          <SectionTitle>What Apollo can see</SectionTitle>
          <Card testID="home-capabilities">
            {capabilities.map((cap) => (
              <View key={cap.id} style={s.capRow} testID={`home-cap-${cap.id}`}>
                <Text style={s.capTitle}>{cap.title}</Text>
                <Pill tone={capabilityTone(cap.status)} label={CAPABILITY_STATUS_LABEL[cap.status]} />
              </View>
            ))}
            <Text style={s.link} onPress={() => router.push("/(tabs)/guard")} testID="home-open-guard">Manage in Guard</Text>
          </Card>
        </View>

        <View>
          <SectionTitle>This week</SectionTitle>
          <Pressable testID="home-digest-card" accessibilityRole="button" onPress={() => router.push("/digest")}>
            <Card style={{ gap: spacing.xs }}>
              <Text style={s.emptyTitle}>{digest.headline}</Text>
              <Body>{digest.summary}</Body>
              <Text style={s.link}>Open weekly patrol</Text>
            </Card>
          </Pressable>
        </View>

        <View>
          <SectionTitle>Recent patrol</SectionTitle>
          {recent.length === 0 ? (
            <Card style={s.empty} testID="home-patrol-empty">
              <Text style={s.emptyTitle}>No events yet</Text>
              <Body>Apollo is watching within its supported checks. Try checking a link to see how Apollo reacts.</Body>
            </Card>
          ) : (
            <View>
              {recent.map((e, i) => <PatrolItem key={e.event_id} event={e} isLast={i === recent.length - 1} />)}
              <Text style={s.link} onPress={() => router.push("/(tabs)/patrol")} testID="home-open-patrol">See full patrol</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
