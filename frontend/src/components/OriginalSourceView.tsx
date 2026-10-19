// Renders the saved original source exactly as captured — never analysis or generated content.
import React, { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";

import { getOriginalSource, subscribeOriginalSource, type OriginalSource } from "@/src/store/originalSource";
import { fonts, makeStyles, radius, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  wrap: { gap: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm },
  label: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary, width: 84 },
  value: { flex: 1, fontFamily: fonts.text, fontSize: 14, color: c.onSurface },
  box: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md },
  text: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontSize: 12, lineHeight: 18, color: c.onSurface },
  note: { fontFamily: fonts.text, fontSize: 12, fontStyle: "italic", color: c.muted },
}));

/** Loads the original for the first key that has one. Renders `fallback` when none was saved. */
export function OriginalSourceView({ caseKeys, fallback }: { caseKeys: (string | null | undefined)[]; fallback?: React.ReactNode }) {
  const s = useStyles();
  const [src, setSrc] = useState<OriginalSource | null | undefined>(undefined);
  const joined = caseKeys.filter(Boolean).join("|");

  useEffect(() => {
    const load = async () => {
      for (const k of joined.split("|").filter(Boolean)) { const r = await getOriginalSource(k); if (r) { setSrc(r); return; } }
      setSrc(null);
    };
    void load();
    return subscribeOriginalSource(() => void load());
  }, [joined]);

  if (src === undefined) return null;
  if (!src) return <>{fallback ?? null}</>;
  return (
    <View style={s.wrap} testID="tc-evidence-original-source">
      {src.fields?.map((f) => (
        <View key={f.label} style={s.row}><Text style={s.label}>{f.label}</Text><Text style={s.value} selectable>{f.value}</Text></View>
      ))}
      {src.url ? <View style={s.box}><Text style={s.text} selectable testID="tc-evidence-original-url">{src.url}</Text></View> : null}
      {src.text ? <View style={s.box}><Text style={s.text} selectable testID="tc-evidence-original-text">{src.text}</Text></View> : null}
      {src.data !== undefined && src.data !== null ? (
        <View style={s.box}><Text style={s.mono} selectable testID="tc-evidence-original-data">{JSON.stringify(src.data, null, 2)}</Text></View>
      ) : null}
      <Text style={s.note}>
        {src.origin === "this_device" ? "Captured on this device" : "Saved to this device from the investigation"} · {new Date(src.capturedAt).toLocaleString()} · shown unaltered
      </Text>
    </View>
  );
}
