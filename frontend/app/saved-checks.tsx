// Saved Checks — list of saved link / message / internet checks with inline full detail. On-device only.
import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { GATE_LABEL, type SavedCheck } from "@/src/domain/savedCheck";
import { deleteSavedCheck, listSavedChecks } from "@/src/store/savedCheckStore";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.lg },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.md },
  reportTitle: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface, flex: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  heading: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.muted, marginTop: spacing.xs },
  line: { fontFamily: fonts.text, fontSize: 14, lineHeight: 21, color: c.onSurface },
}));

export default function SavedChecksScreen() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const [items, setItems] = useState<SavedCheck[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { void listSavedChecks().then(setItems); }, []);
  const remove = async (id: string) => { setItems(await deleteSavedCheck(id)); if (openId === id) setOpenId(null); };

  return <View style={s.root} testID="saved-checks-screen">
    <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
      <Text style={s.title} testID="saved-checks-title">Saved checks</Text>
      <Pressable testID="saved-checks-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
    </View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="saved-checks-scroll">
      {items.length === 0 ? <Card testID="saved-checks-empty"><Body>No checks saved yet. Run a link, message or internet check and tap &quot;Save this check&quot; to keep it here.</Body></Card> : items.map((r) => {
        const open = openId === r.id;
        return <Card key={r.id} testID={`saved-check-${r.id}`} style={{ gap: spacing.sm }}>
          <Pressable accessibilityRole="button" onPress={() => setOpenId(open ? null : r.id)}>
            <View style={s.row}><Text style={s.reportTitle} numberOfLines={open ? undefined : 1}>{r.title}</Text><Pill tone={r.state} label={r.stateName} testID={`saved-check-${r.id}-state`} /></View>
            <Body>{GATE_LABEL[r.gate]} · {r.subject} · {new Date(r.savedAt).toLocaleString()}</Body>
          </Pressable>
          {open ? <View style={{ gap: spacing.sm }} testID={`saved-check-${r.id}-detail`}>
            <Body>{r.summary}</Body>
            <SectionTitle>What to do</SectionTitle><Body>{r.recommendation}</Body>
            {r.sections.map((sec, i) => <View key={i} style={{ gap: 2 }} testID={`saved-check-${r.id}-section-${i}`}><Text style={s.heading}>{sec.title}</Text>{sec.lines.map((l, j) => <Text key={j} style={s.line}>• {l}</Text>)}</View>)}
            <Button testID={`saved-check-${r.id}-delete`} variant="ghost" label="Delete this saved check" onPress={() => void remove(r.id)} />
          </View> : null}
        </Card>;
      })}
    </ScrollView>
  </View>;
}
