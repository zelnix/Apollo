// Protection Dashboard — redesigned to match the approved mockup.
// Hero card with landscape background, 5 category cards in single-column list,
// bottom guidance card. Uses 5 protection areas (not 8 individual categories).

import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Globe from "lucide-react-native/icons/globe";
import Grid2x2 from "lucide-react-native/icons/grid-2x2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Settings from "lucide-react-native/icons/settings";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import React, { useMemo } from "react";
import {
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InfoButton } from "@/src/components/InfoButton";
import {
  buildProtectionAreas,
  type ProtectionArea,
  type ProtectionAreaId,
} from "@/src/domain/protectionAreas";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { fonts, radius, spacing, useTheme } from "@/src/theme";

// ── Assets ──────────────────────────────────────────────────────────────────
const heroBackground = require("@/assets/images/hero-bg-protection.jpg");
const higginsAvatar = require("@/assets/images/higgins-avatar.png");
const logoImage = require("@/assets/images/logo.png");

// ── Icon map for the 5 protection areas ─────────────────────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function toneColor(tone: string): string {
  switch (tone) {
    case "good":
      return "#2E7D32";
    case "limited":
    case "unverified":
      return "#E68A00";
    case "action":
      return "#D32F2F";
    case "off":
    case "unavailable":
      return "#757575";
    default:
      return "#757575";
  }
}

function toneBgColor(tone: string): string {
  switch (tone) {
    case "good":
      return "rgba(46,125,50,0.10)";
    case "limited":
    case "unverified":
      return "rgba(230,138,0,0.10)";
    case "action":
      return "rgba(211,47,47,0.10)";
    default:
      return "rgba(117,117,117,0.08)";
  }
}

/** User-friendly status label for the category card badge */
function displayStatus(tone: string): string {
  switch (tone) {
    case "good":
      return "All good";
    case "neutral":
      return "All good";
    case "limited":
      return "Limited";
    case "unverified":
      return "Limited";
    case "action":
      return "Attention";
    case "off":
      return "Off";
    case "unavailable":
      return "Not available";
    default:
      return "Unknown";
  }
}

function buildHeroText(areas: ProtectionArea[], checking: boolean) {
  if (checking) {
    return {
      title: "Checking protection...",
      lines: ["Apollo is checking the current state of your protection."],
    };
  }

  const good = areas.filter(
    (a) => a.summaryTone === "good" || a.summaryTone === "neutral"
  );
  const limited = areas.filter(
    (a) => a.summaryTone === "limited" || a.summaryTone === "unverified"
  );
  const attention = areas.filter((a) => a.summaryTone === "action");
  const unavailable = areas.filter(
    (a) => a.summaryTone === "unavailable" || a.summaryTone === "off"
  );
  const total = areas.length;

  const lines: string[] = [];

  if (attention.length > 0) {
    lines.push(
      `${attention.length} ${attention.length === 1 ? "category needs" : "categories need"} attention.`
    );
  }

  if (good.length > 0) {
    lines.push(
      `${good.length} of ${total} ${good.length === 1 ? "category is" : "categories are"} all good.`
    );
  }

  if (limited.length > 0) {
    lines.push(
      `${limited.length} ${limited.length === 1 ? "category has" : "categories have"} limited coverage.`
    );
  }

  if (unavailable.length > 0) {
    lines.push(
      `${unavailable.length} ${unavailable.length === 1 ? "category is" : "categories are"} not available on this device.`
    );
  }

  lines.push("Apollo is watching, so you can get on with what matters.");

  let title = "You're well protected";
  if (attention.length > 0) {
    title = "Some protection needs attention";
  } else if (limited.length > 0 && good.length === 0) {
    title = "Protection is limited";
  } else if (unavailable.length > 0 && good.length > 0) {
    title = "You're well protected";
  } else if (unavailable.length === total) {
    title = "Protection not available";
  }

  return { title, lines };
}

// ── Category Card Component ─────────────────────────────────────────────────

