import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChildScreenHeader } from "@/src/components/ChildScreenHeader";
import { Body, Button, Card } from "@/src/components/ui";
import { learningArticle, type LearningArticle } from "@/src/higgins/hubClient";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({ root: { flex: 1, backgroundColor: c.surface }, content: { paddingHorizontal: spacing.xl, gap: spacing.lg }, title: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface }, body: { fontFamily: fonts.text, fontSize: 17, lineHeight: 27, color: c.onSurface } }));
export default function LearningArticleScreen() { const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter(); const { slug } = useLocalSearchParams<{ slug: string }>(); const [article, setArticle] = useState<LearningArticle | null>(null); const [error, setError] = useState(false);
  useEffect(() => { setError(false); void learningArticle(String(slug)).then(setArticle).catch(() => setError(true)); }, [slug]);
  return <View style={s.root} testID="learning-article-screen"><ChildScreenHeader title="Learning article" testID="learning-article-header" /><ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="learning-article-scroll">{!article && !error ? <ActivityIndicator testID="learning-article-loading" color={colors.brand} /> : error ? <Card testID="learning-article-error"><Body>This article is unavailable right now.</Body></Card> : article ? <><Text style={s.title} testID="learning-article-title">{article.title}</Text><Body testID="learning-article-summary">{article.summary}</Body><Text style={s.body} testID="learning-article-body">{article.body}</Text><Card testID="learning-article-sources" style={{ gap: spacing.sm }}><Body>Sources: {article.sourceNames.join(" and ")}</Body>{article.sourceUrls.map((url, index) => <Button key={url} testID={`learning-article-source-${index}`} variant="secondary" label={`Open ${article.sourceNames[index] ?? "official source"}`} onPress={() => void Linking.openURL(url)} />)}</Card><Button testID="learning-article-ask-higgins" label="Ask Higgins about this" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { prompt: `Please explain the learning article: ${article.title}` } })} /></> : null}</ScrollView></View>; }