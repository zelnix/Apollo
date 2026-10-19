// Saved App Reports — list of saved App Gate investigations with inline full detail. On-device only.
import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { deleteAppReport, listAppReports } from "@/src/store/appReportStore";
import type { AppReportSnapshot } from "@/src/domain/appReport";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.lg },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.md },
  reportTitle: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  heading: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.muted, marginTop: spacing.xs },
  line: { fontFamily: fonts.text, fontSize: 14, lineHeight: 21, color: c.onSurface },
  remove: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
}));

function Sec({ title, lines, styles: s, testID }: { title: string; lines: string[]; styles: ReturnType<typeof useStyles>; testID: string }) {
  if (!lines.length) return null;
  return <View style={{ gap: 2 }} testID={testID}><Text style={s.heading}>{title}</Text>{lines.map((l, i) => <Text key={i} style={s.line}>• {l}</Text>)}</View>;
}

export default function AppReportsScreen() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const [items, setItems] = useState<AppReportSnapshot[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { void listAppReports().then(setItems); }, []);
  const remove = async (id: string) => { setItems(await deleteAppReport(id)); if (openId === id) setOpenId(null); };

  return <View style={s.root} testID="app-reports-screen">
    <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
      <Text style={s.title} testID="app-reports-title">Saved app checks</Text>
      <Pressable testID="app-reports-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
    </View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="app-reports-scroll">
      {items.length === 0 ? <Card testID="app-reports-empty"><Body>No app checks saved yet. Run an app check and tap &quot;Save this check&quot; to keep it here.</Body></Card> : items.map((r) => {
        const open = openId === r.id;
        return <Card key={r.id} testID={`app-report-${r.id}`} style={{ gap: spacing.sm }}>
          <Pressable accessibilityRole="button" onPress={() => setOpenId(open ? null : r.id)}>
            <View style={s.row}><Text style={s.reportTitle} numberOfLines={open ? undefined : 1}>{r.appLabel}</Text><Pill tone={r.state} label={r.stateName} testID={`app-report-${r.id}-state`} /></View>
            <Body>{new Date(r.savedAt).toLocaleString()} · {r.title}</Body>
          </Pressable>
          {open ? <View style={{ gap: spacing.sm }} testID={`app-report-${r.id}-detail`}>
            <Body>{r.verdict}</Body>
            <SectionTitle>What to do</SectionTitle><Body>{r.recommendation}</Body>
            <Sec title="Identity & provenance" lines={r.identity} styles={s} testID={`app-report-${r.id}-identity`} />
            <Sec title="Permissions & access" lines={r.permissions} styles={s} testID={`app-report-${r.id}-perms`} />
            <Sec title="Why Apollo looked at it" lines={r.why} styles={s} testID={`app-report-${r.id}-why`} />
            <Sec title="Network" lines={r.network} styles={s} testID={`app-report-${r.id}-network`} />
            {r.reputation ? <Sec title="Reputation" lines={[r.reputation]} styles={s} testID={`app-report-${r.id}-rep`} /> : null}
            <Sec title="Evidence & detection methods" lines={r.evidence} styles={s} testID={`app-report-${r.id}-evidence`} />
            <Sec title="Findings & severity" lines={[`Apollo status: ${r.stateName}`, `Scenario reference: ${r.scenario}`, `Risk score: ${r.riskScore}/100`]} styles={s} testID={`app-report-${r.id}-severity`} />
            <Sec title="Confidence, coverage & limits" lines={r.coverage} styles={s} testID={`app-report-${r.id}-coverage`} />
            <Button testID={`app-report-${r.id}-delete`} variant="ghost" label="Delete this saved check" onPress={() => void remove(r.id)} />
          </View> : null}
        </Card>;
      })}
    </ScrollView>
  </View>;
}
