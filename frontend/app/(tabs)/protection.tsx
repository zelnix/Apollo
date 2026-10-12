// Protection Dashboard — Screen A.
// Shows the overall protection summary, Higgins guidance and a 2-column
// category grid. Each card navigates to Protection Category Details (Screen B).
//
// Reuses existing Gate architecture, status models and protectionAreas data.
// The category grid uses REAL gates and statuses — the mock-up's illustrative
// eight categories are replaced by the five actual areas defined in the code.

import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Globe from "lucide-react-native/icons/globe";
import Grid2x2 from "lucide-react-native/icons/grid-2x2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import React, { useMemo } from "react";
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pill } from "@/src/components/ui";
import {
  buildProtectionAreas,
  type ProtectionArea,
  type ProtectionAreaId,
} from "@/src/domain/protectionAreas";
import { gateTone } from "@/src/domain/gates";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const higginsAvatar = require("@/assets/images/higgins-avatar.png");

// ── Icon map per area ───────────────────────────────────────────────────────
const AREA_ICONS: Record<
  ProtectionAreaId,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  websites_links: Globe,
  messages_calls: MessageSquare,
  email_accounts: Mail,
  apps_files: Grid2x2,
  device_internet: Smartphone,
};

// ── Styles ──────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header with back button
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: 2,
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

  subtitle: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
    marginBottom: 2,
  },
  content: {
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },

  // ── Pale green overview card ──
  overviewCard: {
    borderRadius: radius.md,
    overflow: "hidden",
  },
  overviewTop: {
    padding: spacing.sm,
    paddingBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  overviewShield: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  overviewTextBlock: {
    flex: 1,
    gap: 2,
  },
  overviewTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    lineHeight: 24,
  },
  overviewStatus: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 19,
  },
  overviewSub: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
  },

  // ── Higgins tip inside overview card ──
  tipArea: {
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  tipAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    flexShrink: 0,
  },
  tipAvatar: { width: 40, height: 40 },
  tipTextBlock: { flex: 1, gap: 1 },
  tipTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 13,
    lineHeight: 17,
  },
  tipBody: {
    fontFamily: fonts.text,
    fontSize: 12,
    lineHeight: 16,
  },

  // ── Category grid ──
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  categoryCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  categoryIconWell: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  categoryNameBlock: {
    flex: 1,
    flexShrink: 1,
    gap: 1,
  },
  categoryName: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    lineHeight: 18,
  },
  categoryGateCount: {
    fontFamily: fonts.text,
    fontSize: 12,
    lineHeight: 16,
  },
  categoryFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  // ── Bottom Higgins guidance card ──
  guidanceCard: {
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  guidanceTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  guidanceAvatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    flexShrink: 0,
  },
  guidanceAvatar: { width: 44, height: 44 },
  guidanceTextBlock: {
    flex: 1,
    gap: 1,
  },
  guidanceTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 13,
    lineHeight: 17,
  },
  guidanceBody: {
    fontFamily: fonts.text,
    fontSize: 12,
    lineHeight: 16,
  },
  learnBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildOverviewText(areas: ProtectionArea[], checking: boolean) {
  if (checking) {
    return {
      status: "Protection status is being checked.",
      sub: "",
      tipText: "Apollo is checking the current state of your protection.",
    };
  }
  const attention = areas.filter((a) => a.attentionCount > 0);
  const allWatching = areas.every(
    (a) => a.summaryTone === "good" || (a.automaticCount === 0 && a.summaryTone === "neutral"),
  );
  const limited = areas.filter((a) => a.summaryTone === "limited" || a.summaryTone === "unverified");

  if (attention.length > 0) {
    return {
      status: "Some protection needs attention.",
      sub: `${attention.length} ${attention.length === 1 ? "category requires" : "categories require"} action.`,
      tipText: `${attention.map((a) => a.title).join(" and ")} ${attention.length === 1 ? "needs" : "need"} your attention. Tap to see details.`,
    };
  }
  if (allWatching) {
    return {
      status: "Your protection is active.",
      sub: "All categories are covered.",
      tipText: "Tap a category to see what Apollo protects and how it works.",
    };
  }
  if (limited.length > 0) {
    return {
      status: "Most categories are covered.",
      sub: `${limited.length} ${limited.length === 1 ? "category has" : "categories have"} limited coverage.`,
      tipText: "Tap a category to see details.",
    };
  }
  return {
    status: "Your protection is active.",
    sub: "Tap a category to see details.",
    tipText: "Tap a category to see what Apollo protects and how it works.",
  };
}

// ── Category Card Component ─────────────────────────────────────────────────

