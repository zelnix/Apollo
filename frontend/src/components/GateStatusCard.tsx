import ChevronRight from "lucide-react-native/icons/chevron-right";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Body, Card, Pill } from "@/src/components/ui";
import { gateStatusTone, type GateItem } from "@/src/domain/gates";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  card: { gap: spacing.sm }, row: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, icon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: c.navyTint },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface }, mode: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurfaceSecondary },
  setup: { fontFamily: fonts.textMedium, fontSize: 14, lineHeight: 20, color: c.barking }, action: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm },
  actionText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
}));

export function GateStatusCard({ gate, icon, onAction }: { gate: GateItem; icon: ReactNode; onAction: () => void }) {
  const s = useStyles(); const { colors } = useTheme();
  return <Card testID={`gate-${gate.id}-card`} style={s.card}>
    <View style={s.row}><View style={s.icon}>{icon}</View><Text testID={`gate-${gate.id}-title`} style={s.title}>{gate.title}</Text>
      <Pill testID={`gate-${gate.id}-status`} tone={gateStatusTone(gate.status)} label={gate.status} /></View>
    <Text testID={`gate-${gate.id}-mode`} style={s.mode}>{gate.mode}</Text>
    <Body testID={`gate-${gate.id}-scope`}>{gate.scope}</Body>
    {gate.setup ? <Text testID={`gate-${gate.id}-setup`} style={s.setup}>{gate.setup}</Text> : null}
    <Pressable testID={`gate-${gate.id}-action`} accessibilityRole="button" onPress={onAction} style={s.action}>
      <Text style={s.actionText}>{gate.actionLabel}</Text><ChevronRight size={18} color={colors.brand} />
    </Pressable>
  </Card>;
}