// Learn tab — renders the existing Learn with Higgins library as a tab root.
// The standalone route at /higgins/learning continues to work for deep links.
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CreditCard from "lucide-react-native/icons/credit-card";
import MessageSquare from "lucide-react-native/icons/message-square";
import Search from "lucide-react-native/icons/search";
import ShoppingBag from "lucide-react-native/icons/shopping-bag";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import UserRound from "lucide-react-native/icons/user-round";
import ArrowUpDown from "lucide-react-native/icons/arrow-up-down";
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

import { Button } from "@/src/components/ui";
import { learningArticles, type LearningArticleSummary } from "@/src/higgins/hubClient";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { AlertsButton } from "@/src/components/AlertsButton";

// Re-use the same assets and helpers from the learning screen
const higginsHeadshot = require("@/assets/images/higgins-avatar.png");
const learningHeroBg = require("@/assets/images/learning-hero-bg.png");

interface TopicTile {
  label: string; description: string; bg: string; iconColor: string;
  icon: React.ComponentType<{ size?: number; color?: string }>; category: string;
}
const TOPIC_TILES: TopicTile[] = [
  { label: "Messages & Calls", description: "Spot fake messages and phone scams.", bg: "#E8F4FD", iconColor: "#2D7DD2", icon: MessageSquare, category: "messaging" },
  { label: "Banking & Payments", description: "Keep your money safer.", bg: "#E8F8F0", iconColor: "#27AE60", icon: CreditCard, category: "banking" },
  { label: "Identity & Accounts", description: "Protect your personal information.", bg: "#F0E8F8", iconColor: "#8E44AD", icon: UserRound, category: "identity" },
  { label: "Online Shopping", description: "Shop safely and avoid fake websites.", bg: "#FDF0E8", iconColor: "#E67E22", icon: ShoppingBag, category: "shopping" },
];

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

function estimateReadingTime(article: LearningArticleSummary): string {
  const words = (article.summary || "").split(/\s+/).length;
  return `${Math.max(3, Math.round(words / 40))} min read`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function thumbnailColor(category: string): string {
  return ({ messaging: "#E8F4FD", banking: "#E8F8F0", identity: "#F0E8F8", shopping: "#FDF0E8" } as Record<string, string>)[category?.toLowerCase()] ?? "#EDF2F7";
}
function thumbnailIconColor(category: string): string {
  return ({ messaging: "#2D7DD2", banking: "#27AE60", identity: "#8E44AD", shopping: "#E67E22" } as Record<string, string>)[category?.toLowerCase()] ?? "#718096";
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  heroCard: { marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: "hidden", minHeight: 120 },
  heroImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.lg },
  heroOverlay: { padding: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },
  heroAvatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: "#FFFFFF" },
  heroTextWrap: { flex: 1 },
  heroTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: "#FFFFFF", marginBottom: 2 },
  heroSub: { fontFamily: fonts.text, fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 18 },
  searchRow: { marginHorizontal: spacing.lg, marginTop: spacing.sm, flexDirection: "row", alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, paddingHorizontal: spacing.md, height: 44 },
  searchInput: { flex: 1, fontFamily: fonts.text, fontSize: 14, color: c.onSurface, marginLeft: spacing.sm, paddingVertical: 0 },
  topicScroll: { paddingLeft: spacing.lg, paddingRight: spacing.sm, marginTop: spacing.md },
  topicTile: { width: 150, borderRadius: radius.md, padding: spacing.md, marginRight: spacing.sm },
  topicLabel: { fontFamily: fonts.textSemibold, fontSize: 13, color: "#1A202C", marginTop: spacing.sm },
  topicDesc: { fontFamily: fonts.text, fontSize: 11, color: "#4A5568", marginTop: 2 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  featuredCard: { marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: "hidden", borderWidth: 0.5, borderColor: c.border },
  featuredImage: { width: "100%", height: 160, backgroundColor: "#EDF2F7" },
  featuredContent: { padding: spacing.md, gap: spacing.xs },
  featuredTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  featuredSummary: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  articleRow: { flexDirection: "row", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 0.5, borderBottomColor: c.divider, alignItems: "center" },
  articleThumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: "#EDF2F7", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  articleContent: { flex: 1, gap: 2 },
  articleTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  articleMeta: { fontFamily: fonts.text, fontSize: 11, color: c.onSurfaceSecondary },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, alignSelf: "flex-start" },
  badgeText: { fontFamily: fonts.textSemibold, fontSize: 9, letterSpacing: 0.5 },
  filterPill: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, marginRight: spacing.sm },
  emptyText: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary, textAlign: "center", paddingVertical: spacing["2xl"], paddingHorizontal: spacing.lg },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "70%" },
  modalTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, marginBottom: spacing.md },
  modalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: c.divider },
  modalLabel: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  modalCheck: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
}));