function CategoryCard({
  area,
  cardWidth,
}: {
  area: ProtectionArea;
  cardWidth: number;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const Icon = AREA_ICONS[area.id];
  const tone = gateTone(area.summaryTone);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${area.title}: ${area.summaryStatus}`}
      testID={`protection-category-${area.id}`}
      onPress={() =>
        router.push(`/protection-details?category=${area.id}` as never)
      }
      style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}
    >
      <View
        style={[
          s.categoryCard,
          {
            width: cardWidth,
            backgroundColor: colors.surfaceSecondary,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={s.categoryHeader}>
          <View
            style={[
              s.categoryIconWell,
              { backgroundColor: colors.surfaceTertiary },
            ]}
          >
            <Icon size={18} color={colors.brand} />
          </View>
          <View style={s.categoryNameBlock}>
            <Text
              style={[s.categoryName, { color: colors.onSurface }]}
              numberOfLines={1}
            >
              {area.title}
            </Text>
            <Text
              style={[s.categoryGateCount, { color: colors.onSurfaceSecondary }]}
            >
              {area.capabilities.length}{" "}
              {area.capabilities.length === 1 ? "Gate" : "Gates"}
            </Text>
          </View>
          <ChevronRight size={16} color={colors.onSurfaceSecondary} />
        </View>
        <View style={s.categoryFooter}>
          <Pill tone={tone} label={area.summaryStatus} />
        </View>
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
  const { width: screenWidth } = useWindowDimensions();

  const areas = useMemo(
    () => (health.checking ? [] : buildProtectionAreas(health.gates)),
    [health.checking, health.gates],
  );

  const { status, sub, tipText } = useMemo(
    () => buildOverviewText(areas, health.checking),
    [areas, health.checking],
  );

  const hasAttention = areas.some((a) => a.attentionCount > 0);

  // Card width: 2-column grid with sm padding each side + sm gap
  const cardWidth = (screenWidth - spacing.sm * 2 - spacing.sm) / 2;

  return (
    <View style={s.root} testID="protection-screen">
      {/* ── Header with back button ── */}
      <View style={{ paddingTop: insets.top + spacing.xs }}>
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
        </View>
      </View>

      <ScrollView
        testID="protection-scroll"
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + 90 },
        ]}
      >
        {/* Subtitle */}
        <Text style={s.subtitle}>
          See your protection categories and the Gates inside each one.
        </Text>

        {/* ── Pale green overview card ── */}
        <View
          style={[
            s.overviewCard,
            {
              backgroundColor: hasAttention
                ? "rgba(229,162,26,0.08)"
                : "rgba(79,175,131,0.10)",
            },
          ]}
          testID="protection-overview-card"
        >
          <View style={s.overviewTop}>
            <View
              style={[
                s.overviewShield,
                {
                  backgroundColor: hasAttention
                    ? "rgba(229,162,26,0.15)"
                    : "rgba(79,175,131,0.18)",
                },
              ]}
            >
              <ShieldCheck
                size={28}
                color={hasAttention ? colors.ears_up : colors.resting}
              />
            </View>
            <View style={s.overviewTextBlock}>
              <Text
                style={[
                  s.overviewTitle,
                  {
                    color: hasAttention
                      ? colors.ears_upText
                      : colors.restingText,
                  },
                ]}
                testID="protection-overview-title"
              >
                Protection overview
              </Text>
              <Text
                style={[
                  s.overviewStatus,
                  { color: colors.onSurface },
                ]}
                testID="protection-overview-status"
              >
                {status}
              </Text>
              {sub ? (
                <Text
                  style={[
                    s.overviewSub,
                    { color: colors.onSurfaceSecondary },
                  ]}
                >
                  {sub}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Higgins tip */}
          <View
            style={[
              s.tipArea,
              {
                backgroundColor: "rgba(255,255,255,0.75)",
              },
            ]}
            testID="protection-higgins-tip"
          >
            <View style={s.tipAvatarWrap}>
              <Image source={higginsAvatar} style={s.tipAvatar} />
            </View>
            <View style={s.tipTextBlock}>
              <Text style={[s.tipTitle, { color: colors.onSurface }]}>
                Higgins&apos; tip
              </Text>
              <Text
                style={[s.tipBody, { color: colors.onSurfaceSecondary }]}
              >
                {tipText}
              </Text>
            </View>
          </View>
        </View>

        {/* ── 2-column category grid ── */}
        <View style={s.grid}>
          {areas.map((area) => (
            <CategoryCard
              key={area.id}
              area={area}
              cardWidth={cardWidth}
            />
          ))}
        </View>

        {/* ── Bottom Higgins guidance card ── */}
        <View
          style={[
            s.guidanceCard,
            { backgroundColor: colors.surfaceTertiary },
          ]}
          testID="protection-higgins-guidance"
        >
          <View style={s.guidanceTopRow}>
            <View style={s.guidanceAvatarWrap}>
              <Image source={higginsAvatar} style={s.guidanceAvatar} />
            </View>
            <View style={s.guidanceTextBlock}>
              <Text style={[s.guidanceTitle, { color: colors.onSurface }]}>
                Higgins can help explain your protection
              </Text>
              <Text
                style={[s.guidanceBody, { color: colors.onSurfaceSecondary }]}
              >
                Tap a category to see what it does, how it works, and its Gate
                status.
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Learn more about protection"
            testID="protection-learn-more"
            onPress={() => router.push("/(tabs)/ask" as never)}
            style={({ pressed }) => [
              s.learnBtn,
              {
                backgroundColor: colors.gold,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Text style={[s.learnBtnText, { color: colors.onBrand }]}>
              Learn more
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
