// Apollo Compliance Matrix — accessible from Settings → Privacy.
// Displays the compliance assessment framework, adopted standards,
// application controls and operational items in a mobile-friendly format.

import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React from "react";
import { ScrollView, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Card, Pill, SectionTitle } from "@/src/components/ui";
import { goBackOrHome } from "@/src/utils/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { COMPLIANCE_MATRIX_DISCLOSURE } from "@/src/domain/privacyInventory";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface, flex: 1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  controlItem: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  controlName: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  controlDetail: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  opsItem: { gap: 6, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  opsReq: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  opsLabel: { fontFamily: fonts.textMedium, fontSize: 12, color: c.growlingText },
  opsText: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  stdItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: c.divider },
  stdName: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface, flex: 1 },
  stdRole: { fontFamily: fonts.text, fontSize: 12, color: c.muted, flex: 1, textAlign: "right" as const },
  versionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  versionLabel: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted },
  footer: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.muted },
}));

export default function ComplianceMatrixScreen() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const data = COMPLIANCE_MATRIX_DISCLOSURE;

  return (
    <View style={s.root} testID="compliance-matrix-screen">
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title} testID="matrix-title">{data.title}</Text>
        <Pressable testID="matrix-close" accessibilityRole="button" accessibilityLabel="Close" onPress={() => goBackOrHome(router)} style={s.close}>
          <X size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="matrix-scroll">

        <Card testID="matrix-version" style={{ gap: spacing.sm }}>
          <View style={s.versionRow}>
            <Text style={s.versionLabel}>Version {data.version}</Text>
            <Text style={s.versionLabel}>Effective {data.effective}</Text>
          </View>
          <Body>{data.framework}</Body>
        </Card>

        <View>
          <SectionTitle>Adopted standards</SectionTitle>
          <Card testID="matrix-standards" style={{ gap: 0 }}>
            {data.standards.map((std) => (
              <View key={std.name} style={s.stdItem}>
                <Text style={s.stdName}>{std.name}</Text>
                <Text style={s.stdRole}>{std.role}</Text>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>Application controls</SectionTitle>
          <Body>Controls Apollo implements directly, verified through source-code review, automated tests or device testing.</Body>
          <Card testID="matrix-app-controls" style={{ gap: 0, marginTop: spacing.sm }}>
            {data.appControls.map((ctrl, i) => (
              <View key={ctrl.control} style={s.controlItem} testID={`matrix-ctrl-${i}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={s.controlName}>{ctrl.control}</Text>
                  <Pill tone="resting" label="Implemented" testID={`matrix-ctrl-status-${i}`} />
                </View>
                <Text style={s.controlDetail}>{ctrl.detail}</Text>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>What code alone cannot complete</SectionTitle>
          <Body>These requirements have completed application controls. The organisational obligations remain under Harmony Wellness Group&apos;s accountability.</Body>
          <Card testID="matrix-ops-items" style={{ gap: 0, marginTop: spacing.sm }}>
            {data.operationalItems.map((item, i) => (
              <View key={item.requirement} style={s.opsItem} testID={`matrix-ops-${i}`}>
                <Text style={s.opsReq}>{item.requirement}</Text>
                <View>
                  <Text style={s.opsLabel}>What Apollo does</Text>
                  <Text style={s.opsText}>{item.appDoes}</Text>
                </View>
                <View>
                  <Text style={s.opsLabel}>What remains outside the app</Text>
                  <Text style={s.opsText}>{item.outsideApp}</Text>
                </View>
              </View>
            ))}
          </Card>
        </View>

        <View>
          <SectionTitle>Verification</SectionTitle>
          <Card testID="matrix-tests" style={{ gap: spacing.sm }}>
            <Body>{data.testSummary}</Body>
          </Card>
        </View>

        <Text style={s.footer}>Accountable organisation: Harmony Wellness Group (HWG). Full compliance matrix maintained in Apollo&apos;s compliance documentation.</Text>
      </ScrollView>
    </View>
  );
}
