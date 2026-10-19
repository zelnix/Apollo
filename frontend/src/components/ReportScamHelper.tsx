// Report Scam Helper: official reporting contacts for the chosen region + the named bank/brand.
import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import Check from "lucide-react-native/icons/check";

import { brandContact, loadReportRegion, OFFICIAL_REPORTING, REPORT_REGIONS, saveReportRegion, type ReportContact, type ReportRegion } from "@/src/domain/reportingContacts";
import { loadReportProgress, setReportStep, type ReportProgress, type ReportStep } from "@/src/store/reportProgress";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const STEPS: { id: ReportStep; label: string }[] = [
  { id: "calledBank", label: "Called bank" },
  { id: "reportedPolice", label: "Reported to police" },
];

const useStyles = makeStyles((c) => ({
  wrap: { borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, backgroundColor: c.surfaceSecondary },
  title: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  sub: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  progressHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44, paddingVertical: spacing.xs },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: c.brand, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: c.brand },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: 18, borderWidth: 1, borderColor: c.border, justifyContent: "center" },
  chipOn: { backgroundColor: c.brand, borderColor: c.brand },
  chipText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurface },
  chipTextOn: { color: c.onBrandPrimary },
  section: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurfaceSecondary, marginTop: spacing.xs },
  item: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm, gap: 2 },
  name: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  links: { flexDirection: "row", gap: spacing.lg, marginTop: 2 },
  link: { fontFamily: fonts.textMedium, fontSize: 14, color: c.brandPrimary, paddingVertical: spacing.xs },
}));

function Contact({ c, testID }: { c: ReportContact; testID: string }) {
  const s = useStyles();
  return (
    <View style={s.item} testID={testID}>
      <Text style={s.name}>{c.name}</Text>
      <Text style={s.sub}>{c.detail}</Text>
      <View style={s.links}>
        {c.url ? <Pressable accessibilityRole="link" hitSlop={6} onPress={() => void Linking.openURL(c.url!)} testID={`${testID}-web`}><Text style={s.link}>Website →</Text></Pressable> : null}
        {c.phone ? <Pressable accessibilityRole="button" accessibilityLabel={`Call ${c.name} on ${c.phone}`} hitSlop={6} onPress={() => void Linking.openURL(`tel:${c.phone!.replace(/\s/g, "")}`)} testID={`${testID}-call`}><Text style={s.link}>Call {c.phone}</Text></Pressable> : null}
      </View>
    </View>
  );
}

export function ReportScamHelper({ brand, caseKey }: { brand: string | null; caseKey: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [region, setRegion] = useState<ReportRegion | null>(null);
  const [progress, setProgress] = useState<ReportProgress>({});
  useEffect(() => { void loadReportRegion().then(setRegion); }, []);
  useEffect(() => { void loadReportProgress(caseKey).then(setProgress); }, [caseKey]);
  const bank = brandContact(brand);
  if (!region) return null;

  const toggle = async (step: ReportStep) => setProgress(await setReportStep(caseKey, step, !progress[step]));
  const doneCount = STEPS.filter((st) => progress[st.id]).length;

  return (
    <View style={s.wrap} testID="report-scam-helper">
      <Text style={s.title}>Where to report this</Text>
      <Text style={s.sub}>If you lost money or shared details, contact your bank first, then report it. Share the evidence pack with them.</Text>
      <View style={s.progressHead}>
        <Text style={s.section}>Your progress</Text>
        <Text style={s.sub} testID="report-progress-count">{doneCount} of {STEPS.length} done</Text>
      </View>
      {STEPS.map((st) => {
        const at = progress[st.id];
        return (
          <Pressable key={st.id} accessibilityRole="checkbox" accessibilityState={{ checked: !!at }} style={s.step}
            onPress={() => void toggle(st.id)} testID={`report-step-${st.id}`}>
            <View style={[s.box, at && s.boxOn]}>{at ? <Check size={16} color={colors.onBrandPrimary} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{st.label}</Text>
              {at ? <Text style={s.sub}>Done {new Date(at).toLocaleString()}</Text> : null}
            </View>
          </Pressable>
        );
      })}
      {bank ? <>
        <Text style={s.section}>Company named in this case</Text>
        <Contact c={bank} testID="report-brand" />
      </> : <Text style={s.sub}>Your bank: call the number on the back of your card or use its official app.</Text>}
      <Text style={s.section}>Police and government</Text>
      <View style={s.chips} accessibilityRole="tablist">
        {REPORT_REGIONS.map((r) => {
          const on = r.id === region;
          return (
            <Pressable key={r.id} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.chip, on && s.chipOn]}
              onPress={() => { setRegion(r.id); void saveReportRegion(r.id); }} testID={`report-region-${r.id}`}>
              <Text style={[s.chipText, on && s.chipTextOn]}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {OFFICIAL_REPORTING[region].map((c, i) => <Contact key={c.name} c={c} testID={`report-official-${i}`} />)}
    </View>
  );
}
