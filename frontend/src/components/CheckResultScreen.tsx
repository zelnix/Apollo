// Universal Check Result screen component. Apollo investigates. Higgins explains. ONE result,
// ONE explanation. Every Apollo Gate (Link / Site / Text / Call / Internet / App / Device / Email /
// File / Account, plus Higgins First Check and Re-check) renders its manual-check outcome through
// this single component — no competing verdict cards, no auto-asked follow-up questions, no
// repetition. Technical evidence stays accessible through progressive disclosure.

import { useRouter } from "expo-router";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill } from "@/src/components/ui";
import { HigginsSpeakButton } from "@/src/components/HigginsSpeakButton";
import type { CheckItem, CheckResultModel } from "@/src/domain/checkResult";
import { STATUS_LABEL, STATUS_TONE } from "@/src/domain/checkResult";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  checkType: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary, marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing["3xl"] },

  sectionLabel: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted, textTransform: "uppercase" },
  headline: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28, color: c.onSurface, letterSpacing: -0.3 },
  higginsText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },

  itemRow: { gap: 4, paddingVertical: spacing.sm },
  itemDivider: { borderTopWidth: 1, borderTopColor: c.divider },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "space-between" },
  itemName: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  itemFinding: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  itemRaw: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary, backgroundColor: c.surfaceTertiary, borderRadius: radius.sm, padding: spacing.sm },

  disclosureBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  disclosureLabel: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },

  evidenceRow: { paddingVertical: spacing.xs, flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  evidenceLabel: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.muted, minWidth: 110 },
  evidenceValue: { flex: 1, fontFamily: fonts.text, fontSize: 13, color: c.onSurface },

  secondary: { gap: spacing.sm },
}));

export interface CheckResultScreenProps {
  result: CheckResultModel;
  /** Optional secondary actions (Ask Higgins / Save / Report / Recover / etc.) — rendered as a
   *  single row of buttons below the main result. Keep to 3–4 at most. */
  actions?: { label: string; onPress: () => void; testID: string; variant?: "primary" | "secondary" | "ghost" }[];
  /** Optional "Ask Higgins" handler — if provided, renders a prominent single tap-through. */
  onAskHiggins?: () => void;
  /** Optional close override — defaults to goBackOrHome. */
  onClose?: () => void;
}