export default function LearnTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const s = useStyles();

  const [articles, setArticles] = useState<LearningArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");
  const [showFilter, setShowFilter] = useState(false);
  const [backendFilters, setBackendFilters] = useState<Record<string, string[]>>({});

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const result = await learningArticles({ category: selectedCategory ?? undefined, search: searchQuery || undefined, sort: sortBy });
      setArticles(result?.articles ?? []);
      if (result?.filters) setBackendFilters(result.filters);
    } catch { /* no-op */ }
    setLoading(false);
  }, [selectedCategory, searchQuery, sortBy]);

  useEffect(() => { void fetchArticles(); }, [fetchArticles]);

  const featured = useMemo(() => (articles ?? []).find((a) => a.featured) ?? (articles ?? [])[0] ?? null, [articles]);
  const rest = useMemo(() => (articles ?? []).filter((a) => a !== featured), [articles, featured]);

  // ── Tab header (no back button — this is a tab root) ──
  const headerArea = (
    <View style={{ paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, height: 48 }}>
        <Text style={{ fontFamily: fonts.displayBold, fontSize: 20, color: colors.onSurface, flex: 1 }}>Learn with Higgins</Text>
        <AlertsButton testID="learn-alerts" />
      </View>
    </View>
  );

  const listHeader = (
    <View style={{ gap: spacing.sm }}>
      {/* Hero */}
      <View style={s.heroCard}>
        <Image source={learningHeroBg} style={s.heroImage} resizeMode="cover" />
        <View style={s.heroOverlay}>
          <Image source={higginsHeadshot} style={s.heroAvatar} />
          <View style={s.heroTextWrap}>
            <Text style={s.heroTitle}>Learn with Higgins</Text>
            <Text style={s.heroSub}>Practical lessons to help you stay safe from scams and online threats.</Text>
          </View>
        </View>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <Search size={16} color={colors.onSurfaceSecondary} />
        <TextInput
          style={s.searchInput}
          placeholder="Search topics…"
          placeholderTextColor={colors.onSurfaceSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={() => void fetchArticles()}
          returnKeyType="search"
          testID="learn-search"
        />
        {searchQuery ? <Pressable onPress={() => { setSearchQuery(""); }} hitSlop={8}><X size={16} color={colors.onSurfaceSecondary} /></Pressable> : null}
      </View>

      {/* Topic tiles */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.topicScroll}>
        {TOPIC_TILES.map((t) => (
          <Pressable
            key={t.category}
            onPress={() => setSelectedCategory(selectedCategory === t.category ? null : t.category)}
            style={[s.topicTile, { backgroundColor: t.bg, borderWidth: selectedCategory === t.category ? 2 : 0, borderColor: t.iconColor }]}
          >
            <t.icon size={20} color={t.iconColor} />
            <Text style={s.topicLabel}>{t.label}</Text>
            <Text style={s.topicDesc} numberOfLines={2}>{t.description}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Featured */}
      {featured ? (
        <View>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Featured</Text>
          </View>
          <Pressable style={s.featuredCard} onPress={() => router.push({ pathname: "/higgins/learning/[id]" as any, params: { id: featured.article_id } })} testID="learn-featured">
            <View style={[s.featuredImage, { backgroundColor: thumbnailColor(featured.category) }]}>
              {featured.thumbnail_url ? <Image source={{ uri: featured.thumbnail_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  {(() => { const TIcon = TOPIC_TILES.find((t) => t.category === featured.category)?.icon ?? MessageSquare; return <TIcon size={40} color={thumbnailIconColor(featured.category)} />; })()}
                </View>
              )}
            </View>
            <View style={s.featuredContent}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={[s.badge, { backgroundColor: getTypeBadge(featured.content_type).bg }]}>
                  <Text style={[s.badgeText, { color: getTypeBadge(featured.content_type).color }]}>{getTypeBadge(featured.content_type).label}</Text>
                </View>
                <Text style={s.articleMeta}>{estimateReadingTime(featured)}</Text>
              </View>
              <Text style={s.featuredTitle} numberOfLines={2}>{featured.title}</Text>
              <Text style={s.featuredSummary} numberOfLines={3}>{featured.summary}</Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      {/* Sort/Filter bar */}
      <View style={[s.sectionHeader, { marginTop: spacing.md }]}>
        <Text style={s.sectionTitle}>All articles</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable onPress={() => setSortBy(sortBy === "newest" ? "oldest" : "newest")} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <ArrowUpDown size={14} color={colors.onSurfaceSecondary} />
            <Text style={{ fontFamily: fonts.text, fontSize: 12, color: colors.onSurfaceSecondary }}>{sortBy === "newest" ? "Newest" : "Oldest"}</Text>
          </Pressable>
          <Pressable onPress={() => setShowFilter(true)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <SlidersHorizontal size={14} color={colors.onSurfaceSecondary} />
            <Text style={{ fontFamily: fonts.text, fontSize: 12, color: colors.onSurfaceSecondary }}>Filter</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderArticle = useCallback(({ item }: { item: LearningArticleSummary }) => {
    const badge = getTypeBadge(item.content_type);
    const TIcon = TOPIC_TILES.find((t) => t.category === item.category)?.icon ?? MessageSquare;
    return (
      <Pressable style={s.articleRow} onPress={() => router.push({ pathname: "/higgins/learning/[id]" as any, params: { id: item.article_id } })} testID={`learn-article-${item.article_id}`}>
        <View style={[s.articleThumb, { backgroundColor: thumbnailColor(item.category) }]}>
          {item.thumbnail_url ? <Image source={{ uri: item.thumbnail_url }} style={{ width: 72, height: 72 }} resizeMode="cover" /> : <TIcon size={28} color={thumbnailIconColor(item.category)} />}
        </View>
        <View style={s.articleContent}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <View style={[s.badge, { backgroundColor: badge.bg }]}><Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text></View>
            <Text style={s.articleMeta}>{estimateReadingTime(item)}</Text>
          </View>
          <Text style={s.articleTitle} numberOfLines={2}>{item.title}</Text>
          {item.published_at ? <Text style={s.articleMeta}>{formatDate(item.published_at)}</Text> : null}
        </View>
        <ChevronRight size={16} color={colors.onSurfaceSecondary} />
      </Pressable>
    );
  }, [s, colors, router]);

  return (
    <View style={s.root} testID="learn-tab">
      {headerArea}
      <FlatList
        data={rest}
        keyExtractor={(item) => item.article_id}
        renderItem={renderArticle}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={loading ? <ActivityIndicator style={{ paddingVertical: spacing["2xl"] }} /> : <Text style={s.emptyText}>No articles found. Try a different search or category.</Text>}
        showsVerticalScrollIndicator={false}
      />
      {/* Filter sheet */}
      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowFilter(false)}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Filter articles</Text>
            {(backendFilters.categories ?? TOPIC_TILES.map((t) => t.category)).map((cat) => (
              <Pressable key={cat} style={s.modalRow} onPress={() => { setSelectedCategory(selectedCategory === cat ? null : cat); setShowFilter(false); }}>
                <Text style={s.modalLabel}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</Text>
                <View style={[s.modalCheck, { borderColor: selectedCategory === cat ? colors.brand : colors.border, backgroundColor: selectedCategory === cat ? colors.brand : "transparent" }]} />
              </Pressable>
            ))}
            <Button label="Clear filter" variant="ghost" onPress={() => { setSelectedCategory(null); setShowFilter(false); }} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
