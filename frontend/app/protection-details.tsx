// Protection Category Details — Screen B.
// Shows a 3-tab detail view (Overview | Gates | Coverage) for a single
// protection category, plus a "Related threat cases" navigation area.
//
// Reuses the existing Gate architecture, protectionAreas data and
// healthStore for live status. Does NOT invent new Gates or features.

import { useLocalSearchParams, useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Grid2x2 from "lucide-react-native/icons/grid-2x2";
import Info from "lucide-react-native/icons/info";
import Link2 from "lucide-react-native/icons/link-2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import Settings from "lucide-react-native/icons/settings";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import User from "lucide-react-native/icons/user";
import Wifi from "lucide-react-native/icons/wifi";
import React, { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InfoButton } from "@/src/components/InfoButton";
import { Card, Pill } from "@/src/components/ui";
import {
  buildProtectionAreas,
  type ProtectionArea,
  type ProtectionAreaCapability,
  type ProtectionAreaId,
} from "@/src/domain/protectionAreas";
import { gateTone, type GateId } from "@/src/domain/gates";
import { CATEGORY_CONTENT } from "@/src/domain/protectionContent";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const higginsAvatar = require("@/assets/images/higgins-avatar.png");

// ── Gate icon mapping ───────────────────────────────────────────────────────
const GATE_ICONS: Record<
  GateId,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  site: ShieldCheck,
  link: Link2,
  text: MessageSquare,
  call: Phone,
  email: Mail,
  account: User,
  file: FileText,
  app: Grid2x2,
  device: Smartphone,
  network: Wifi,
};

// ── Route for tapping a Gate row → navigates to Gate-specific screen ────────
const GATE_ROUTES: Record<GateId, string> = {
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

// ── Map gate categories to patrol category filters ──────────────────────────
const AREA_TO_PATROL_CATEGORIES: Record<ProtectionAreaId, string[]> = {
  websites_links: ["site", "link"],
  messages_calls: ["text", "call"],
  email_accounts: ["email", "account"],
  apps_files: ["app", "file"],
  device_internet: ["device", "network"],
};

// ── Tab types ───────────────────────────────────────────────────────────────
type DetailTab = "overview" | "gates" | "coverage";
const TABS: { key: DetailTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "gates", label: "Gates" },
  { key: "coverage", label: "Coverage" },
];

// ── Styles ──────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  headerRow: {
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.displayBold,
    fontSize: 24,
    color: c.onSurface,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },

  // Status row
  statusRow: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xs,
  },
  descriptionText: {
    fontFamily: fonts.text,
    fontSize: 15,
    lineHeight: 22,
    color: c.onSurfaceSecondary,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },

  // Tabs
  tabBar: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
  },
  tabContainer: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: c.surfaceTertiary,
    borderRadius: radius.md,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  tabLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
  },

  // Content
  scrollContent: {
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    paddingBottom: spacing["3xl"],
  },

  // Higgins briefing
  briefingCard: {
    gap: spacing.md,
  },
  briefingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  briefingAvatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: c.surfaceTertiary,
    flexShrink: 0,
  },
  briefingAvatar: { width: 44, height: 44 },
  briefingTitleBlock: { flex: 1, gap: 2 },
  briefingTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.onSurface,
  },
  briefingSub: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
  },
  briefingBody: {
    fontFamily: fonts.text,
    fontSize: 15,
    lineHeight: 22,
    color: c.onSurface,
  },

  // "What is … Protection?" section
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    lineHeight: 24,
    color: c.onSurface,
  },
  sectionBody: {
    fontFamily: fonts.text,
    fontSize: 15,
    lineHeight: 22,
    color: c.onSurfaceSecondary,
  },

  // How it works card
  howCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  howHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  howIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  howTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    color: c.onSurface,
  },
  bullet: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingLeft: spacing.xs,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
  },

  // Gate rows
  gatesSection: {
    gap: spacing.md,
  },
  gatesSectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    lineHeight: 23,
    color: c.onSurface,
  },
  gateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  gateIconWell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  gateInfo: {
    flex: 1,
    flexShrink: 1,
    gap: 4,
    alignItems: "flex-start",
  },
  gateName: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    lineHeight: 19,
    color: c.onSurface,
  },
  gatePurpose: {
    fontFamily: fonts.text,
    fontSize: 12,
    lineHeight: 17,
    color: c.onSurfaceSecondary,
  },
  gateDivider: {
    height: 1,
  },

  // Coverage section
  coverageSection: {
    gap: spacing.md,
  },
  coverageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  coverageIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  coverageTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    color: c.onSurface,
  },

  // Related threats card
  threatCard: {
    gap: spacing.md,
  },
  threatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  threatIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  threatTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    color: c.onSurface,
  },
  threatBody: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
  },
  threatBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
    gap: spacing.sm,
  },
  threatBtnText: {
    flex: 1,
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
  },

  // Bottom Higgins card
  bottomCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  bottomTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  bottomAvatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
    flexShrink: 0,
  },
  bottomAvatar: { width: 48, height: 48 },
  bottomTextBlock: {
    flex: 1,
    gap: 2,
  },
  bottomTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    lineHeight: 19,
    color: c.onSurface,
  },
  bottomBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    color: c.onSurfaceSecondary,
  },
  learnBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
    minHeight: 44,
  },
  learnBtnText: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
  },
}));

