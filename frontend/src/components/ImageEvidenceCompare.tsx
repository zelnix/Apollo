// Evidence viewer: the original image (on this device only) side by side with the exact copy Apollo sent.
import React, { useCallback, useEffect, useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Share2 from "lucide-react-native/icons/share-2";
import Trash2 from "lucide-react-native/icons/trash";
import { listImageEvidence, removeOriginal, subscribeImageEvidence, type ImageEvidenceRecord } from "@/src/store/imageEvidence";
import { getOriginalSource, subscribeOriginalSource, type OriginalSource } from "@/src/store/originalSource";
import { Button } from "@/src/components/ui";
import { shareEvidencePack, type PackSummary } from "@/src/utils/evidencePack";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  wrap: { borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, backgroundColor: c.surfaceSecondary },
  title: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", gap: spacing.sm },
  col: { flex: 1, gap: spacing.xs },
  label: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurfaceSecondary },
  thumb: { width: "100%", aspectRatio: 3 / 4, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary },
  missing: { width: "100%", aspectRatio: 3 / 4, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center", padding: spacing.sm },
  note: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted },
  confirm: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.surfaceTertiary },
  confirmText: { fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 18, color: c.onSurface },
  viewer: { flex: 1, backgroundColor: "#000000" },
  viewerBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  viewerTitle: { fontFamily: fonts.textMedium, fontSize: 15, color: "#FFFFFF", flex: 1 },
  viewerClose: { fontFamily: fonts.textMedium, fontSize: 15, color: "#FFFFFF", padding: spacing.sm },
}));

function notes(r: ImageEvidenceRecord): string[] {
  const out = [r.originalRemovedAt ? "You removed the original from this phone. The sent copy is kept with the case." : "The original is kept only on this device and was never uploaded."];
  if (r.cropped) out.push("You cropped the image before sending.");
  if (!r.checked) out.push("Credential check wasn't available on this device, so nothing was blacked out.");
  else if (r.redactedRegions > 0) out.push(`${r.redactedRegions} password, PIN or code area${r.redactedRegions === 1 ? " was" : "s were"} blacked out on the sent copy.`);
  else out.push("No passwords, PINs or codes were detected, so nothing was blacked out.");
  return out;
}

export function ImageEvidenceCompare({ caseKey, title, date, summary }: { caseKey: string; title: string; date: string; summary?: PackSummary | null }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ImageEvidenceRecord[]>([]);
  const [originalSource, setOriginalSource] = useState<OriginalSource | null>(null);
  const [full, setFull] = useState<{ uri: string; title: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { void listImageEvidence(caseKey).then(setItems).catch(() => setItems([])); }, [caseKey]);
  useEffect(() => { load(); return subscribeImageEvidence(load); }, [load]);
  useEffect(() => {
    const loadSrc = () => { void getOriginalSource(caseKey).then(setOriginalSource).catch(() => setOriginalSource(null)); };
    loadSrc();
    return subscribeOriginalSource(loadSrc);
  }, [caseKey]);

  const share = async (r: ImageEvidenceRecord) => {
    setBusyId(r.id); setError(null);
    try { await shareEvidencePack(r, { title, date, notes: notes(r), summary, originalSource }); }
    catch { setError("Apollo couldn't create the evidence pack. Try again."); }
    finally { setBusyId(null); }
  };
  const remove = async (id: string) => {
    setConfirmId(null); setError(null);
    try { await removeOriginal(id); } catch { setError("Apollo couldn't remove the original. Try again."); }
  };

  if (!items.length) return null;

  return (
    <>
      {items.map((r) => (
        <View key={r.id} style={s.wrap} testID="image-evidence-compare">
          <Text style={s.title}>Image evidence</Text>
          <View style={s.row}>
            <View style={s.col}>
              <Text style={s.label}>Original (on your device)</Text>
              {r.originalUri ? (
                <Pressable onPress={() => setFull({ uri: r.originalUri!, title: "Original (on your device)" })} accessibilityRole="imagebutton" accessibilityLabel="View original image" testID="image-evidence-original">
                  <Image source={{ uri: r.originalUri }} style={s.thumb} resizeMode="contain" />
                </Pressable>
              ) : <View style={s.missing}><Text style={s.note}>{r.originalRemovedAt ? "Original removed from this phone" : "Original not available"}</Text></View>}
            </View>
            <View style={s.col}>
              <Text style={s.label}>Sent copy</Text>
              <Pressable onPress={() => setFull({ uri: r.sentUri, title: "Sent copy" })} accessibilityRole="imagebutton" accessibilityLabel="View sent copy" testID="image-evidence-sent">
                <Image source={{ uri: r.sentUri }} style={s.thumb} resizeMode="contain" />
              </Pressable>
            </View>
          </View>
          {notes(r).map((n) => <Text key={n} style={s.note}>{n}</Text>)}
          {confirmId === r.id ? (
            <View style={s.confirm} testID="image-evidence-remove-confirm">
              <Text style={s.confirmText}>Remove the original from this phone? The sent copy and notes stay in this case. This can&apos;t be undone.</Text>
              <View style={s.row}>
                <View style={{ flex: 1 }}><Button testID="image-evidence-remove-keep" variant="secondary" label="Keep" onPress={() => setConfirmId(null)} /></View>
                <View style={{ flex: 1 }}><Button testID="image-evidence-remove-yes" variant="danger" label="Remove" onPress={() => void remove(r.id)} /></View>
              </View>
            </View>
          ) : (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Button testID="image-evidence-share" variant="secondary" label={busyId === r.id ? "Preparing…" : "Share pack"} disabled={busyId === r.id}
                  icon={<Share2 size={16} color={colors.brand} />} onPress={() => void share(r)} accessibilityHint="Creates a PDF with both images and the case notes" />
              </View>
              {r.originalUri ? (
                <View style={{ flex: 1 }}>
                  <Button testID="image-evidence-remove" variant="ghost" label="Remove original" icon={<Trash2 size={16} color={colors.brand} />} onPress={() => setConfirmId(r.id)} />
                </View>
              ) : null}
            </View>
          )}
          {error ? <Text style={s.confirmText} testID="image-evidence-error">{error}</Text> : null}
        </View>
      ))}
      <Modal visible={!!full} animationType="fade" onRequestClose={() => setFull(null)} statusBarTranslucent>
        <View style={[s.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="image-evidence-viewer">
          <View style={s.viewerBar}>
            <Text style={s.viewerTitle}>{full?.title}</Text>
            <Pressable onPress={() => setFull(null)} accessibilityRole="button" hitSlop={12} testID="image-evidence-viewer-close"><Text style={s.viewerClose}>Close</Text></Pressable>
          </View>
          {full ? <Image source={{ uri: full.uri }} style={{ flex: 1 }} resizeMode="contain" /> : null}
        </View>
      </Modal>
    </>
  );
}
