// Share Into Apollo — landing screen for content shared from other apps (and apollo://share deep links).
// Shows what Apollo thinks it is, jumps straight in, and offers the other checks in case it guessed wrong.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Share2 from "lucide-react-native/icons/share-2";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { alternativeRoutes, classifyShare, SHARE_KIND_LABEL, type ShareRoute, type SharedPayload } from "@/src/share/classifyShare";
import { SOURCE_APPS, withSourceApp } from "@/src/share/sourceApps";
import { ShareFileBatch } from "@/src/components/ShareFileBatch";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { getShareIntake, putShareIntake } from "@/src/share/shareIntake";
import { acknowledgeNativeShareHandoff, discardNativeShareHandoff, loadNativeShareHandoff } from "@/src/share/nativeShareHandoff";
import { CloseButton } from "@/src/components/CloseButton";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  preview: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  // "Which app did this arrive in?" — chips in the popup shown only for a share from another app.
  appRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  appChip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceTertiary },
  appChipText: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface },
}));

export default function ShareLanding() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ intakeId?: string; nativeHandoffId?: string; text?: string; url?: string; fileUri?: string; fileName?: string; mime?: string; size?: string }>();
  const { ready, setupDone } = useApollo();
  const directPayload: SharedPayload = useMemo(() => ({ text: params.text ?? null, webUrl: params.url ?? null, files: params.fileUri ? [{ path: params.fileUri, fileName: params.fileName ?? null, mimeType: params.mime ?? null, size: params.size ? Number(params.size) : null }] : [] }), [params.text, params.url, params.fileUri, params.fileName, params.mime, params.size]);
  const initialPayload = useMemo(() => getShareIntake(params.intakeId) ?? (params.nativeHandoffId ? null : directPayload), [params.intakeId, params.nativeHandoffId, directPayload]);
  const [payload, setPayload] = useState<SharedPayload | null>(initialPayload);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!params.nativeHandoffId) return;
    let active = true;
    void loadNativeShareHandoff(params.nativeHandoffId).then((value) => { if (active) setPayload(value); }).catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : "ApolloSG could not open the shared items."); });
    return () => { active = false; };
  }, [params.nativeHandoffId]);
  const intakeId = useMemo(() => payload ? (params.intakeId ?? putShareIntake(payload)) : null, [params.intakeId, payload]);
  const route = useMemo(() => payload ? classifyShare(payload) : null, [payload]);
  const others = useMemo(() => payload && route ? alternativeRoutes(payload, route.kind) : [], [payload, route]);
  const multiFiles = (payload?.files && payload.files.length > 1) ? payload.files : null;
  /** Set while Apollo asks which app a shared message arrived in — the one thing only the person knows. */
  const [appAsk, setAppAsk] = useState<ShareRoute | null>(null);
  const proceed = (r: ShareRoute, app: string | null) => {
    if (!intakeId || !payload) return;
    setAppAsk(null);
    const text = payload.text ?? "";
    const id = app && text ? putShareIntake({ ...payload, text: withSourceApp(text, app) }) : intakeId;
    void acknowledgeNativeShareHandoff(params.nativeHandoffId);
    router.replace({ pathname: r.pathname, params: { ...r.params, sharedIntakeId: id } });
  };
  const go = (r: ShareRoute) => {
    if (!intakeId) return;
    // Only a share from another app can carry an origin, and only the person can name it. A message
    // that already states its app (a forward, a preview sample) is not asked again.
    const text = (payload?.text ?? "").trim();
    if (r.kind === "message" && text && !/^source app:/im.test(text)) { setAppAsk(r); return; }
    proceed(r, null);
  };
  const close = () => { void discardNativeShareHandoff(params.nativeHandoffId); goBackOrHome(router); };
  const preview = payload?.files?.[0] ? `${payload.files.length} attachment${payload.files.length === 1 ? "" : "s"}: ${payload.files[0].fileName ?? payload.files[0].path.split("/").pop()}${payload.files[0].mimeType ? ` · ${payload.files[0].mimeType}` : ""}` : (payload?.webUrl || payload?.text || "").slice(0, 400);

  if (ready && !setupDone) return <Redirect href="/" />;
  if (loadError) return <View style={s.root} testID="share-load-error"><View style={[s.top, { paddingTop: insets.top + spacing.md }]}><Text style={s.title}>Shared with ApolloSG</Text><CloseButton testID="share-error-close" label="Close shared items" onPress={close} /></View><View style={s.content}><Card style={{ gap: spacing.md }}><Body testID="share-load-error-message">{loadError}</Body></Card></View></View>;
  if (!payload) return <View style={[s.root, { alignItems: "center", justifyContent: "center", gap: spacing.md }]} testID="share-loading"><ActivityIndicator color={colors.brandPrimary} /><Body testID="share-loading-message">Opening the protected shared items…</Body></View>;
  if (!preview || !route) return <Redirect href="/(tabs)/home" />;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Shared with ApolloSG</Text>
        <CloseButton testID="share-close" label="Close shared items" onPress={close} />
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="share-scroll">
        {multiFiles ? (
          <ShareFileBatch files={multiFiles} />
        ) : (
        <>
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
        </>
        )}
        <Body>In apps that offer Share, tap Share → ApolloSG. Not every app offers it — you can always copy and paste the text or use a screenshot instead. ApolloSG keeps native handoffs protected for no more than 24 hours.</Body>
      </ScrollView>
      {/* Asked as a popup, and only for a share from another app. */}
      <Sheet visible={!!appAsk} onClose={() => setAppAsk(null)} title="Which app did this arrive in?" testID="share-app-sheet">
        <Body>Apollo records it with the message, so your case shows it the way it arrived. It never guesses.</Body>
        <View style={s.appRow}>
          {SOURCE_APPS.map((app) => (
            <Pressable
              key={app}
              testID={`share-app-${app.toLowerCase()}`}
              accessibilityRole="button"
              accessibilityLabel={`It arrived in ${app}`}
              onPress={() => appAsk && proceed(appAsk, app)}
              style={({ pressed }) => [s.appChip, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={s.appChipText}>{app}</Text>
            </Pressable>
          ))}
        </View>
        <Button testID="share-app-skip" variant="ghost" label="I'm not sure — check it anyway" onPress={() => appAsk && proceed(appAsk, null)} />
      </Sheet>
    </View>
  );
}