// ── Tab Bar ─────────────────────────────────────────────────────────────────

function ProtectionTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();

  return (
    <View style={s.tabBar}>
      <View style={s.tabContainer}>
        {TABS.map((t) => {
          const active = t.key === activeTab;
          return (
            <Pressable
              key={t.key}
              testID={`protection-tab-${t.key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
              onPress={() => onTabChange(t.key)}
              style={[
                s.tab,
                {
                  backgroundColor: active ? colors.brand : "transparent",
                },
              ]}
            >
              <Text
                style={[
                  s.tabLabel,
                  {
                    color: active ? colors.onBrand : colors.onSurfaceSecondary,
                  },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── Overview Tab Content ────────────────────────────────────────────────────

function OverviewContent({ area }: { area: ProtectionArea }) {
  const s = useStyles();
  const { colors } = useTheme();

  // Build a dynamic health summary from actual gate statuses
  const healthSummary = useMemo(() => {
    const caps = area.capabilities;
    const good = caps.filter(
      (c) => c.tone === "good" || c.tone === "neutral" || c.tone === "resting"
    );
    const limited = caps.filter(
      (c) => c.tone === "limited" || c.tone === "unverified" || c.tone === "ears_up"
    );
    const attention = caps.filter(
      (c) => c.tone === "action" || c.tone === "growling" || c.tone === "barking" || c.tone === "biting"
    );
    const off = caps.filter(
      (c) => c.tone === "off" || c.tone === "unavailable"
    );

    const lines: string[] = [];

    if (good.length === caps.length) {
      lines.push(
        `All ${caps.length} Gates in ${area.title} are working correctly. No issues detected.`
      );
    } else {
      if (good.length > 0) {
        lines.push(
          `${good.length} of ${caps.length} ${good.length === 1 ? "Gate is" : "Gates are"} working correctly.`
        );
      }
      if (limited.length > 0) {
        limited.forEach((c) => {
          lines.push(`${c.label}: ${c.currentHelp}`);
        });
      }
      if (attention.length > 0) {
        attention.forEach((c) => {
          lines.push(`${c.label} needs attention: ${c.currentHelp}`);
        });
      }
      if (off.length > 0) {
        off.forEach((c) => {
          lines.push(`${c.label}: ${c.statusLabel}${c.limitation ? " — " + c.limitation : ""}`);
        });
      }
    }

    return lines;
  }, [area]);

  const content = CATEGORY_CONTENT[area.id];

  return (
    <View style={{ gap: spacing.lg }}>
      {/* Higgins health summary */}
      <Card style={s.briefingCard} testID="protection-detail-briefing">
        <View style={s.briefingHeader}>
          <View style={s.briefingAvatarWrap}>
            <Image source={higginsAvatar} style={s.briefingAvatar} />
          </View>
          <View style={s.briefingTitleBlock}>
            <Text style={s.briefingTitle}>Higgins&apos; briefing</Text>
            <Text style={s.briefingSub}>Protection health summary</Text>
          </View>
        </View>

        {/* Dynamic health status lines */}
        {healthSummary.map((line, i) => (
          <Text key={i} style={s.sectionBody}>{line}</Text>
        ))}

        {/* How it works */}
        <View
          style={[s.howCard, { backgroundColor: colors.surfaceTertiary }]}
        >
          <View style={s.howHeader}>
            <View
              style={[
                s.howIcon,
                { backgroundColor: "rgba(22,34,53,0.12)" },
              ]}
            >
              <Info size={18} color={colors.brand} />
            </View>
            <Text style={s.howTitle}>How it works</Text>
          </View>
          {content.howItWorks.map((bullet, i) => (
            <View key={i} style={s.bullet}>
              <View
                style={[
                  s.bulletDot,
                  { backgroundColor: colors.brand },
                ]}
              />
              <Text style={s.bulletText}>{bullet}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Bottom Higgins card */}
      <BottomHigginsCard area={area} />
    </View>
  );
}

// ── Gates Tab Content ───────────────────────────────────────────────────────

function GatesContent({ area }: { area: ProtectionArea }) {
  const s = useStyles();

  return (
    <View style={{ gap: spacing.lg }}>
      <Card style={s.gatesSection} testID="protection-detail-gates-full">
        <Text style={s.gatesSectionTitle}>
          {area.title} Gates
        </Text>
        {area.capabilities.map((cap, idx) => (
          <GateDetailRow
            key={cap.gateId}
            cap={cap}
            isLast={idx === area.capabilities.length - 1}
          />
        ))}
      </Card>
    </View>
  );
}

/** Expanded gate row for the Gates tab — shows more detail including limitations. */
function GateDetailRow({
  cap,
  isLast,
}: {
  cap: ProtectionAreaCapability;
  isLast: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const Icon = GATE_ICONS[cap.gateId as GateId] ?? ShieldCheck;
  const tone = gateTone(cap.tone);
  const modeLabel = cap.mode === "automatic" ? "Automatic protection" : "Manual check";
  const route = GATE_ROUTES[cap.gateId as GateId];

  const content = (
    <>
      <View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View
            style={[
              s.gateIconWell,
              { backgroundColor: colors.surfaceTertiary },
            ]}
          >
            <Icon size={20} color={colors.brand} />
          </View>
          <View style={s.gateInfo}>
            <Text style={s.gateName}>{cap.label}</Text>
            <Pill tone={tone} label={cap.statusLabel} />
            <Text
              style={{
                fontFamily: fonts.text,
                fontSize: 12,
                color: colors.muted,
              }}
            >
              {modeLabel}
            </Text>
          </View>
          {route ? (
            <ChevronRight size={18} color={colors.onSurfaceSecondary} />
          ) : null}
        </View>
        <Text style={s.gatePurpose}>{cap.currentHelp}</Text>
        {cap.limitation ? (
          <Text
            style={{
              fontFamily: fonts.text,
              fontSize: 13,
              lineHeight: 18,
              color: colors.growlingText,
            }}
          >
            {cap.limitation}
          </Text>
        ) : null}
      </View>
      {!isLast ? (
        <View
          style={[s.gateDivider, { backgroundColor: colors.divider }]}
        />
      ) : null}
    </>
  );

  if (route) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${cap.label}: ${cap.statusLabel}`}
        testID={`gate-detail-${cap.gateId}`}
        onPress={() => router.push(route as never)}
        style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View testID={`gate-detail-${cap.gateId}`}>{content}</View>;
}

// ── Coverage Tab / Section ──────────────────────────────────────────────────

function CoverageContent({ area }: { area: ProtectionArea }) {
  const s = useStyles();
  const { colors } = useTheme();
  const content = CATEGORY_CONTENT[area.id];

  return (
    <Card style={s.coverageSection} testID="protection-detail-coverage">
      <View style={s.coverageHeader}>
        <View
          style={[
            s.coverageIcon,
            { backgroundColor: colors.surfaceTertiary },
          ]}
        >
          <Globe size={18} color={colors.brand} />
        </View>
        <Text style={s.coverageTitle}>Coverage</Text>
      </View>
      {content.coverage.map((bullet, i) => (
        <View key={i} style={s.bullet}>
          <View
            style={[s.bulletDot, { backgroundColor: colors.brand }]}
          />
          <Text style={s.bulletText}>{bullet}</Text>
        </View>
      ))}
    </Card>
  );
}

// ── Related Threats ─────────────────────────────────────────────────────────

function RelatedThreats({ area }: { area: ProtectionArea }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const categories = AREA_TO_PATROL_CATEGORIES[area.id];
  const categoryLabel = area.title.split("&")[0].trim().toLowerCase();

  return (
    <Card style={s.threatCard} testID="protection-detail-threats">
      <View style={s.threatHeader}>
        <View
          style={[
            s.threatIcon,
            { backgroundColor: colors.surfaceTertiary },
          ]}
        >
          <ShieldCheck size={18} color={colors.brand} />
        </View>
        <Text style={s.threatTitle}>Related threat cases</Text>
      </View>
      <Text style={s.threatBody}>
        If Apollo has detected {categoryLabel}-related threats, you can review
        them here.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${categoryLabel}-related threats`}
        testID="protection-view-threats"
        onPress={() =>
          router.push(
            `/(tabs)/patrol?category=${categories.join(",")}` as never,
          )
        }
        style={({ pressed }) => [
          s.threatBtn,
          {
            borderColor: colors.border,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <Text style={s.threatBtnText}>
          View {categoryLabel}-related threats
        </Text>
        <ChevronRight size={18} color={colors.onSurfaceSecondary} />
      </Pressable>
    </Card>
  );
}

// ── Bottom Higgins Card ─────────────────────────────────────────────────────

function BottomHigginsCard({ area }: { area: ProtectionArea }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const content = CATEGORY_CONTENT[area.id];

  const gateNames = area.capabilities.map((c) => c.gateName).join(", ");
  const askPrompt = `Tell me about my ${area.title} protection. It includes these Gates: ${gateNames}. What does each Gate cover, how do they work together, and is there anything I should do to improve my ${area.title} protection?`;

  return (
    <View
      style={[s.bottomCard, { backgroundColor: colors.surfaceTertiary }]}
      testID="protection-detail-bottom-higgins"
    >
      <View style={s.bottomTopRow}>
        <View style={s.bottomAvatarWrap}>
          <Image source={higginsAvatar} style={s.bottomAvatar} />
        </View>
        <View style={s.bottomTextBlock}>
          <Text style={s.bottomTitle}>{content.higginsLearnTitle}</Text>
          <Text style={s.bottomBody}>
            {content.higginsLearnDescription}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ask Higgins about ${area.title} protection`}
        testID="protection-learn-with-higgins"
        onPress={() => router.push({ pathname: "/(tabs)/ask", params: { prompt: askPrompt } })}
        style={({ pressed }) => [
          s.learnBtn,
          {
            backgroundColor: colors.gold,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <Text style={[s.learnBtnText, { color: colors.onBrand }]}>
          Ask Higgins about {area.title}
        </Text>
      </Pressable>
    </View>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function ProtectionDetailsScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const health = useProtectionHealth();
  const params = useLocalSearchParams<{ category?: string }>();

  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  const areas = useMemo(
    () => (health.checking ? [] : buildProtectionAreas(health.gates)),
    [health.checking, health.gates],
  );

  // Find the requested area
  const categoryId = (params.category ?? "websites_links") as ProtectionAreaId;
  const area = areas.find((a) => a.id === categoryId);
  const content = CATEGORY_CONTENT[categoryId];

  // Loading / not found
  if (health.checking || !area) {
    return (
      <View style={s.root} testID="protection-details-screen">
        <View style={{ paddingTop: insets.top + spacing.md }}>
          <View style={s.headerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              testID="protection-details-back"
              onPress={() => goBackOrHome(router)}
              style={s.backBtn}
            >
              <ChevronLeft size={24} color={colors.onSurface} />
            </Pressable>
            <Text style={s.headerTitle}>Protection</Text>
          </View>
        </View>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.xl,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.text,
              fontSize: 15,
              color: colors.onSurfaceSecondary,
              textAlign: "center",
            }}
          >
            {health.checking
              ? "Checking protection status…"
              : "Protection category not found."}
          </Text>
        </View>
      </View>
    );
  }

  const tone = gateTone(area.summaryTone);

  return (
    <View style={s.root} testID="protection-details-screen">
      {/* ── Header ── */}
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <View style={s.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Protection"
            testID="protection-details-back"
            onPress={() => goBackOrHome(router)}
            style={s.backBtn}
          >
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle}>{area.title}</Text>
          <View style={s.headerActions}>
            <InfoButton
              info={{
                title: `About ${area.title}`,
                body: [
                  content.shortDescription,
                  `This category includes ${area.capabilities.length} protection ${area.capabilities.length === 1 ? "Gate" : "Gates"}.`,
                  "Tap a Gate row to see its detailed settings and status.",
                ],
              }}
              testID="protection-details-info"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              testID="protection-details-settings"
              onPress={() => router.push("/settings" as never)}
              style={({ pressed }) => [
                s.headerIconBtn,
                { opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Settings size={22} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>

        {/* Status pill */}
        <View style={s.statusRow}>
          <Pill tone={tone} label={area.summaryStatus} />
        </View>

        {/* Short description */}
        <Text style={s.descriptionText}>{content.shortDescription}</Text>

        {/* Tab bar */}
        <ProtectionTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      </View>

      {/* ── Scrollable content ── */}
      <ScrollView
        testID="protection-details-scroll"
        contentContainerStyle={[
          s.scrollContent,
          { paddingBottom: insets.bottom + spacing["3xl"], paddingTop: spacing.lg },
        ]}
      >
        {activeTab === "overview" ? (
          <OverviewContent area={area} />
        ) : activeTab === "gates" ? (
          <GatesContent area={area} />
        ) : (
          <View style={{ gap: spacing.lg }}>
            <CoverageContent area={area} />
            <RelatedThreats area={area} />
            <BottomHigginsCard area={area} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
