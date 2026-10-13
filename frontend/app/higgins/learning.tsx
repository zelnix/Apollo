// Learn with Higgins — Learning Library.
// Redesigned to match the approved mock-up with hero section, search,
// topic tiles, featured learning, all articles list, and filter bottom sheet.

import { useRouter } from "expo-router";
import ArrowUpDown from "lucide-react-native/icons/arrow-up-down";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Clock from "lucide-react-native/icons/clock";
import Calendar from "lucide-react-native/icons/calendar";
import CreditCard from "lucide-react-native/icons/credit-card";
import MessageSquare from "lucide-react-native/icons/message-square";
import Search from "lucide-react-native/icons/search";
import ShoppingBag from "lucide-react-native/icons/shopping-bag";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import UserRound from "lucide-react-native/icons/user-round";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button } from "@/src/components/ui";
import { learningArticles, type LearningArticleSummary } from "@/src/higgins/hubClient";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const higginsHeadshot = require("@/assets/images/higgins-avatar.png");

// ── Topic tile definitions ──────────────────────────────────────────────────
interface TopicTile {
  label: string;
  description: string;
  bg: string;
  iconColor: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  category: string; // maps to backend category filter
}

const TOPIC_TILES: TopicTile[] = [
  { label: "Messages & Calls", description: "Spot fake messages and phone scams.", bg: "#E8F4FD", iconColor: "#2D7DD2", icon: MessageSquare, category: "messaging" },
  { label: "Banking & Payments", description: "Keep your money safer.", bg: "#E8F8F0", iconColor: "#27AE60", icon: CreditCard, category: "banking" },
  { label: "Identity & Accounts", description: "Protect your personal information.", bg: "#F0E8F8", iconColor: "#8E44AD", icon: UserRound, category: "identity" },
  { label: "Online Shopping", description: "Shop safely and avoid fake websites.", bg: "#FDF0E8", iconColor: "#E67E22", icon: ShoppingBag, category: "shopping" },
];

// ── Content type badge colour mapping ───────────────────────────────────────
const TYPE_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  guide: { bg: "#E8F4FD", color: "#2D7DD2", label: "GUIDE" },
  tips: { bg: "#E8F8F0", color: "#27AE60", label: "TIPS" },
  news: { bg: "#FDF0E8", color: "#E67E22", label: "NEWS" },
  long_read: { bg: "#F0E8F8", color: "#8E44AD", label: "LONG READ" },
};
function getTypeBadge(contentType: string) {
  const key = contentType.toLowerCase().replace(/[\s_]+/g, "_");
  return TYPE_BADGE[key] ?? { bg: "#EEE", color: "#666", label: contentType.replace(/_/g, " ").toUpperCase() };
}

// ── Reading time estimate ───────────────────────────────────────────────────
function estimateReadingTime(article: LearningArticleSummary): string {
  // Rough estimate from summary length; backend doesn't provide word count
  const words = (article.summary || "").split(/\s+/).length;
  const minutes = Math.max(3, Math.round(words / 40)); // rough heuristic
  return `${minutes} min read`;
}

// ── Date formatting ─────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ── Category icon for article thumbnail placeholder ─────────────────────────
function thumbnailColor(category: string): string {
  const map: Record<string, string> = { messaging: "#E8F4FD", banking: "#E8F8F0", identity: "#F0E8F8", shopping: "#FDF0E8" };
  return map[category?.toLowerCase()] ?? "#EDF2F7";
}
function thumbnailIconColor(category: string): string {
  const map: Record<string, string> = { messaging: "#2D7DD2", banking: "#27AE60", identity: "#8E44AD", shopping: "#E67E22" };
  return map[category?.toLowerCase()] ?? "#718096";
}

