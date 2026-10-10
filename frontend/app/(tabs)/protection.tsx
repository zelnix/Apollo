// Protection tab — the 5 user-facing protection areas, each showing individual capability coverage.
// This replaces the old Gates tab as the primary protection overview. Gate names appear as secondary
// detail inside expandable "How Apollo protects you" sections.
//
// The areas are presentation groups. An area is never labelled "Watching" merely because one of its
// constituent capabilities is active. Automatic protection, manual checks, optional setup,
// unsupported capabilities and genuine failures are each clearly distinguished.

import { useRouter } from "expo-router";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Globe from "lucide-react-native/icons/globe";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Shield from "lucide-react-native/icons/shield";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { Card, Pill } from "@/src/components/ui";
import { buildProtectionAreas, type ProtectionArea, type ProtectionAreaCapability, type ProtectionAreaId } from "@/src/domain/protectionAreas";
import { gateTone } from "@/src/domain/gates";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const AREA_ICONS: Record<ProtectionAreaId, React.ComponentType<{ size?: number; color?: string }>> = {
  websites_links: Globe,
  messages_calls: MessageSquare,
  email_accounts: Mail,
  apps_files: Smartphone,
  device_internet: ShieldCheck,
};

/** Route to open when the user taps "View details" on a capability line. */
const CAPABILITY_ROUTE: Record<string, string> = {
  site: "/(tabs)/guard?gate=site",
  link: "/check",
  text: "/text-guard",
  call: "/call-guard",
  email: "/email",
  account: "/account-monitor",
  file: "/file",
  app: "/app-check",
  device: "/device",
  network: "/network",
};

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing["3xl"] },
  summaryCard: { gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  summaryText: { flex: 1, gap: 2 },
  summaryTitle: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 24, color: c.onSurface },
  summaryBody: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  areaCard: { gap: 0, overflow: "hidden" },
  areaHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  areaIconWell: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  areaInfo: { flex: 1, gap: 2 },
  areaTitle: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 21, color: c.onSurface },
  areaDesc: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  capSection: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  capRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingVertical: spacing.xs },
  capLabel: { flex: 1, gap: 1 },
  capTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  capMode: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  capHelp: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary, paddingLeft: spacing.xs },
  expandRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider },
  expandText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brand },
  gateDetail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: c.divider },
  gateBox: { gap: 4 },
  gateName: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  gateMode: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  gateDesc: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary },
  limitation: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.growlingText },
}));

