// Learn with Higgins — Full Article Reading Screen.
// Article header, structured content sections and share functionality.

import * as Linking from "expo-linking";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import Calendar from "lucide-react-native/icons/calendar";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import Clock from "lucide-react-native/icons/clock";
import Share2 from "lucide-react-native/icons/share-2";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppMenuButton } from "@/src/components/AppMenu";

import { Body, Button, Card } from "@/src/components/ui";
import { learningArticle, type LearningArticle, type LearningSection } from "@/src/higgins/hubClient";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";


// ── Type badge colours ──────────────────────────────────────────────────────
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

// ── Reading time estimate from full article ─────────────────────────────────
function estimateReadingTime(article: LearningArticle): string {
  let words = (article.summary || "").split(/\s+/).length;
  for (const s of article.sections) {
    words += s.paragraphs.join(" ").split(/\s+/).length;
    words += s.bullets.join(" ").split(/\s+/).length;
  }
  const minutes = Math.max(3, Math.round(words / 200));
  return `${minutes} min read`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ── Styles ──────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { gap: spacing.lg },

  // Header: same layout as the Scam Alert screen
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: c.surface },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface },
  headerBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  headerActions: { flexDirection: "row", alignItems: "center" },

  // Meta
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontFamily: fonts.textSemibold, fontSize: 11 },
  metaText: { fontFamily: fonts.text, fontSize: 12, color: c.muted },

  titleArea: { paddingHorizontal: spacing.lg, gap: spacing.xs },
  articleTitle: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 32, color: c.onSurface },
  articleSummary: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
  higginsQuote: {
    fontFamily: fonts.text,
    fontSize: 12,
    fontStyle: "italic",
    color: c.brand,
    textAlign: "right",
    paddingRight: spacing.lg,
    paddingBottom: spacing.xs,
  },

  // Section headings
  sectionHeading: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    lineHeight: 28,
    color: c.onSurface,
    paddingHorizontal: spacing.lg,
  },
  sectionBody: {
    fontFamily: fonts.text,
    fontSize: 16,
    lineHeight: 24,
    color: c.onSurfaceSecondary,
    paddingHorizontal: spacing.lg,
  },

  // Warning signs card
  warningCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    padding: spacing.md,
    gap: spacing.md,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  warningDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  warningText: { flex: 1, fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },

  // Step cards
  stepCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    flexDirection: "row",
    padding: spacing.md,
    gap: spacing.md,
    alignItems: "flex-start",
  },
  stepNumber: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  stepNumText: { fontFamily: fonts.displayBold, fontSize: 15, color: "#FFFFFF" },
  stepContent: { flex: 1, gap: 2 },
  stepTitle: { fontFamily: fonts.displayBold, fontSize: 15, lineHeight: 20, color: c.onSurface },
  stepBody: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },

  // Bullets
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  bulletText: { flex: 1, fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onSurfaceSecondary },

  // Sources card
  sourcesCard: {
    marginHorizontal: spacing.lg,
    gap: spacing.sm,
  },

  // Review warning
  reviewCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },

  // Empty / loading
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing["2xl"] },
}));

