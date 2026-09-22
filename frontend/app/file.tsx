// Gate 6 — Check This File. Reads only the file's first bytes (signature) and a text sample locally;
// nothing is uploaded. URLs found inside are handed to Gate 3.
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import { GateInvestigation } from "@/src/components/GateInvestigation";
import { File } from "expo-file-system";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { markCheckDone } from "@/src/store/checkCompletion";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { analyseFile, FILE_SOURCES, type FileAnalysis, type FileSource } from "@/src/domain/fileAnalysis";
import { FILE_SIZE_LIMIT, inspectSample, inspectWithHandle, type Inspection } from '@/src/domain/fileInspection';
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { getShareIntake } from "@/src/share/shareIntake";
import { issueContext } from "@/src/domain/higginsHandoff";
import { disposePickerCopy, sweepPickerCopies } from '@/src/domain/fileCopyLifecycle';

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
  passwordRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
}));

type FileAsset = { uri: string; name: string; mimeType?: string | null; size?: number };
type PendingFile = { asset: FileAsset; inspected: Inspection; needsSource: boolean; needsPassword: boolean; sourceAnswered: boolean; owned: boolean };

export default function CheckFile() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, upsertEvent, deviceId, adapterLabel } = useApollo();
  const [source, setSource] = useState<FileSource>("unknown");
  const [pw, setPw] = useState<boolean | null>(null);
  const [nameOnly, setNameOnly] = useState("");
  const [result, setResult] = useState<{ submissionId: string; a: FileAnalysis; event: PatrolEvent | null } | null>(null);
  const [tech, setTech] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ asset: FileAsset; inspected: Inspection; realType: string; owned: boolean } | null>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  // The temporary handle (an app-owned picker copy, or a shared-in URI we never own) is kept alive for the whole
  // screen visit — a later "Ask Higgins" upload needs the SAME bytes local inspection just read. It is disposed only
  // after durable publication, explicit reset, or the 15-minute expiry below. Never the user's original.
  const disposeSelection = (uri: string | null, owned: boolean) => { if (uri) disposePickerCopy(uri, owned); };
  useEffect(() => { sweepPickerCopies(); const timer = setInterval(sweepPickerCopies, 60000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => { disposeSelection(selected.asset.uri, selected.owned); setSelected(null); setPending(null); setResult(null); setNameOnly(''); setPickerError('Temporary file evidence expired. Select the file again to continue.'); }, 15 * 60 * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.asset.uri]);
  // Navigation into Ask/Higgins intentionally does not dispose the picker copy. The shared case upload owns it until
  // durable publication (or the bounded expiry sweep), making backgrounding/navigation safe.

  const finish = async (a: FileAnalysis) => {
    let event: PatrolEvent | null = null;
    if (a.state !== "resting") {
      event = await upsertEvent({ event_id: Math.random().toString(36).slice(2) + Date.now().toString(36), device_id: deviceId ?? "local", category: "known_threat", state: a.state, status: "active", headline: `File: ${a.title}`, what_happened: a.verdict, why: a.why, what_to_do: a.recommendation, indicator_host: a.urls[0] ? a.urls[0].replace(/^https?:\/\//i, "").split("/")[0] : null, indicator_digest: null, local_indicator: a.technical[0], verified_block: false, adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: null, scenario: a.scenario });
    }
    setResult({ submissionId: event?.event_id ?? Crypto.randomUUID(), a, event });
    void markCheckDone("file");
  };
  const params = useLocalSearchParams<{ uri?: string; name?: string; mime?: string; size?: string; source?: string; sharedIntakeId?: string }>();
  const shared = getShareIntake(params.sharedIntakeId);
  const sharedFile = shared?.files?.[0];
  const incomingUri = sharedFile?.path || params.uri;
  useEffect(() => { if (!incomingUri && FILE_SOURCES.some((item) => item.id === params.source)) setSource(params.source as FileSource); }, [params.source, incomingUri]);
  const pick = async () => {
    setPickerError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets[0]) return;
      // The picker copy is owned by Apollo (it lives under our own cache directory) and stays alive past this local
      // check — an "Ask Higgins" upload for THIS same submission may still need it. It is disposed by the reset/
      // unmount/expiry handlers above, or by the 15-minute crash-recovery sweep, never eagerly right here.
      await analyseAsset(res.assets[0], "unknown", true);
    } catch (error) { setPickerError(error instanceof Error ? error.message : "Apollo could not open the file picker. Try again."); }
  };
  // Shared from another app (Share → Apollo): analyse the shared file straight away. This URI is never ours to delete.
  useEffect(() => { if (incomingUri && !result) { const incoming = FILE_SOURCES.some((item) => item.id === params.source) ? params.source as FileSource : "unknown"; setSource(incoming); void analyseAsset({ uri: incomingUri, name: sharedFile?.fileName ?? params.name ?? incomingUri.split("/").pop() ?? "shared file", mimeType: sharedFile?.mimeType ?? params.mime ?? null, size: sharedFile?.size ?? (params.size ? Number(params.size) : undefined) }, incoming, false); } }, [incomingUri]); // eslint-disable-line react-hooks/exhaustive-deps
  const analyseAsset = async (asset: { uri: string; name: string; mimeType?: string | null; size?: number }, assetSource: FileSource = source, owned: boolean = false) => {
    setBusy(true);
    try {
      let inspected: Inspection = { headBytes: null, textSample: null };
      try {
        if (Platform.OS === "web") {
          if (asset.size != null && (!Number.isFinite(asset.size) || asset.size <= 0 || asset.size > FILE_SIZE_LIMIT)) throw new Error("invalid file size");
          const response = await fetch(asset.uri);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (!bytes.length || bytes.length > FILE_SIZE_LIMIT) throw new Error("invalid file size");
          inspected = inspectSample(bytes);
        } else {
          const file = new File(asset.uri);
          inspected = inspectWithHandle(file);
        }
      } catch { inspected.inspectionError = 'This build could not read the file contents.'; }
      const preliminary = analyseFile({ name: asset.name, size: asset.size ?? undefined, mime: asset.mimeType ?? null, ...inspected, source: assetSource, passwordInMessage: false });
      // The real, still-live handle is kept (never blanked) — Higgins needs it if the person later asks for a deeper,
      // explicitly-authorised cloud check. Filenames/size/mime travel as METADATA describing the file, never as a
      // substitute for its contents.
      const metadata: FileAsset = { name: asset.name, size: asset.size, mimeType: asset.mimeType, uri: asset.uri };
      setSelected({ asset: metadata, inspected, realType: preliminary.realType, owned });
      const extension = asset.name.toLowerCase().split(".").pop() ?? "";
      const needsPassword = ["zip", "rar", "7z"].includes(preliminary.realType) || ["zip", "rar", "7z"].includes(extension);
      const needsSource = (preliminary.state === "barking" || ["F01", "F03", "F04", "F13"].includes(preliminary.scenario)) && assetSource === "unknown";
      if (needsPassword || needsSource) setPending({ asset: metadata, inspected, needsSource, needsPassword, sourceAnswered: assetSource !== "unknown", owned });
      else await finish(preliminary);
    } catch (e) { setPickerError(e instanceof Error ? e.message : "Apollo couldn't read that file. Choose it again or try another file."); } finally { setBusy(false); }
  };
  const completePending = async () => {
    if (!pending || (pending.needsSource && !pending.sourceAnswered) || (pending.needsPassword && pw === null)) return;
    setBusy(true);
    try { await finish(analyseFile({ name: pending.asset.name, size: pending.asset.size, mime: pending.asset.mimeType ?? null, ...pending.inspected, source, passwordInMessage: pw === true })); setPending(null); }
    catch (error) { setPickerError(error instanceof Error ? error.message : "Apollo couldn't finish this file check. Retry."); }
    finally { setBusy(false); }
  };
  const checkAnother = () => { disposeSelection(selected?.asset.uri ?? null, selected?.owned ?? false); setResult(null); setNameOnly(""); setSelected(null); setPending(null); setPickerError(null); setPw(null); setSource("unknown"); };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>File Gate</Text>
        <Pressable testID="file-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="file-scroll">
        {!result ? (
          <>
            <Body testID="file-inspection-scope">Select or share any download or attachment, including one from Google Drive or another cloud service. Apollo checks a signature and up to 200 KB locally, for files up to 20 MB. Cloud hosting is not proof of safety. No archive extraction or malware scan. A name-only check does not read content. This local check never uploads the file; asking Higgins about it afterwards does, only with your explicit action.</Body>
            <Button testID="file-pick" label={busy ? "Inspecting file…" : "Choose a file"} onPress={() => void pick()} disabled={busy} />
            {pickerError ? <Card testID="file-picker-error" style={{ gap: spacing.sm }}><Body>{pickerError}</Body><Button testID="file-picker-retry" variant="secondary" label="Try choosing again" onPress={() => void pick()} disabled={busy} /></Card> : null}
            {selected ? <Card testID="file-evidence" style={{ gap: spacing.xs }}><SectionTitle>What Apollo inspected</SectionTitle><Body testID="file-evidence-name">Filename: {selected.asset.name}</Body><Body testID="file-evidence-size">Size: {selected.asset.size == null ? "not supplied" : `${selected.asset.size} bytes`}</Body><Body testID="file-evidence-mime">Supplied type: {selected.asset.mimeType || "unknown"}</Body><Body testID="file-evidence-signature">Signature result: {selected.realType}</Body><Body testID="file-evidence-sample">Content sample: {selected.inspected.inspectionError ? selected.inspected.inspectionError : selected.inspected.textSample ? "supported text was read locally" : "not readable or not present"}</Body></Card> : null}
            {pending?.needsSource && !pending.sourceAnswered ? <Card testID="file-source-followup" style={{ gap: spacing.sm }}><SectionTitle>One detail could change the advice</SectionTitle><Body>Where did this file come from? Choose “Not sure” if the source is unknown.</Body><View style={s.chips}>{FILE_SOURCES.map((o) => <Pressable key={o.id} testID={`file-source-${o.id}`} accessibilityRole="radio" accessibilityState={{ checked: source === o.id && pending.sourceAnswered }} aria-checked={source === o.id && pending.sourceAnswered} onPress={() => { setSource(o.id); setPending((current) => current ? { ...current, sourceAnswered: true } : current); }} style={[s.chip, source === o.id && pending.sourceAnswered && s.chipOn]}><Text style={s.chipText}>{o.label}</Text></Pressable>)}</View></Card> : null}
            {pending?.needsPassword && (!pending.needsSource || pending.sourceAnswered) ? <Card testID="file-password-followup" style={{ gap: spacing.sm }}><SectionTitle>One more detail</SectionTitle><View style={s.passwordRow}><Text style={[s.why, { flex: 1, flexShrink: 1 }]}>A password for this archive was supplied with it</Text><Switch style={{ flexShrink: 0 }} testID="file-pw" value={pw === true} onValueChange={(value) => setPw(value)} trackColor={{ true: colors.growling, false: colors.borderStrong }} thumbColor={colors.onSurface} /></View><Body testID="file-password-answer">{pw === null ? "Not answered yet" : pw ? "You reported that a password was supplied." : "You reported that no password was supplied."}</Body>{pw === null ? <Button testID="file-pw-no" variant="secondary" label="No password was supplied" onPress={() => setPw(false)} /> : null}</Card> : null}
            {pending ? <Button testID="file-finish-check" label={busy ? "Finishing check…" : "Finish file check"} onPress={() => void completePending()} disabled={busy || (pending.needsSource && !pending.sourceAnswered) || (pending.needsPassword && pw === null)} /> : null}
            {!pending && !selected ? <><SectionTitle>Limited alternative: filename only</SectionTitle><Body>A filename-only check cannot read the signature or content and cannot establish safety.</Body><TextInput testID="file-name" style={s.input} value={nameOnly} onChangeText={setNameOnly} placeholder="e.g. Statement.pdf.exe" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} /><Button testID="file-name-check" variant="secondary" label="Check filename only" onPress={() => void finish(analyseFile({ name: nameOnly.trim(), source: "unknown", passwordInMessage: false }))} disabled={!nameOnly.trim()} /></> : null}
          </>
        ) : a ? (
          <>
            <Card testID="file-result" style={{ borderColor: toneColor(colors, a.state), gap: spacing.sm }}>
              <View style={s.chips}><Pill tone={a.state} label={STATE_NAME[a.state]} testID="file-state" /><Pill tone="neutral" label={a.title} testID="file-scenario" /><Pill tone="neutral" label={`Signature hint: ${a.realType}`} testID="file-realtype" /></View>
              <Text style={s.why}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.verdict} testID="file-verdict">{a.verdict}</Text>
              <SectionTitle>Why?</SectionTitle>
              {a.why.map((w, i) => <Text key={i} style={s.why} testID={`file-why-${i}`}>• {w}</Text>)}
              <SectionTitle>Recommendation</SectionTitle>
              <Text style={s.why} testID="file-recommendation">{a.recommendation}</Text>
            </Card>
            <Card testID="file-higgins" style={{ gap: spacing.sm, borderColor: colors.navyBorder }}>
              <SectionTitle>Higgins</SectionTitle>
              <Body testID="file-higgins-explanation">I&apos;ve explained what Apollo actually inspected, what remains unknown and the safest next step. A familiar sender or cloud host is context—not proof that the file is safe.</Body>
              <Body testID="file-higgins-next">{a.recommendation}</Body>
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
              <GateInvestigation submission={result} eventId={result.event?.event_id} testID="file-tell-more" label="Ask Higgins about this file" context={issueContext({ gate: "file", issue_summary: a.title, assessment_state: a.state, event_id: result.event?.event_id, findings: [
                { summary: `Filename: ${selected?.asset.name ?? "not supplied"}`, provenance: "observed", status: "uncertain" },
                { summary: `Supplied size/type: ${selected?.asset.size ?? "unknown"} bytes; ${selected?.asset.mimeType ?? "unknown"}`, provenance: "observed", status: "uncertain" },
                { summary: `Signature result: ${a.realType}`, provenance: "observed", status: a.state === "barking" ? "warning" : "uncertain" },
                { summary: selected?.inspected.inspectionError ? `Content sample unavailable: ${selected.inspected.inspectionError}` : selected?.inspected.textSample ? "A bounded supported text sample was read locally." : "No supported text sample was readable.", provenance: "observed", status: "uncertain" },
                ...a.why.slice(0, 4).map((summary) => ({ summary, provenance: "inferred" as const, status: a.state === "barking" ? "warning" as const : "uncertain" as const })),
              ], uncertainty: ["Only the signature and a bounded supported sample were inspected; complete contents and safety remain unknown."], confirmed_protective_actions: [], user_reported_actions: [], original_evidence: shared ? [...(shared.text || shared.webUrl ? [{ kind: "text" as const, value: [shared.text, shared.webUrl].filter(Boolean).join("\n"), label: "shared text" }] : []), ...(shared.files ?? []).map((file, index) => ({ kind: "file" as const, uri: file.path, name: file.fileName || `shared-attachment-${index + 1}`, mediaType: file.mimeType || "application/octet-stream", size: file.size ?? undefined }))] : selected ? [{ kind: "file", uri: selected.asset.uri, name: selected.asset.name, mediaType: selected.asset.mimeType || "application/octet-stream", size: selected.asset.size }] : [], available_actions: [
                { label: "Follow the File Gate recommendation", instruction: a.recommendation },
                { label: "Use I already opened it", instruction: "Return to the File Gate result and use I already opened it in Stay With Me for recovery steps." },
              ] })} question="What should I do with this file?" autoStart={false} />
              <Button testID="file-again" variant="ghost" label="Check another file" onPress={checkAnother} />
            </Card>
          </>
        ) : null}
      </KeyboardAwareScrollView>
      <Sheet visible={tech} onClose={() => setTech(false)} title="Technical details" testID="file-tech-sheet">
        {a?.technical.map((t, i) => <Body key={i} testID={`file-tech-${i}`}>{t}</Body>)}
        <Body>Deep malware scanning and hash reputation are not available in this build. Apollo shows only the device checks that completed.</Body>
        <Button testID="file-tech-close" variant="ghost" label="Done" onPress={() => setTech(false)} />
      </Sheet>
    </View>
  );
}
