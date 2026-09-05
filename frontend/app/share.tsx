// Share Into Apollo — landing screen for content shared from other apps (and apollo://share deep links).
// Shows what Apollo thinks it is, jumps straight in, and offers the other checks in case it guessed wrong.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Share2 from "lucide-react-native/icons/share-2";
import X from "lucide-react-native/icons/x";
import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { alternativeRoutes, classifyShare, SHARE_KIND_LABEL, type ShareRoute, type SharedPayload } from "@/src/share/classifyShare";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  preview: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
}));

export default function ShareLanding() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string; url?: string; fileUri?: string; fileName?: string; mime?: string; size?: string }>();
  const { ready, setupDone } = useApollo();
  const payload: SharedPayload = useMemo(() => ({ text: params.text ?? null, webUrl: params.url ?? null, files: params.fileUri ? [{ path: params.fileUri, fileName: params.fileName ?? null, mimeType: params.mime ?? null, size: params.size ? Number(params.size) : null }] : [] }), [params.text, params.url, params.fileUri, params.fileName, params.mime, params.size]);
  const route = useMemo(() => classifyShare(payload), [payload]);
  const others = useMemo(() => alternativeRoutes(payload, route.kind), [payload, route.kind]);
  const go = (r: ShareRoute) => router.replace({ pathname: r.pathname, params: r.params });
  const preview = payload.files?.[0] ? `${payload.files[0].fileName ?? payload.files[0].path.split("/").pop()}${payload.files[0].mimeType ? ` · ${payload.files[0].mimeType}` : ""}` : (payload.webUrl || payload.text || "").slice(0, 400);

  if (ready && !setupDone) return <Redirect href="/" />;
  if (!preview) return <Redirect href="/(tabs)/home" />;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Shared with Apollo</Text>
        <Pressable testID="share-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="share-scroll">
        <Card style={{ gap: spacing.sm }} testID="share-detected">
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><Share2 size={20} color={colors.brandPrimary} /><Pill tone="neutral" label={`Looks like ${SHARE_KIND_LABEL[route.kind]}`} testID="share-kind" /></View>
          <Text style={s.preview} numberOfLines={8} testID="share-preview">{preview}</Text>
          <Body testID="share-reason">{route.reason} Nothing has been sent anywhere yet.</Body>
          <Button testID="share-go" label={`Check as ${SHARE_KIND_LABEL[route.kind]}`} onPress={() => go(route)} />
        </Card>
        {others.length ? (
          <View style={{ gap: spacing.sm }}>
            <SectionTitle>Not that? Check it as…</SectionTitle>
            {others.map((r) => <Button key={r.kind} testID={`share-alt-${r.kind}`} variant="secondary" label={SHARE_KIND_LABEL[r.kind].replace(/^(a|an) /, (m) => m.charAt(0).toUpperCase() + m.slice(1))} onPress={() => go(r)} />)}
          </View>
        ) : null}
        <Body>Share to Apollo from any app: Share → Apollo. On this preview, use the deep link apollo://share?text=… or ?url=…</Body>
      </ScrollView>
    </View>
  );
}