// ── Section Renderer ────────────────────────────────────────────────────────
function ArticleSection({
  section,
  index,
  total,
}: {
  section: LearningSection;
  index: number;
  total: number;
}) {
  const s = useStyles();
  const { colors } = useTheme();

  // Detect section types by heading keywords
  const headingLower = section.heading.toLowerCase();
  const isWarnings = headingLower.includes("warning") || headingLower.includes("sign") || headingLower.includes("red flag");
  const isSteps = headingLower.includes("what to do") || headingLower.includes("steps") || headingLower.includes("how to");

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={s.sectionHeading}>{section.heading}</Text>

      {section.paragraphs.map((p, i) => (
        <Text key={`p-${i}`} style={s.sectionBody}>{p}</Text>
      ))}

      {isWarnings && section.bullets.length > 0 ? (
        <View style={s.warningCard}>
          {section.bullets.map((bullet, i) => (
            <View key={`w-${i}`} style={s.warningRow}>
              <View style={[s.warningDot, { backgroundColor: "rgba(231,76,60,0.12)" }]}>
                <CircleAlert size={16} color="#E74C3C" />
              </View>
              <Text style={s.warningText}>{bullet}</Text>
            </View>
          ))}
        </View>
      ) : isSteps && section.bullets.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          {section.bullets.map((bullet, i) => {
            const [title, ...rest] = bullet.split(".");
            const body = rest.join(".").trim();
            return (
              <View key={`s-${i}`} style={s.stepCard}>
                <View style={[s.stepNumber, { backgroundColor: colors.brand }]}>
                  <Text style={s.stepNumText}>{i + 1}</Text>
                </View>
                <View style={s.stepContent}>
                  <Text style={s.stepTitle}>{title.trim()}{body ? "." : ""}</Text>
                  {body ? <Text style={s.stepBody}>{body}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : section.bullets.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          {section.bullets.map((bullet, i) => (
            <View key={`b-${i}`} style={s.bulletRow}>
              <View style={[s.bulletDot, { backgroundColor: colors.brand }]} />
              <Text style={s.bulletText}>{bullet}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────
export default function LearningArticleScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [article, setArticle] = useState<LearningArticle | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    void learningArticle(String(slug)).then(setArticle).catch(() => setError(true));
  }, [slug]);

  const badge = article ? getTypeBadge(article.contentType) : null;
  const readingTime = article ? estimateReadingTime(article) : "";
  const updatedDate = article ? formatDate(article.updatedAt) : "";

  const handleShare = async () => {
    if (!article) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (available) {
        // Share article title
        await Sharing.shareAsync("", {
          dialogTitle: article.title,
        }).catch(() => {});
      }
    } catch {}
  };

  // ── Fixed header, the same in every state ──
  const header = (
    <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="article-back"
        onPress={() => goBackOrHome(router)}
        style={s.headerBtn}
      >
        <ChevronLeft size={24} color={colors.onSurface} />
      </Pressable>
      <Text style={s.headerTitle} testID="article-header-title">Learn with Higgins</Text>
      <View style={s.headerActions}>
        {article ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share article"
            testID="article-share"
            onPress={handleShare}
            style={s.headerBtn}
          >
            <Share2 size={22} color={colors.onSurface} />
          </Pressable>
        ) : <View style={s.headerBtn} />}
        <AppMenuButton testID="article-menu" />
      </View>
    </View>
  );

  // ── Loading / error states ──
  if (!article && !error) {
    return (
      <View style={s.root} testID="learning-article-screen">
        {header}
        <View style={s.centerWrap}>
          <ActivityIndicator testID="learning-article-loading" color={colors.brand} />
        </View>
      </View>
    );
  }

  if (error || !article) {
    return (
      <View style={s.root} testID="learning-article-screen">
        {header}
        <View style={s.centerWrap}>
          <Card><Body>This article is unavailable right now.</Body></Card>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root} testID="learning-article-screen">
      {header}

      {/* ── Scrollable content ── */}
      <ScrollView
        testID="learning-article-scroll"
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 90 }]}
      >
        {/* Type badge + meta */}
        <View style={s.metaRow}>
          {badge ? (
            <View style={[s.badge, { backgroundColor: badge.bg }]}>
              <Text style={[s.badgeText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          ) : null}
          <Clock size={14} color={colors.muted} />
          <Text style={s.metaText}>{readingTime}</Text>
          <Calendar size={14} color={colors.muted} />
          <Text style={s.metaText}>Updated {updatedDate}</Text>
        </View>

        <View style={s.titleArea}>
          <Text style={s.articleTitle} testID="article-title">{article.title}</Text>
          <Text style={s.articleSummary}>{article.summary}</Text>
        </View>
        <Text style={s.higginsQuote}>Stay alert, stay safer together. — Higgins</Text>

        {/* Review warning */}
        {article.reviewStatus === "due" ? (
          <View style={[s.reviewCard, { backgroundColor: "rgba(229,162,26,0.08)" }]}>
            <Body>This guidance is due for editorial review. Check the dated official sources below before acting.</Body>
          </View>
        ) : null}

        {/* Article sections */}
        {article.sections.map((section, i) => (
          <ArticleSection key={`${section.heading}-${i}`} section={section} index={i} total={article.sections.length} />
        ))}

        {/* Citations / sources */}
        {article.citations.length > 0 ? (
          <View style={s.sourcesCard}>
            <Text style={s.sectionHeading}>Official sources</Text>
            <Text style={s.sectionBody}>Open the original guidance for the latest detail.</Text>
            {article.citations.map((citation, i) => (
              <Button
                key={`${citation.url}-${i}`}
                testID={`article-source-${i}`}
                variant="secondary"
                label={`Open ${citation.label}`}
                onPress={() => void Linking.openURL(citation.url)}
              />
            ))}
          </View>
        ) : null}

        {/* Ask Higgins */}
        <View style={{ paddingHorizontal: spacing.lg }}>
          <Button
            testID="article-ask-higgins"
            label="Ask Higgins about this"
            onPress={() => router.push({ pathname: "/(tabs)/ask", params: { prompt: `Please explain the learning article: ${article.title}` } })}
          />
        </View>
      </ScrollView>
    </View>
  );
}
