// Protection Dashboard — Screen A.
// Matches the approved mockup exactly: 2-column category grid, pale-green
// overview card, Higgins tip, bottom Higgins guidance card.
// Uses the 8 dashboard categories derived from the 10-Gate architecture.

import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Globe from "lucide-react-native/icons/globe";
import Grid2x2 from "lucide-react-native/icons/grid-2x2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import Settings from "lucide-react-native/icons/settings";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import User from "lucide-react-native/icons/user";
import Wifi from "lucide-react-native/icons/wifi";
import React, { useMemo } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InfoButton } from "@/src/components/InfoButton";
import {
  buildDashboardCategories,
  type DashboardCategory,
  type DashboardCategoryId,
} from "@/src/domain/dashboardCategories";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const higginsAvatar = require("@/assets/images/higgins-avatar.png");

// ── Icon map ────────────────────────────────────────────────────────────────
const CATEGORY_ICONS: Record<
  DashboardCategoryId,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  internet: Globe,
  messages: MessageSquare,
  email: Mail,
  apps: Grid2x2,
  device: Smartphone,
  network: Wifi,
  identity: User,
  calls: Phone,
};

// ── Styles ──────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
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
    fontSize: 26,
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
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },

  // Scroll content
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing["2xl"],
  },
  subtitle: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
  },

  // Pale green overview card
  overviewCard: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  overviewTop: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  overviewShield: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  overviewTextBlock: {
    flex: 1,
    gap: 4,
  },
  overviewTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 19,
    lineHeight: 25,
  },
  overviewStatus: {
    fontFamily: fonts.text,
    fontSize: 15,
    lineHeight: 21,
  },

  // Higgins tip inside overview card
  tipArea: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  tipAvatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    flexShrink: 0,
  },
  tipAvatar: { width: 44, height: 44 },
  tipTextBlock: { flex: 1, gap: 2 },
  tipName: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    lineHeight: 18,
  },
  tipBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
  },

  // 2-column category grid
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  categoryCard: {
    width: "47.5%",
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 130,
  },
  categoryTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  categoryIconWell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryName: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    lineHeight: 21,
  },
  categoryGateCount: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 17,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
  },

  // Bottom Higgins guidance card
  guidanceCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  guidanceTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  guidanceAvatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
    flexShrink: 0,
  },
  guidanceAvatar: { width: 48, height: 48 },
  guidanceTextBlock: {
    flex: 1,
    gap: 2,
  },
  guidanceTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    lineHeight: 19,
  },
  guidanceBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
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
    fontSize: 14,
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(tone: string): string {
  switch (tone) {
    case "good": return "#2E7D32";
    case "limited": case "unverified": return "#E68A00";
    case "action": return "#D32F2F";
    case "off": case "unavailable": return "#757575";
    default: return "#757575";
  }
}

function buildOverviewText(categories: DashboardCategory[], checking: boolean) {
  if (checking) return { status: "Protection status is being checked.", tipText: "Apollo is checking the current state of your protection." };
  const attention = categories.filter((c) => c.summaryTone === "action");
  const limited = categories.filter((c) => c.summaryTone === "limited" || c.summaryTone === "unverified");
  const allGood = categories.every((c) => c.summaryTone === "good" || c.summaryTone === "neutral");
  if (attention.length > 0) return { status: `Some protection needs attention.\n${attention.length} ${attention.length === 1 ? "category requires" : "categories require"} action.`, tipText: `${attention.map((c) => c.title).join(" and ")} ${attention.length === 1 ? "needs" : "need"} your attention. Tap to see details.` };
  if (allGood) return { status: "Your protection is active.\nAll categories are covered.", tipText: "Tap a category to see what Apollo protects and how it works." };
  if (limited.length > 0) return { status: `Most categories are covered.\n${limited.length} ${limited.length === 1 ? "category has" : "categories have"} limited coverage.`, tipText: "Tap a category to see details." };
  return { status: "Your protection is active.\nTap a category to see details.", tipText: "Tap a category to see what Apollo protects and how it works." };
}

// ── Category Card ───────────────────────────────────────────────────────────