// ── Styles ──────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Hero
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  heroText: { flex: 1, gap: spacing.xs },
  heroTitle: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 24, color: c.onSurface, flex: 1 },
  heroSub: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  heroImgWrap: { width: 120, height: 130, overflow: "hidden" },
  heroImg: { width: 120, height: 130 },
  heroQuote: {
    fontFamily: fonts.text,
    fontSize: 13,
    fontStyle: "italic",
    color: c.brand,
    textAlign: "right",
    paddingRight: spacing.lg,
    paddingBottom: spacing.xs,
  },

  // Search row
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: c.surfaceSecondary,
  },
  searchInput: { flex: 1, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.brand,
    minHeight: 48,
  },
  filterBtnText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  filterBadge: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: c.brand,
  },
  filterBadgeText: { fontFamily: fonts.textSemibold, fontSize: 11, color: c.onBrand },

  // Section headings
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface },
  seeAll: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },

  // Topic tiles
  topicScroll: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  topicTile: {
    width: 130,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    gap: spacing.sm,
  },
  topicIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  topicLabel: { fontFamily: fonts.displayBold, fontSize: 13, textAlign: "center", color: "#1A2744" },
  topicDesc: { fontFamily: fonts.text, fontSize: 11, lineHeight: 15, textAlign: "center", color: "#4A5568" },

  // Featured card
  featuredCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    overflow: "hidden",
  },
  featuredRow: { flexDirection: "row" },
  featuredThumb: {
    width: 130,
    minHeight: 140,
    borderRadius: radius.md,
    margin: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  featuredContent: { flex: 1, padding: spacing.sm, gap: 4 },
  featuredTitle: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 21, color: c.onSurface },
  featuredDesc: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  featuredMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", paddingTop: 4 },
  metaText: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  metaIcon: { marginRight: 2 },

  // Article rows
  articleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    alignItems: "center",
  },
  articleThumb: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  articleContent: { flex: 1, gap: 3 },
  articleBadgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontFamily: fonts.textSemibold, fontSize: 11 },
  articleTitle: { fontFamily: fonts.displayBold, fontSize: 15, lineHeight: 20, color: c.onSurface },
  articleDesc: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },

  // Sort button
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.border,
  },
  sortText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurfaceSecondary },

  // Filter modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "80%",
    paddingTop: spacing.md,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: c.border,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  modalTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface },
  modalCloseBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceTertiary },
  modalGroup: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  modalGroupLabel: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurfaceSecondary },
  modalChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  modalChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  modalChipText: { fontFamily: fonts.textSemibold, fontSize: 13 },
  modalFooter: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },

  // Empty / loading
  centerWrap: { alignItems: "center", justifyContent: "center", paddingVertical: spacing["2xl"] },
}));

// ── Topic Tile Component ────────────────────────────────────────────────────
function TopicTileCard({ tile, onPress }: { tile: TopicTile; onPress: () => void }) {
  const s = useStyles();
  const Icon = tile.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tile.label}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}
    >
      <View style={[s.topicTile, { backgroundColor: tile.bg }]}>
        <View style={[s.topicIcon, { backgroundColor: "rgba(255,255,255,0.7)" }]}>
          <Icon size={24} color={tile.iconColor} />
        </View>
        <Text style={s.topicLabel}>{tile.label}</Text>
        <Text style={s.topicDesc}>{tile.description}</Text>
      </View>
    </Pressable>
  );
}

// ── Article Thumbnail Placeholder ───────────────────────────────────────────
function ArticleThumb({ category, size }: { category: string; size: number }) {
  const bg = thumbnailColor(category);
  const iconColor = thumbnailIconColor(category);
  const Icon = TOPIC_TILES.find((t) => t.category === category?.toLowerCase())?.icon ?? MessageSquare;
  return (
    <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Icon size={size * 0.35} color={iconColor} />
    </View>
  );
}

// ── Featured Article Card ───────────────────────────────────────────────────
function FeaturedCard({ article, onPress }: { article: LearningArticleSummary; onPress: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const badge = getTypeBadge(article.contentType);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={article.title}
      testID={`featured-article-${article.slug}`}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}
    >
      <View style={s.featuredCard}>
        <View style={s.featuredRow}>
          <View style={[s.featuredThumb, { backgroundColor: thumbnailColor(article.category) }]}>
            <ArticleThumb category={article.category} size={110} />
          </View>
          <View style={s.featuredContent}>
            <View style={[s.badge, { backgroundColor: badge.bg, alignSelf: "flex-start" }]}>
              <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
            </View>
            <Text style={s.featuredTitle} numberOfLines={3}>{article.title}</Text>
            <Text style={s.featuredDesc} numberOfLines={3}>{article.summary}</Text>
            <View style={s.featuredMeta}>
              <Clock size={14} color={colors.muted} />
              <Text style={s.metaText}>{estimateReadingTime(article)}</Text>
              <Calendar size={14} color={colors.muted} />
              <Text style={s.metaText}>Updated {formatDate(article.updatedAt)}</Text>
            </View>
          </View>
          <ChevronRight size={18} color={colors.onSurfaceSecondary} style={{ alignSelf: "center", marginRight: spacing.sm }} />
        </View>
      </View>
    </Pressable>
  );
}