function CategoryCard({ area }: { area: ProtectionArea }) {
  const { colors } = useTheme();
  const router = useRouter();
  const Icon = AREA_ICONS[area.id];
  const tone = area.summaryTone;
  const color = toneColor(tone);
  const bgColor = toneBgColor(tone);
  const isGood = tone === "good" || tone === "neutral";
  const isWarning = tone === "limited" || tone === "unverified";
  const gateCount = area.capabilities.length;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${area.title}: ${displayStatus(tone)}`}
      testID={`protection-area-${area.id}`}
      onPress={() =>
        router.push(`/protection-details?category=${area.id}` as never)
      }
      style={({ pressed }) => [
        styles.categoryCard,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      {/* Icon */}
      <View
        style={[
          styles.categoryIconWell,
          { backgroundColor: colors.surfaceTertiary },
        ]}
      >
        <Icon size={24} color={colors.brand} />
      </View>

      {/* Text content */}
      <View style={styles.categoryTextBlock}>
        <View style={styles.categoryTitleRow}>
          <Text
            style={[styles.categoryTitle, { color: colors.onSurface }]}
            numberOfLines={1}
          >
            {area.title}
          </Text>
          <Text
            style={[
              styles.categoryGateCount,
              { color: colors.onSurfaceSecondary },
            ]}
          >
            {gateCount} {gateCount === 1 ? "Gate" : "Gates"}
          </Text>
        </View>
        <Text
          style={[
            styles.categoryDescription,
            { color: colors.onSurfaceSecondary },
          ]}
          numberOfLines={3}
        >
          {area.description}
        </Text>
        {/* Status badge */}
        <View style={[styles.statusBadge, { backgroundColor: bgColor }]}>
          {isGood ? (
            <CircleCheck size={14} color={color} />
          ) : isWarning ? (
            <CircleAlert size={14} color={color} />
          ) : (
            <View
              style={[styles.statusDot, { backgroundColor: color }]}
            />
          )}
          <Text style={[styles.statusText, { color }]}>
            {displayStatus(tone)}
          </Text>
        </View>
      </View>

      {/* Chevron */}
      <View style={styles.categoryChevron}>
        <ChevronRight size={20} color={colors.muted} />
      </View>
    </Pressable>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function ProtectionScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const health = useProtectionHealth();

  const areas = useMemo(
    () => (health.checking ? [] : buildProtectionAreas(health.gates)),
    [health.checking, health.gates]
  );

  const { title: heroTitle, lines: heroLines } = useMemo(
    () => buildHeroText(areas, health.checking),
    [areas, health.checking]
  );

  const hasAttention = areas.some((a) => a.summaryTone === "action");

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]} testID="protection-screen">
      {/* ── Header ── */}
      <View style={{ paddingTop: insets.top + spacing.sm }}>
        {/* Top row: branding + actions */}
        <View style={styles.headerRow}>
          <View style={styles.brandingRow}>
            <Image
              source={logoImage}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={[styles.brandText, { color: colors.onSurface }]}>
              Apollo Scam Guard
            </Text>
          </View>
          <View style={styles.headerActions}>
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
              style={({ pressed }) => [
                styles.headerIconBtn,
                {
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.border,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Settings size={22} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>
        {/* Title */}
        <View style={styles.titleRow}>
          <Text style={[styles.pageTitle, { color: colors.onSurface }]}>
            Protection.
          </Text>
        </View>
      </View>

      <ScrollView
        testID="protection-scroll"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 90 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Subtitle */}
        <Text style={[styles.subtitle, { color: colors.onSurfaceSecondary }]}>
          See your protection categories and the Gates inside each one.
        </Text>

        {/* ── Hero card with background image ── */}
        <View style={styles.heroContainer} testID="protection-hero-card">
          <ImageBackground
            source={heroBackground}
            style={styles.heroImageBg}
            imageStyle={styles.heroImageStyle}
            resizeMode="cover"
          >
            {/* Semi-transparent overlay for text readability */}
            <View style={styles.heroOverlay}>
              <View style={styles.heroContent}>
                {/* Shield + status text */}
                <View style={styles.heroLeftBlock}>
                  <View
                    style={[
                      styles.heroShieldCircle,
                      {
                        backgroundColor: hasAttention
                          ? "rgba(229,162,26,0.25)"
                          : "rgba(79,175,131,0.30)",
                      },
                    ]}
                  >
                    <ShieldCheck
                      size={32}
                      color={hasAttention ? "#E5A21A" : "#FFFFFF"}
                    />
                  </View>
                  <Text style={styles.heroTitle}>{heroTitle}</Text>
                  {heroLines.map((line, i) => (
                    <Text key={i} style={styles.heroLine}>
                      {line}
                    </Text>
                  ))}
                </View>
              </View>
            </View>
          </ImageBackground>
        </View>

        {/* ── Protection Categories section header ── */}
        <View style={styles.sectionHeader}>
          <Text
            style={[styles.sectionTitle, { color: colors.onSurface }]}
          >
            Protection categories
          </Text>
          <Text
            style={[
              styles.sectionSubtitle,
              { color: colors.onSurfaceSecondary },
            ]}
          >
            Tap a category to see what it does and the Gates inside.
          </Text>
        </View>

        {/* ── Category list ── */}
        <View style={styles.categoryList}>
          {areas.map((area) => (
            <CategoryCard key={area.id} area={area} />
          ))}
        </View>

        {/* ── Bottom guidance card ── */}
        <View
          style={[
            styles.guidanceCard,
            { backgroundColor: colors.surfaceTertiary },
          ]}
          testID="protection-higgins-guidance"
        >
          <View style={styles.guidanceTopRow}>
            <View style={styles.guidanceAvatarWrap}>
              <Image source={higginsAvatar} style={styles.guidanceAvatar} />
            </View>
            <View style={styles.guidanceTextBlock}>
              <Text
                style={[styles.guidanceTitle, { color: colors.onSurface }]}
              >
                Apollo is here to protect.
              </Text>
              <Text
                style={[
                  styles.guidanceBody,
                  { color: colors.onSurfaceSecondary },
                ]}
              >
                Ask Higgins how your protection works and what the Gates do.
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Learn more about protection"
            testID="protection-learn-more"
            onPress={() => router.push("/(tabs)/ask" as never)}
            style={({ pressed }) => [
              styles.learnBtn,
              {
                backgroundColor: colors.gold,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Text style={[styles.learnBtnText, { color: colors.onBrand }]}>
              Learn more
            </Text>
            <ChevronRight size={16} color={colors.onBrand} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  brandingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  logoImage: {
    width: 28,
    height: 28,
  },
  brandText: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    lineHeight: 18,
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
    borderWidth: 1,
  },
  titleRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  pageTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 30,
    lineHeight: 36,
  },

  // Scroll content
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  subtitle: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
  },

  // Hero card
  heroContainer: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  heroImageBg: {
    width: "100%",
    minHeight: 220,
    justifyContent: "flex-end",
  },
  heroImageStyle: {
    borderRadius: radius.lg,
  },
  heroOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "flex-end",
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  heroContent: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  heroLeftBlock: {
    flex: 1,
    gap: 4,
  },
  heroShieldCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    lineHeight: 28,
    color: "#FFFFFF",
  },
  heroLine: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,255,255,0.88)",
  },

  // Section header
  sectionHeader: {
    gap: 4,
  },
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 26,
  },
  sectionSubtitle: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
  },

  // Category list
  categoryList: {
    gap: spacing.md,
  },
  categoryCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
    minHeight: 100,
  },
  categoryIconWell: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  categoryTextBlock: {
    flex: 1,
    gap: 4,
  },
  categoryTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  categoryTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    lineHeight: 22,
  },
  categoryGateCount: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 17,
  },
  categoryDescription: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    lineHeight: 17,
  },
  categoryChevron: {
    paddingTop: 14,
    flexShrink: 0,
  },

  // Bottom guidance card
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
    fontSize: 15,
    lineHeight: 20,
  },
  guidanceBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
  },
  learnBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    alignSelf: "flex-end",
    minHeight: 44,
  },
  learnBtnText: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
  },
});
