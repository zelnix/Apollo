// Gate 6 — Check This File. Reads only the file's first bytes (signature) and a text sample locally;
// nothing is uploaded. URLs found inside are handed to Gate 3.
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Redirect, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { analyseFile, FILE_SOURCES, type FileAnalysis, type FileSource } from "@/src/domain/fileAnalysis";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  chipOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  verdict: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
}));

export default function CheckFile() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, upsertEvent, deviceId, adapterLabel, showToast } = useApollo();
  const [source, setSource] = useState<FileSource>("unknown");
  const [pw, setPw] = useState(false);
  const [nameOnly, setNameOnly] = useState("");
  const [result, setResult] = useState<{ a: FileAnalysis; event: PatrolEvent | null } | null>(null);
  const [tech, setTech] = useState(false);
  const [busy, setBusy] = useState(false);

  const finish = async (a: FileAnalysis) => {
    let event: PatrolEvent | null = null;
    if (a.state !== "resting") {
      event = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "known_threat", state: a.state, status: "active", headline: `File: ${a.title}`, what_happened: a.verdict, why: a.why, what_to_do: a.recommendation, indicator_host: a.urls[0] ? a.urls[0].replace(/^https?:\/\//i, "").split("/")[0] : null, indicator_digest: null, local_indicator: a.technical[0], verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: null, scenario: a.scenario });
    }
    setResult({ a, event });
  };
  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      let head: Uint8Array | null = null; let text: string | null = null;
      try {
        const file = new File(asset.uri);
        const bytes = await file.bytes();
        head = bytes.slice(0, 16);
        const sample = bytes.slice(0, 200_000);
        text = Array.from(sample).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : " ")).join("");
      } catch { /* web or unreadable: fall back to name + MIME */ }
      await finish(analyseFile({ name: asset.name, size: asset.size ?? undefined, mime: asset.mimeType ?? null, headBytes: head, textSample: text, source, passwordInMessage: pw }));
    } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't read that file.", "barking"); } finally { setBusy(false); }
  };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check this file</Text>
        <Pressable testID="file-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="file-scroll">
        {!result ? (
          <>
            <Body>Apollo checks what a file really is before trusting what it says it is. Only the file&apos;s signature and any links inside are read — on your phone, nothing uploaded.</Body>
            <Text style={s.why}>Where did it come from?</Text>
            <View style={s.chips}>{FILE_SOURCES.map((o) => <Pressable key={o.id} testID={`file-source-${o.id}`} accessibilityRole="button" onPress={() => setSource(o.id)} style={[s.chip, source === o.id && s.chipOn]}><Text style={s.chipText}>{o.label}</Text></Pressable>)}</View>
            <View style={s.row}><Text style={s.why}>A password for it came in the same message</Text><Switch testID="file-pw" value={pw} onValueChange={setPw} trackColor={{ true: colors.growling, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View>
            <Button testID="file-pick" label={busy ? "Sniffing…" : "Choose a file"} onPress={() => void pick()} disabled={busy} />
            <SectionTitle>Or just check a file name</SectionTitle>
            <TextInput testID="file-name" style={s.input} value={nameOnly} onChangeText={setNameOnly} placeholder="e.g. Statement.pdf.exe" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
            <Button testID="file-name-check" variant="secondary" label="Check the name" onPress={() => void finish(analyseFile({ name: nameOnly.trim(), source, passwordInMessage: pw }))} disabled={!nameOnly.trim()} />
          </>
        ) : a ? (
          <>
            <Card testID="file-result" style={{ borderColor: toneColor(colors, a.state), gap: spacing.sm }}>
              <View style={s.chips}><Pill tone={a.state} label={STATE_NAME[a.state]} testID="file-state" /><Pill tone="neutral" label={a.title} testID="file-scenario" /><Pill tone="neutral" label={`Real type: ${a.realType}`} testID="file-realtype" /></View>
              <Text style={s.why}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.verdict} testID="file-verdict">{a.verdict}</Text>
              <SectionTitle>Why?</SectionTitle>
              {a.why.map((w, i) => <Text key={i} style={s.why} testID={`file-why-${i}`}>• {w}</Text>)}
              <SectionTitle>Recommendation</SectionTitle>
              <Text style={s.why} testID="file-recommendation">{a.recommendation}</Text>
            </Card>
            {a.urls.length ? (
              <Card style={{ gap: spacing.sm }} testID="file-links">
                <SectionTitle>Links inside the file</SectionTitle>
                {a.urls.map((u, i) => <View key={u} style={s.row}><Text style={[s.why, { flex: 1 }]} numberOfLines={1}>{u}</Text><Button testID={`file-check-link-${i}`} variant="secondary" label="Check link" onPress={() => router.push({ pathname: "/check", params: { url: u, source: "file" } })} /></View>)}
              </Card>
            ) : null}
            <Card style={{ gap: spacing.sm }} testID="file-actions">
              {a.handoff === "app" ? <Button testID="file-check-app" label="I installed it — check the app" onPress={() => router.push({ pathname: "/app-check", params: { name: a.technical[0].replace(/^Name: /, "").replace(/\.[^.]+$/, ""), source: source === "browser" ? "browser" : "message", scent: result.event?.scent_id ?? result.event?.event_id ?? "" } })} /> : null}
              {a.handoff === "network" ? <Button testID="file-check-device" label="I installed it — check my device" onPress={() => router.push("/device")} /> : null}
              <Button testID="file-tech" variant="secondary" label="View technical details" onPress={() => setTech(true)} />
              {result.event ? <RecoveryFlow event={result.event} kinds={["clicked", "app", "password", "card", "money", "download"]} testID="file-recovery" /> : null}
              {result.event ? <Button testID="file-tell-more" variant="ghost" label="Ask Apollo about this file" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { context: `File check: ${a.title}. State: ${STATE_NAME[a.state]}. ${a.technical.join("; ")}`, prompt: "What should I do with this file?" } })} /> : null}
              <Button testID="file-again" variant="ghost" label="Check another file" onPress={() => { setResult(null); setNameOnly(""); }} />
            </Card>
          </>
        ) : null}
      </KeyboardAwareScrollView>
      <Sheet visible={tech} onClose={() => setTech(false)} title="Technical details" testID="file-tech-sheet">
        {a?.technical.map((t, i) => <Body key={i} testID={`file-tech-${i}`}>{t}</Body>)}
        <Body>Deep malware scanning and hash reputation require the native Security SDK — not available in this build. Apollo shows only what it could verify.</Body>
        <Button testID="file-tech-close" variant="ghost" label="Done" onPress={() => setTech(false)} />
      </Sheet>
    </View>
  );
}