function CategoryCard({ category }: { category: DashboardCategory }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const Icon = CATEGORY_ICONS[category.id];
  const color = statusColor(category.summaryTone);
  const isGood = category.summaryTone === "good" || category.summaryTone === "neutral";
  const isWarning = category.summaryTone === "limited" || category.summaryTone === "unverified";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${category.title}: ${category.summaryStatus}`}
      testID={`protection-cat-${category.id}`}
      onPress={() => router.push(`/protection-details?category=${category.parentAreaId}` as never)}
      style={({ pressed }) => [
        s.categoryCard,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, opacity: pressed ? 0.82 : 1 },
      ]}
    >
      <View style={s.categoryTopRow}>
        <View style={[s.categoryIconWell, { backgroundColor: colors.surfaceTertiary }]}>
          <Icon size={22} color={colors.brand} />
        </View>
        <ChevronRight size={18} color={colors.muted} />
      </View>
      <Text style={[s.categoryName, { color: colors.onSurface }]}>{category.title}</Text>
      <Text style={[s.categoryGateCount, { color: colors.onSurfaceSecondary }]}>
        {category.gateCount} {category.gateCount === 1 ? "Gate" : "Gates"}
      </Text>
      <View style={s.statusRow}>
        {isGood ? (
          <CircleCheck size={16} color={color} />
        ) : isWarning ? (
          <CircleAlert size={16} color={color} />
        ) : (
          <View style={[s.statusDot, { backgroundColor: color }]} />
        )}
        <Text style={[s.statusText, { color }]}>{category.summaryStatus}</Text>
      </View>
    </Pressable>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function ProtectionScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const health = useProtectionHealth();

  const categories = useMemo(
    () => (health.checking ? [] : buildDashboardCategories(health.gates)),
    [health.checking, health.gates],
  );

  const { status, tipText } = useMemo(
    () => buildOverviewText(categories, health.checking),
    [categories, health.checking],
  );

  const hasAttention = categories.some((c) => c.summaryTone === "action");

  return (
    <View style={s.root} testID="protection-screen">
      {/* ── Header ── */}
      <View style={{ paddingTop: insets.top + spacing.sm }}>
        <View style={s.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="protection-back"
            onPress={() => goBackOrHome(router)}
            style={s.backBtn}
          >
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={s.headerTitle}>Protection</Text>
          <View style={s.headerActions}>
            <InfoButton
              info={{
                title: "About Protection",
                body: [
                  "The Protection dashboard shows what Apollo is protecting and how each category is performing.",
                  "Tap a category to see its Gates, how they work, and what they cover.",
                  "Statuses are calculated from real device capabilities and permissions.",
                ],
              }}
              testID="protection-info"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              testID="protection-settings"
              onPress={() => router.push("/settings" as never)}
              style={({ pressed }) => [s.headerIconBtn, { opacity: pressed ? 0.75 : 1 }]}
            >
              <Settings size={22} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView
        testID="protection-scroll"
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 90 }]}
      >
        {/* Subtitle */}
        <Text style={s.subtitle}>See your protection categories and the Gates inside each one.</Text>

        {/* ── Pale green overview card ── */}
        <View
          style={[s.overviewCard, { backgroundColor: hasAttention ? "rgba(229,162,26,0.08)" : "rgba(79,175,131,0.10)" }]}
          testID="protection-overview-card"
        >
          <View style={s.overviewTop}>
            <View style={[s.overviewShield, { backgroundColor: hasAttention ? "rgba(229,162,26,0.15)" : "rgba(79,175,131,0.18)" }]}>
              <ShieldCheck size={28} color={hasAttention ? colors.ears_up : colors.resting} />
            </View>
            <View style={s.overviewTextBlock}>
              <Text style={[s.overviewTitle, { color: hasAttention ? colors.ears_upText : colors.restingText }]} testID="protection-overview-title">
                Protection overview
              </Text>
              <Text style={[s.overviewStatus, { color: colors.onSurface }]} testID="protection-overview-status">
                {status}
              </Text>
            </View>
          </View>

          {/* Higgins tip */}
          <View style={[s.tipArea, { backgroundColor: "rgba(255,255,255,0.75)" }]} testID="protection-higgins-tip">
            <View style={s.tipAvatarWrap}>
              <Image source={higginsAvatar} style={s.tipAvatar} />
            </View>
            <View style={s.tipTextBlock}>
              <Text style={[s.tipName, { color: colors.onSurface }]}>Higgins&apos; tip</Text>
              <Text style={[s.tipBody, { color: colors.onSurfaceSecondary }]}>{tipText}</Text>
            </View>
          </View>
        </View>

        {/* ── 2-column category grid ── */}
        <View style={s.grid}>
          {categories.map((cat) => (
            <CategoryCard key={cat.id} category={cat} />
          ))}
        </View>

        {/* ── Bottom Higgins guidance card ── */}
        <View style={[s.guidanceCard, { backgroundColor: colors.surfaceTertiary }]} testID="protection-higgins-guidance">
          <View style={s.guidanceTopRow}>
            <View style={s.guidanceAvatarWrap}>
              <Image source={higginsAvatar} style={s.guidanceAvatar} />
            </View>
            <View style={s.guidanceTextBlock}>
              <Text style={[s.guidanceTitle, { color: colors.onSurface }]}>Higgins can help explain your protection</Text>
              <Text style={[s.guidanceBody, { color: colors.onSurfaceSecondary }]}>
                Tap a category to see what it does, how it works, and its Gate status.
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Learn more about protection"
            testID="protection-learn-more"
            onPress={() => router.push("/(tabs)/ask" as never)}
            style={({ pressed }) => [s.learnBtn, { backgroundColor: colors.gold, opacity: pressed ? 0.82 : 1 }]}
          >
            <Text style={[s.learnBtnText, { color: colors.onBrand }]}>Learn more</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