function CapabilityLine({ cap }: { cap: ProtectionAreaCapability }) {
  const s = useStyles();
  const router = useRouter();
  const route = CAPABILITY_ROUTE[cap.gateId];
  const tone = gateTone(cap.tone);
  const modeLabel = cap.mode === "automatic" ? "Automatic" : "Manual";

  const content = (
    <View style={s.capRow}>
      <View style={s.capLabel}>
        <Text style={s.capTitle}>{cap.label}</Text>
        <Text style={s.capMode}>{modeLabel} · {cap.statusLabel}</Text>
      </View>
      <Pill tone={tone} label={cap.statusLabel} />
    </View>
  );

  if (route) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${cap.label}: ${cap.statusLabel}`}
        testID={`protection-cap-${cap.gateId}`}
        onPress={() => router.push(route as never)}
        style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View testID={`protection-cap-${cap.gateId}`}>{content}</View>;
}

function AreaCard({ area }: { area: ProtectionArea }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const Icon = AREA_ICONS[area.id];
  const borderColor = area.attentionCount > 0 ? colors.barking : area.summaryTone === "good" ? colors.resting : colors.border;

  return (
    <Card style={[s.areaCard, { borderColor }]} testID={`protection-area-${area.id}`}>
      {/* Area header */}
      <View style={s.areaHeader}>
        <View style={[s.areaIconWell, { backgroundColor: area.summaryTone === "good" ? colors.restingTint : area.attentionCount > 0 ? colors.barkingTint : colors.navyTint }]}>
          <Icon size={22} color={area.attentionCount > 0 ? colors.barking : area.summaryTone === "good" ? colors.resting : colors.brand} />
        </View>
        <View style={s.areaInfo}>
          <Text style={s.areaTitle}>{area.title}</Text>
          <Text style={s.areaDesc}>{area.description}</Text>
        </View>
        <Pill tone={gateTone(area.summaryTone)} label={area.summaryStatus} />
      </View>

      {/* Individual capability lines */}
      <View style={s.capSection}>
        {area.capabilities.map((cap) => (
          <CapabilityLine key={cap.gateId} cap={cap} />
        ))}
      </View>

      {/* Expandable "How Apollo protects you" */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Hide protection details" : "How Apollo protects you"}
        testID={`protection-area-${area.id}-expand`}
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => [s.expandRow, { opacity: pressed ? 0.78 : 1 }]}
      >
        <Text style={s.expandText}>How Apollo protects you</Text>
        {expanded ? <ChevronUp size={16} color={colors.brand} /> : <ChevronDown size={16} color={colors.brand} />}
      </Pressable>

      {expanded ? (
        <View style={s.gateDetail} testID={`protection-area-${area.id}-detail`}>
          {area.capabilities.map((cap) => (
            <View key={cap.gateId} style={s.gateBox}>
              <Text style={s.gateName}>{cap.gateName} — {cap.label}</Text>
              <Text style={s.gateMode}>{cap.mode === "automatic" ? "Automatic protection" : "Manual check"}</Text>
              <Text style={s.gateDesc}>{cap.currentHelp}</Text>
              {cap.limitation ? <Text style={s.limitation}>{cap.limitation}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export default function ProtectionScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const health = useProtectionHealth();

  const areas = useMemo(
    () => (health.checking ? [] : buildProtectionAreas(health.gates)),
    [health.checking, health.gates],
  );

  const totalWatching = areas.reduce((sum, a) => sum + a.watchingCount, 0);
  const totalAutomatic = areas.reduce((sum, a) => sum + a.automaticCount, 0);
  const areasWithAttention = areas.filter((a) => a.attentionCount > 0).length;

  const summaryTitle = areasWithAttention > 0
    ? `${areasWithAttention} ${areasWithAttention === 1 ? "area needs" : "areas need"} attention`
    : totalWatching > 0
      ? `${totalWatching} of ${totalAutomatic} automatic protections watching`
      : health.checking
        ? "Checking your protection"
        : "Your protection overview";

  const summaryBody = areasWithAttention > 0
    ? "Some protections need your action. Review the areas below."
    : totalWatching === totalAutomatic && totalAutomatic > 0
      ? "All automatic protections are running. Manual checks are available."
      : health.checking
        ? "Apollo is checking the current state of your device protection."
        : "Review each area to see what's active and what's available.";

  return (
    <View style={s.root} testID="protection-screen">
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <RootScreenHeader
          title="Protection"
          testID="protection-header"
          info={{
            title: "About Protection",
            body: [
              "This screen shows how Apollo protects your phone across five areas.",
              "Each area groups related protections. Automatic protections run in the background; manual checks are tools you can use anytime.",
              "Tap an area to see individual capabilities, or expand 'How Apollo protects you' for details.",
            ],
          }}
        />
      </View>
      <ScrollView
        testID="protection-scroll"
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 110 }]}
      >
        {/* Summary card */}
        <Card style={s.summaryCard} testID="protection-summary">
          <View style={s.summaryRow}>
            <Shield size={28} color={areasWithAttention > 0 ? colors.barking : colors.resting} />
            <View style={s.summaryText}>
              <Text style={s.summaryTitle} testID="protection-summary-title">{summaryTitle}</Text>
              <Text style={s.summaryBody} testID="protection-summary-body">{summaryBody}</Text>
            </View>
          </View>
        </Card>

        {/* 5 Protection Areas */}
        {areas.map((area) => (
          <AreaCard key={area.id} area={area} />
        ))}

        {/* Quick access to detailed findings */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View Protection Details"
          testID="protection-view-details"
          onPress={() => router.push("/protection-details")}
          style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}
        >
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, borderColor: colors.navyBorder }}>
            <View style={[s.areaIconWell, { backgroundColor: colors.navyTint }]}>
              <Shield size={20} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.areaTitle, { fontSize: 15 }]}>Protection Details</Text>
              <Text style={s.areaDesc}>Active findings, verified blocks and today&apos;s protection timeline.</Text>
            </View>
          </Card>
        </Pressable>

        {/* Access to full Gates view (secondary) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all Gates"
          testID="protection-view-gates"
          onPress={() => router.push("/gates")}
          style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}
        >
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={[s.areaIconWell, { backgroundColor: colors.navyTint }]}>
              <ShieldCheck size={20} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.areaTitle, { fontSize: 15 }]}>View all Gates</Text>
              <Text style={s.areaDesc}>See every Gate, their current status, health log and technical detail.</Text>
            </View>
          </Card>
        </Pressable>
      </ScrollView>
    </View>
  );
}