// ── Article Row ─────────────────────────────────────────────────────────────
function ArticleRow({ article, onPress }: { article: LearningArticleSummary; onPress: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const badge = getTypeBadge(article.contentType);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={article.title}
      testID={`article-row-${article.slug}`}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}
    >
      <View style={s.articleRow}>
        <ArticleThumb category={article.category} size={80} />
        <View style={s.articleContent}>
          <View style={s.articleBadgeRow}>
            <View style={[s.badge, { backgroundColor: badge.bg }]}>
              <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
            </View>
            <Clock size={12} color={colors.muted} />
            <Text style={s.metaText}>{estimateReadingTime(article)}</Text>
          </View>
          <Text style={s.articleTitle} numberOfLines={2}>{article.title}</Text>
          <Text style={s.articleDesc} numberOfLines={2}>{article.summary}</Text>
        </View>
        <ChevronRight size={18} color={colors.onSurfaceSecondary} />
      </View>
    </Pressable>
  );
}

// ── Filter Bottom Sheet ─────────────────────────────────────────────────────
function FilterSheet({
  visible,
  onClose,
  filters,
  applied,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  filters: Record<string, string[]>;
  applied: Record<string, string>;
  onApply: (f: Record<string, string>) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(applied);

  useEffect(() => { if (visible) setDraft(applied); }, [visible, applied]);

  const groups: { key: string; filterKey: string; label: string }[] = [
    { key: "category", filterKey: "category", label: "Topic" },
    { key: "audience", filterKey: "audience", label: "Audience" },
    { key: "risk_context", filterKey: "risk_context", label: "Risk context" },
    { key: "content_type", filterKey: "content_type", label: "Article type" },
  ];

  const activeCount = Object.values(draft).filter(Boolean).length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.modalOverlay} onPress={onClose}>
        <Pressable style={[s.modalSheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
          <View style={s.modalHandle} />
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Filter lessons</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.modalCloseBtn}>
              <X size={20} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView>
            {groups.map((g) => {
              const items = filters[g.key] ?? [];
              if (!items.length) return null;
              return (
                <View key={g.key} style={s.modalGroup}>
                  <Text style={s.modalGroupLabel}>{g.label}</Text>
                  <View style={s.modalChips}>
                    {items.map((item) => {
                      const active = draft[g.filterKey] === item;
                      return (
                        <Pressable
                          key={item}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => setDraft((prev) => ({ ...prev, [g.filterKey]: active ? "" : item }))}
                          style={[s.modalChip, { backgroundColor: active ? colors.brand : "transparent", borderColor: active ? colors.brand : colors.border }]}
                        >
                          <Text style={[s.modalChipText, { color: active ? colors.onBrand : colors.onSurfaceSecondary }]}>
                            {item.replaceAll("_", " ")}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={s.modalFooter}>
            <Button
              variant="secondary"
              label="Clear all"
              testID="filter-clear"
              onPress={() => setDraft({ category: "", audience: "", risk_context: "", content_type: "" })}
            />
            <Button
              label={activeCount > 0 ? `Show lessons (${activeCount})` : "Show lessons"}
              testID="filter-apply"
              onPress={() => { onApply(draft); onClose(); }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────
export default function HigginsLearningScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [items, setItems] = useState<LearningArticleSummary[]>([]);
  const [backendFilters, setBackendFilters] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({});
  const [sortNewest, setSortNewest] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    void learningArticles({
      category: appliedFilters.category || undefined,
      audience: appliedFilters.audience || undefined,
      riskContext: appliedFilters.risk_context || undefined,
      contentType: appliedFilters.content_type || undefined,
      search: search || undefined,
      language: "en-AU",
    })
      .then((result) => {
        setItems(result.items);
        setBackendFilters(result.filters);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [appliedFilters, search]);

  useEffect(() => { load(); }, [load]);

  const filterCount = useMemo(
    () => Object.values(appliedFilters).filter(Boolean).length,
    [appliedFilters],
  );

  // Sort articles
  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const da = new Date(a.updatedAt || a.publishedAt).getTime();
      const db = new Date(b.updatedAt || b.publishedAt).getTime();
      return sortNewest ? db - da : da - db;
    });
    return copy;
  }, [items, sortNewest]);

  const featured = sortedItems[0] ?? null;
  const allArticles = sortedItems;

  const openArticle = useCallback(
    (slug: string) => router.push({ pathname: "/higgins/learning/[slug]", params: { slug } }),
    [router],
  );

  const applyTopicFilter = useCallback(
    (category: string) => {
      setAppliedFilters((prev) => ({ ...prev, category }));
    },
    [],
  );

  // ── Header area (back button + title) ──
  const headerArea = (
    <View style={{ paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="learning-back"
          onPress={() => goBackOrHome(router)}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <ChevronLeft size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={s.heroTitle}>Learn with Higgins</Text>
      </View>
    </View>
  );

  // ── List header (hero + search + topics + featured) ──
  const listHeader = (
    <View style={{ gap: spacing.sm }}>
      {/* Hero */}
      <View style={s.heroRow}>
        <View style={s.heroText}>
          <Text style={s.heroSub}>
            Practical guidance to help you recognise scams and stay safer online.
          </Text>
        </View>
        <View style={s.heroImgWrap}>
          <Image source={higginsHeadshot} style={s.heroImg} resizeMode="contain" />
        </View>
      </View>
      <Text style={s.heroQuote}>A little knowledge keeps you{"\n"}one step ahead. — Higgins</Text>

      {/* Search + Filters */}
      <View style={s.searchRow}>
        <View style={s.searchBar}>
          <Search size={20} color={colors.muted} />
          <TextInput
            testID="learning-search"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={load}
            placeholder="Search learning topics..."
            placeholderTextColor={colors.muted}
            style={s.searchInput}
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => { setSearch(""); }} hitSlop={8}>
              <X size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filters"
          testID="learning-filters-btn"
          onPress={() => setFilterVisible(true)}
          style={s.filterBtn}
        >
          <SlidersHorizontal size={16} color={colors.brand} />
          <Text style={s.filterBtnText}>Filters</Text>
          {filterCount > 0 ? (
            <View style={s.filterBadge}>
              <Text style={s.filterBadgeText}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* Explore Topics */}
      <View style={s.sectionRow}>
        <Text style={s.sectionTitle}>Explore topics</Text>
        <Pressable onPress={() => {}} hitSlop={8}>
          <Text style={s.seeAll}>See all</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.topicScroll}>
        {TOPIC_TILES.map((tile) => (
          <TopicTileCard key={tile.label} tile={tile} onPress={() => applyTopicFilter(tile.category)} />
        ))}
      </ScrollView>

      {/* Featured Learning */}
      {featured ? (
        <>
          <View style={s.sectionRow}>
            <Text style={s.sectionTitle}>Featured learning</Text>
          </View>
          <FeaturedCard article={featured} onPress={() => openArticle(featured.slug)} />
        </>
      ) : null}

      {/* All Articles heading */}
      <View style={s.sectionRow}>
        <Text style={s.sectionTitle}>All articles</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sortNewest ? "Most recent" : "Oldest first"}
          testID="learning-sort"
          onPress={() => setSortNewest((v) => !v)}
          style={s.sortBtn}
        >
          <Text style={s.sortText}>{sortNewest ? "Most recent" : "Oldest first"}</Text>
          <ArrowUpDown size={14} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={s.root} testID="learning-library-screen">
      {headerArea}

      <FlatList
        testID="learning-article-list"
        data={allArticles}
        keyExtractor={(item) => item.slug}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          <ArticleRow article={item} onPress={() => openArticle(item.slug)} />
        )}
        ListEmptyComponent={
          <View style={s.centerWrap}>
            {loading ? (
              <ActivityIndicator testID="learning-loading" color={colors.brand} />
            ) : error ? (
              <View style={{ alignItems: "center", gap: spacing.sm }}>
                <Body>Learning could not be loaded.</Body>
                <Button testID="learning-retry" label="Try again" onPress={load} />
              </View>
            ) : (
              <Body>No published articles match this view.</Body>
            )}
          </View>
        }
      />

      {/* Filter bottom sheet */}
      <FilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        filters={backendFilters}
        applied={appliedFilters}
        onApply={setAppliedFilters}
      />
    </View>
  );
}
