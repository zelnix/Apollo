// Protection Dashboard — matches the approved visual mockup exactly.
// Taller hero card with landscape background + dog overlay,
// 2-column category grid (first 4) + full-width last card,
// bottom guidance card. Uses 5 protection areas.

import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Globe from "lucide-react-native/icons/globe";
import Grid2x2 from "lucide-react-native/icons/grid-2x2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Smartphone from "lucide-react-native/icons/smartphone";
import React, { useMemo } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  buildProtectionAreas,
  type ProtectionArea,
  type ProtectionAreaId,
} from "@/src/domain/protectionAreas";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, radius, spacing, useTheme } from "@/src/theme";

// ── Assets ──────────────────────────────────────────────────────────────────
const heroBackground = require("@/assets/images/hero-bg-protection.png");
const apolloDog = require("@/assets/images/apollo-dog.png");
const higginsAvatar = require("@/assets/images/higgins-avatar.png");
const apolloLogo = require("@/assets/images/logo.png");

// ── Icon map ────────────────────────────────────────────────────────────────
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

// ── Per-category icon colours (from approved mockup) ────────────────────────
const AREA_ICON_COLORS: Record<
  ProtectionAreaId,
  { icon: string; well: string }
> = {
  websites_links: { icon: "#004AAD", well: "#EBF5FF" },
  messages_calls: { icon: "#2EAD8B", well: "#E0F9F3" },
  email_accounts: { icon: "#7F56D9", well: "#EDE7F6" },
  apps_files: { icon: "#E88A30", well: "#FEF2E6" },
  device_internet: { icon: "#7230DB", well: "#EDEAFA" },
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

function displayStatus(tone: string): string {
  switch (tone) {
    case "good":
    case "neutral":
      return "All good";
    case "limited":
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

  if (attention.length > 0) {
    lines.push(
      `${attention.length} ${attention.length === 1 ? "category needs" : "categories need"} attention.`
    );
  }

  if (unavailable.length > 0) {
    lines.push(
      `${unavailable.length} not available on this device.`
    );
  }

  lines.push("Apollo is watching, so you can get on with what matters.");

  let title = "You're well protected";
  if (attention.length > 0) {
    title = "Some protection needs attention";
  } else if (limited.length > 0 && good.length === 0) {
    title = "Protection is limited";
  } else if (unavailable.length === total) {
    title = "Protection not available";
  }

  return { title, lines };
}

// ── Grid Category Card (vertical layout for 2-col grid) ────────────────────

function GridCategoryCard({
  area,
  fullWidth,
  scale,
}: {
  area: ProtectionArea;
  fullWidth?: boolean;
  scale: number;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const Icon = AREA_ICONS[area.id];
  const iconColors = AREA_ICON_COLORS[area.id];
  const tone = area.summaryTone;
  const color = toneColor(tone);
  const bgColor = toneBgColor(tone);
  const isGood = tone === "good" || tone === "neutral";
  const isWarning = tone === "limited" || tone === "unverified";
  const gateCount = area.capabilities.length;

  const iconSize = Math.round(30 * scale);
  const iconInner = Math.round(16 * scale);
  const iconRadius = Math.round(9 * scale);
  const titleSize = Math.round(13 * scale);
  const descSize = Math.round(11.5 * scale);
  const badgeSize = Math.round(12 * scale);
  const cardPad = Math.round(12 * scale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${area.title}: ${displayStatus(tone)}`}
      testID={`protection-area-${area.id}`}
      onPress={() =>
        router.push(`/protection-details?category=${area.id}` as never)
      }
      style={({ pressed }) => [
        styles.gridCard,
        fullWidth && styles.gridCardFull,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
          opacity: pressed ? 0.82 : 1,
          padding: cardPad,
        },
      ]}
    >
      {/* Top row: Icon + Title */}
      <View style={styles.gridTopRow}>
        <View
          style={[
            styles.gridIconWell,
            {
              width: iconSize,
              height: iconSize,
              borderRadius: iconRadius,
              backgroundColor: iconColors.well,
            },
          ]}
        >
          <Icon size={iconInner} color={iconColors.icon} />
        </View>
        <View style={styles.gridTitleBlock}>
          <Text
            style={[
              styles.gridTitle,
              { color: colors.onSurface, fontSize: titleSize, lineHeight: titleSize + 5 },
            ]}
          >
            {area.title}
          </Text>
          <Text
            style={[
              styles.gridGateCount,
              { color: colors.onSurfaceSecondary, fontSize: descSize },
            ]}
          >
            {gateCount} {gateCount === 1 ? "Gate" : "Gates"}
          </Text>
        </View>
      </View>

      {/* Description */}
      <Text
        style={[
          styles.gridDescription,
          { color: colors.onSurfaceSecondary, fontSize: descSize, lineHeight: descSize + 5 },
        ]}
        numberOfLines={3}
      >
        {area.description}
      </Text>

      {/* Bottom row: status badge + chevron */}
      <View style={styles.gridBottomRow}>
        <View style={[styles.statusBadge, { backgroundColor: bgColor }]}>
          {isGood ? (
            <CircleCheck size={Math.round(14 * scale)} color={color} />
          ) : isWarning ? (
            <CircleAlert size={Math.round(14 * scale)} color={color} />
          ) : (
            <View style={[styles.statusDot, { backgroundColor: color }]} />
          )}
          <Text style={[styles.statusText, { color, fontSize: badgeSize }]}>
            {displayStatus(tone)}
          </Text>
        </View>
        <ChevronRight size={Math.round(18 * scale)} color={colors.muted} />
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
  const { width: screenWidth } = useWindowDimensions();

  const areas = useMemo(
    () => (health.checking ? [] : buildProtectionAreas(health.gates)),
    [health.checking, health.gates]
  );

  const { title: heroTitle, lines: heroLines } = useMemo(
    () => buildHeroText(areas, health.checking),
    [areas, health.checking]
  );

  // Split areas: first 4 in grid, last 1 full-width
  const gridAreas = areas.slice(0, 4);
  const lastArea = areas.length > 4 ? areas[areas.length - 1] : null;

  // ── Responsive scaling ──
  const cardWidth = screenWidth - spacing.lg * 2;
  const scale = Math.max(0.82, Math.min(1.15, cardWidth / 340));

  return (
    <View
      style={[styles.root, { backgroundColor: colors.surface }]}
      testID="protection-screen"
    >
      {/* ── Header ── */}
      <View style={{ paddingTop: insets.top + spacing.sm }}>
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="protection-back"
            onPress={() => goBackOrHome(router)}
            style={styles.backBtn}
          >
            <ChevronLeft size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.onSurface }]}>
            Protections
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
        <Text
          style={[styles.subtitle, { color: colors.onSurfaceSecondary }]}
        >
          See your protection categories and the Gates inside each one.
        </Text>

        {/* ── Hero card ── */}
        <View
          style={[
            styles.heroContainer,
            { height: Math.round(cardWidth * 0.38) },
          ]}
          testID="protection-hero-card"
        >
          {/* Background image — fills container, always fully visible */}
          <Image
            source={heroBackground}
            style={styles.heroBgImage}
            resizeMode="cover"
          />
          {/* Text overlay at bottom-left */}
          <View style={[styles.heroOverlay, { padding: Math.round(12 * scale) }]}>
            <View style={styles.heroTextBlock}>
              <Text
                style={[
                  styles.heroTitle,
                  {
                    fontSize: Math.round(17 * scale),
                    lineHeight: Math.round(22 * scale),
                  },
                ]}
                numberOfLines={2}
              >
                {heroTitle}
              </Text>
              {heroLines.map((line, i) => (
                <Text
                  key={i}
                  style={[
                    styles.heroLine,
                    {
                      fontSize: Math.round(13 * scale),
                      lineHeight: Math.round(18 * scale),
                    },
                  ]}
                >
                  {line}
                </Text>
              ))}
            </View>
          </View>
          {/* Apollo dog — bottom-right, no background */}
          <Image
            source={apolloDog}
            style={styles.heroDogImage}
            resizeMode="contain"
          />
        </View>

        {/* ── Section header ── */}
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

        {/* ── 2-column grid (first 4 categories) ── */}
        <View style={styles.categoryGrid}>
          {gridAreas.map((area) => (
            <GridCategoryCard key={area.id} area={area} scale={scale} />
          ))}
        </View>

        {/* ── Last category full-width ── */}
        {lastArea && (
          <View style={styles.lastCardWrap}>
            <GridCategoryCard area={lastArea} fullWidth scale={scale} />
          </View>
        )}

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
              <Image
                source={higginsAvatar}
                style={styles.guidanceAvatar}
              />
            </View>
            <View style={styles.guidanceTextBlock}>
              <Text
                style={[
                  styles.guidanceTitle,
                  { color: colors.onSurface },
                ]}
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
  headerLogo: {
    width: 32,
    height: 32,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.displayBold,
    fontSize: 26,
    lineHeight: 32,
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

  // ── Hero card ──
  heroContainer: {
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "#FBFEFC",
  },
  heroBgImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    opacity: 0.7,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  heroTextBlock: {
    maxWidth: "60%",
    gap: 2,
  },
  heroDogImage: {
    position: "absolute",
    right: "14%",
    bottom: 0,
    width: "18%",
    height: "70%",
  },
  heroTitle: {
    fontFamily: fonts.displayBold,
    color: "#1B6B47",
    letterSpacing: -0.2,
  },
  heroLine: {
    fontFamily: fonts.text,
    color: "#0B1220",
  },

  // ── Section header ──
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

  // ── 2-column grid ──
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  gridCard: {
    width: "48.5%",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 5,
    flexGrow: 0,
    flexShrink: 0,
  },
  gridCardFull: {
    width: "100%",
  },
  lastCardWrap: {
    marginTop: -spacing.sm,
  },
  gridTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  gridIconWell: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  gridTitleBlock: {
    flex: 1,
    gap: 1,
  },
  gridTitle: {
    fontFamily: fonts.displayBold,
  },
  gridGateCount: {
    fontFamily: fonts.text,
  },
  gridDescription: {
    fontFamily: fonts.text,
    flex: 1,
  },
  gridBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: fonts.textSemibold,
  },

  // ── Bottom guidance card ──
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
