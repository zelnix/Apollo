// Settings > Help & about > Rule book — Apollo's rule book, word for word: the same shared file the admin portal
// shows (backend/content/rulebook.md). The last copy read is kept on this phone so the book opens offline.
import { useLocalSearchParams, useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppMenuButton } from "@/src/components/AppMenu";
import { RuleBookSections } from "@/src/components/RuleBookSections";
import { Body, Button, Card } from "@/src/components/ui";
import { parseRuleBook, reviewedLabel, sectionsOf } from "@/src/domain/ruleBook";
import { ruleBook, type RuleBook } from "@/src/higgins/hubClient";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { storage } from "@/src/utils/storage";

const CACHE_KEY = "apollo.ruleBook.v1";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.md },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -spacing.sm },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  meta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  center: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
}));

export default function RuleBookScreen() {
  const s = useStyles(); const insets = useSafeAreaInsets(); const router = useRouter(); const { colors } = useTheme();
  // Opened from a result's "See the rule": go straight to that section.
  const { section } = useLocalSearchParams<{ section?: string }>();
  const { deviceId } = useApollo();
  const [book, setBook] = useState<RuleBook | null>(null);
  const [fromPhone, setFromPhone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const bookY = useRef<number | null>(null);
  const sectionY = useRef<number | null>(null);
  const userScrolled = useRef(false);

  useEffect(() => {
    void storage.getItem<string | null>(CACHE_KEY, null).then((raw) => {
      if (!raw) return;
      try { setBook((current) => current ?? (JSON.parse(raw) as RuleBook)); setFromPhone(true); } catch { /* a damaged copy is ignored */ }
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const latest = await ruleBook();
      setBook(latest); setFromPhone(false); setError(null);
      void storage.setItem(CACHE_KEY, JSON.stringify(latest));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Apollo couldn't load the rule book.");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);
  // Tried at once; tried again when this device's credential arrives (a moment after a cold start).
  useEffect(() => { void load(); }, [load, deviceId]);

  const { intro, sections } = useMemo(() => sectionsOf(book ? parseRuleBook(book.markdown) : []), [book]);
  const reviewed = reviewedLabel(book?.reviewedAt);

  const goToSection = useCallback(() => {
    if (!section || userScrolled.current || bookY.current === null || sectionY.current === null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, bookY.current + sectionY.current - spacing.md), animated: false });
  }, [section]);

  return (
    <View style={s.root} testID="rule-book-screen">
      <View style={[s.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="rule-book-back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBackOrHome(router)} style={s.back}>
          <ChevronLeft size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={s.title} accessibilityRole="header">Rule book</Text>
        <AppMenuButton testID="rule-book-menu" />
      </View>
      <ScrollView ref={scrollRef} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing["3xl"] }]} testID="rule-book-scroll"
        onScrollBeginDrag={() => { userScrolled.current = true; }} onContentSizeChange={goToSection}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.gold} />}>
        {book ? (
          <>
            <Text style={s.meta} testID="rule-book-meta">
              {fromPhone && error ? "Showing the copy saved on this phone. Apollo couldn't reach its server just now." : reviewed ? `Reviewed against how Apollo works on ${reviewed}.` : "Apollo's current rule book."}
            </Text>
            <View collapsable={false} onLayout={(e) => { bookY.current = e.nativeEvent.layout.y; goToSection(); }}>
              <RuleBookSections intro={intro} sections={sections} initiallyOpen={section}
                onSectionLayout={(id, y) => { if (id === section) { sectionY.current = y; goToSection(); } }} />
            </View>
          </>
        ) : loading ? (
          <View style={s.center} testID="rule-book-loading"><ActivityIndicator color={colors.gold} /><Body>Loading the rule book…</Body></View>
        ) : (
          <Card testID="rule-book-error" style={{ gap: spacing.md }}>
            <Body>{error ?? "Apollo couldn't load the rule book."}</Body>
            <Button testID="rule-book-retry" variant="secondary" label="Try again" onPress={() => { setLoading(true); void load(); }} />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