export function CheckResultScreen({ result, actions = [], onAskHiggins, onClose }: CheckResultScreenProps) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [itemsOpen, setItemsOpen] = useState<Record<string, boolean>>({});
  const [fullOpen, setFullOpen] = useState(false);

  const toggleItem = (id: string) => setItemsOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  const close = () => (onClose ? onClose() : goBackOrHome(router));

  const spokenText = `${result.headline}. ${result.higginsSays}${result.whatToDo ? ` What to do: ${result.whatToDo}` : ""}`;

  return (
    <View style={s.root} testID="check-result-screen">
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{result.gate}</Text>
          <Text style={s.checkType}>{result.checkType}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={close}
          style={s.close}
          testID="check-result-close"
        >
          <X size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing["3xl"] }]}
        testID="check-result-scroll"
      >
        {/* ONE outcome. ONE Higgins paragraph. No duplicate verdict cards. */}
        <Card style={{ gap: spacing.md }} testID="check-result-main">
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
            <Pill tone={result.tone} label={result.checkType} testID="check-result-tone" />
            <Pill tone="neutral" label={`Confidence: ${result.confidence}`} testID="check-result-confidence" />
          </View>
          <Text style={s.headline} testID="check-result-headline">{result.headline}</Text>

          <View style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
              <Text style={s.sectionLabel}>HIGGINS SAYS</Text>
              <HigginsSpeakButton compact text={spokenText} testID="check-result-hear-higgins" />
            </View>
            <Text style={s.higginsText} testID="check-result-higgins">{result.higginsSays}</Text>
          </View>

          {result.whatToDo ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={s.sectionLabel}>WHAT TO DO</Text>
              <Text style={s.higginsText} testID="check-result-whattodo">{result.whatToDo}</Text>
            </View>
          ) : null}
        </Card>

        {/* "What Apollo checked" — plain-English list; each item expandable to raw details. */}
        <Card style={{ gap: 0 }} testID="check-result-items">
          <Text style={[s.sectionLabel, { marginBottom: spacing.xs }]}>WHAT APOLLO CHECKED</Text>
          {result.items.length === 0 ? (
            <Body>Apollo did not record any check items.</Body>
          ) : (
            result.items.map((item, i) => (
              <CheckItemRow
                key={item.id}
                item={item}
                open={!!itemsOpen[item.id]}
                onToggle={() => toggleItem(item.id)}
                showDivider={i > 0}
              />
            ))
          )}
          <Text style={[s.checkType, { marginTop: spacing.sm }]}>Completed {new Date(result.completedAt).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</Text>
        </Card>

        {/* Progressive disclosure — full investigation / technical evidence lives here, not above. */}
        {result.evidence.length > 0 ? (
          <Card style={{ gap: spacing.sm }} testID="check-result-full">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fullOpen ? "Hide full investigation" : "Show full investigation"}
              onPress={() => setFullOpen((prev) => !prev)}
              style={s.disclosureBtn}
              testID="check-result-full-toggle"
            >
              <Text style={s.disclosureLabel}>Full investigation details</Text>
              {fullOpen ? <ChevronUp size={18} color={colors.onSurface} /> : <ChevronDown size={18} color={colors.onSurface} />}
            </Pressable>
            {fullOpen ? (
              <View style={{ gap: spacing.xs }}>
                {result.evidence.map((row, i) => (
                  <View key={i} style={s.evidenceRow}>
                    <Text style={s.evidenceLabel}>{row.label}</Text>
                    <Text style={s.evidenceValue} testID={`check-result-evidence-${i}`}>{row.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* Secondary row — Ask Higgins + any gate-specific extras (Save, Report, Recover). */}
        {onAskHiggins || actions.length > 0 ? (
          <View style={s.secondary}>
            {onAskHiggins ? (
              <Button
                testID="check-result-ask-higgins"
                variant="secondary"
                label="Ask Higgins about this result"
                onPress={onAskHiggins}
              />
            ) : null}
            {actions.map((a) => (
              <Button
                key={a.testID}
                testID={a.testID}
                label={a.label}
                variant={a.variant ?? "ghost"}
                onPress={a.onPress}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Render the `raw` payload as a human-readable string. Special-cases known shapes
 *  (urls, permissions, settings) so the person never sees raw JSON. */
function formatRaw(raw: Record<string, unknown>): string {
  // URLs list (from message/text gate links)
  if (Array.isArray(raw.urls) && raw.urls.length > 0) {
    return (raw.urls as string[]).map((u, i) => `${i + 1}. ${u}`).join("\n");
  }
  // Key-value pairs (settings, permissions, etc.)
  const entries = Object.entries(raw).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length > 0 && entries.every(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
    return entries.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("\n");
  }
  // Fallback — still avoid raw JSON; show a flat summary
  return entries.map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n");
}

function CheckItemRow({ item, open, onToggle, showDivider }: { item: CheckItem; open: boolean; onToggle: () => void; showDivider: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const hasRaw = !!item.raw && Object.keys(item.raw).length > 0;
  return (
    <Pressable
      accessibilityRole={hasRaw ? "button" : undefined}
      accessibilityLabel={`${item.name}: ${STATUS_LABEL[item.status]}`}
      onPress={hasRaw ? onToggle : undefined}
      disabled={!hasRaw}
      style={[s.itemRow, showDivider && s.itemDivider]}
      testID={`check-item-${item.id}`}
    >
      <View style={s.itemHeader}>
        <Text style={s.itemName}>{item.name}</Text>
        <Pill tone={STATUS_TONE[item.status]} label={STATUS_LABEL[item.status]} testID={`check-item-${item.id}-status`} />
      </View>
      {item.finding ? <Text style={s.itemFinding}>{item.finding}</Text> : null}
      {hasRaw ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
          <Text style={[s.checkType, { fontSize: 12 }]}>{open ? "Hide details" : "Show details"}</Text>
          {open ? <ChevronUp size={12} color={colors.onSurfaceSecondary} /> : <ChevronDown size={12} color={colors.onSurfaceSecondary} />}
        </View>
      ) : null}
      {open && hasRaw ? (
        <Text style={s.itemRaw}>{formatRaw(item.raw)}</Text>
      ) : null}
    </Pressable>
  );
}
