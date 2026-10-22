/**
 * Device Capabilities, as a table.
 *
 * Two tables, both read-only views of real reads:
 *   • `NativeProtectionTable` — the protection this device provides itself. The provider owns the
 *     row, so the provider's name is the row name and its state label is printed verbatim.
 *   • `CapabilityTable` — every capability Apollo looks for, with the one status a real read
 *     produced. A failed read stays "Apollo couldn't check"; it is never shown as clear.
 *
 * A capability row is a link: tapping it opens Capability Details, which answers what it is, how it
 * helps, and whether anything needs doing. Native protection rows open in place, because everything
 * their provider reports is already on the row.
 */
import { useRouter } from "expo-router";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import React, { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  CAPABILITY_CLASS_LABEL,
  type CapabilityClass,
  type CapabilityRow,
  type NativeProtectionRow,
  type NativeProtectionState,
} from "@/src/domain/deviceCapabilities";
import { fonts, makeStyles, radius, spacing, useTheme, type ThemeColors } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  table: { borderWidth: 0.5, borderColor: c.border, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", backgroundColor: c.surfaceTertiary, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: spacing.sm },
  headCell: { fontFamily: fonts.textSemibold, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", color: c.muted },

  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: spacing.sm, borderTopWidth: 0.5, borderTopColor: c.divider },
  name: { fontFamily: fonts.textSemibold, fontSize: 13.5, lineHeight: 19, color: c.onSurface },
  sub: { fontFamily: fonts.text, fontSize: 11, lineHeight: 16, color: c.muted, marginTop: 2 },

  statusCell: { width: 118, flexDirection: "row", alignItems: "flex-start", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  statusText: { fontFamily: fonts.textMedium, fontSize: 11, lineHeight: 15, flex: 1 },

  detailWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: 2, gap: spacing.xs, backgroundColor: c.surface },
  detail: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.onSurfaceSecondary },
  attr: { fontFamily: fonts.text, fontSize: 11, lineHeight: 16, color: c.muted },

  legend: { marginTop: spacing.sm, gap: 6 },
  legendRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  legendLabel: { fontFamily: fonts.textSemibold, fontSize: 11, lineHeight: 16 },
  legendText: { fontFamily: fonts.text, fontSize: 11, lineHeight: 16, color: c.muted, flex: 1 },
}));

type Tone = { dot: string; text: string };

function capabilityTone(klass: CapabilityClass, c: ThemeColors): Tone {
  switch (klass) {
    case "apollo_can_use": return { dot: c.resting, text: c.restingText };
    case "permission_required": return { dot: c.gold, text: c.onSurface };
    case "unknown": return { dot: c.growling, text: c.growlingText };
    default: return { dot: c.muted, text: c.unknownText };
  }
}

function nativeTone(state: NativeProtectionState, c: ThemeColors): Tone {
  switch (state) {
    case "active": return { dot: c.resting, text: c.restingText };
    case "installed_not_default": return { dot: c.gold, text: c.onSurface };
    case "unknown": return { dot: c.growling, text: c.growlingText };
    default: return { dot: c.muted, text: c.unknownText };
  }
}

/** What each status means. No status implies anything beyond what the read actually said. */
const LEGEND: Record<CapabilityClass, string> = {
  apollo_can_use: "Apollo has this and uses it when it checks something for you.",
  permission_required: "Apollo can use it once you allow it, and asks at the moment it is needed.",
  not_exposed: "Your device handles this itself and keeps it private. Apollo will not guess at it.",
  unavailable: "This phone has nothing Apollo can use for it.",
  unknown: "Apollo asked and the read failed. Unknown — not an all-clear.",
  not_readable_here: "Apollo is not running on your phone here, so it could not read this.",
};

const CLASS_ORDER: CapabilityClass[] = ["apollo_can_use", "permission_required", "not_exposed", "unknown", "not_readable_here", "unavailable"];

/** Shared table shell: a header row, then the rows. */
function Table({ nameHeading, children, testID }: { nameHeading: string; children: React.ReactNode; testID: string }) {
  const s = useStyles();
  return (
    <View style={s.table} testID={testID}>
      <View style={s.head}>
        <Text style={[s.headCell, { flex: 1 }]}>{nameHeading}</Text>
        <Text style={[s.headCell, { width: 118 }]}>Status</Text>
      </View>
      {children}
    </View>
  );
}

function RowShell({
  name, sub, statusLabel, tone, onPress, trailing, accessibilityHint, accessibilityState, testID,
}: {
  name: string; sub?: string; statusLabel: string; tone: Tone;
  onPress: () => void; trailing: React.ReactNode;
  accessibilityHint: string; accessibilityState?: { expanded: boolean }; testID: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={`${name}. ${statusLabel}.`}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [s.row, { backgroundColor: pressed ? colors.surfaceTertiary : "transparent" }]}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.name}>{name}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
      <View style={s.statusCell}>
        <View style={[s.dot, { backgroundColor: tone.dot }]} />
        <Text style={[s.statusText, { color: tone.text }]} testID={`${testID}-status`}>{statusLabel}</Text>
      </View>
      {trailing}
    </Pressable>
  );
}

/** The protection built into this device. Every row stays attributed to its provider. */
export function NativeProtectionTable({ rows, testID }: { rows: NativeProtectionRow[]; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = useCallback((id: string) => setOpen((cur) => (cur === id ? null : id)), []);
  return (
    <Table nameHeading="Built into this device" testID={testID}>
      {rows.map((row, i) => {
        const isOpen = open === row.id;
        const Chevron = isOpen ? ChevronUp : ChevronDown;
        return (
          <View key={row.id} testID={`${testID}-${i}`}>
            <RowShell
              name={row.provider}
              sub={row.feature}
              statusLabel={row.stateLabel}
              tone={nativeTone(row.state, colors)}
              onPress={() => toggle(row.id)}
              trailing={<Chevron size={16} color={colors.muted} style={{ marginTop: 2 }} />}
              accessibilityHint={isOpen ? "Hides the detail" : "Shows what this protection does"}
              accessibilityState={{ expanded: isOpen }}
              testID={`${testID}-${i}-toggle`}
            />
            {isOpen ? (
              <View style={s.detailWrap} testID={`${testID}-${i}-detail`}>
                <Text style={s.detail}>{row.detail}</Text>
                {row.evidenceLine ? <Text style={s.attr}>{row.evidenceLine}</Text> : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </Table>
  );
}

/** Every capability Apollo looks for, with the status a real read produced. Each row is a link. */
export function CapabilityTable({ rows, testID }: { rows: CapabilityRow[]; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const present = CLASS_ORDER.filter((k) => rows.some((r) => r.klass === k));
  return (
    <>
      <Table nameHeading="What Apollo looks for" testID={testID}>
        {rows.map((row, i) => (
          <RowShell
            key={row.id}
            name={row.title}
            statusLabel={CAPABILITY_CLASS_LABEL[row.klass]}
            tone={capabilityTone(row.klass, colors)}
            onPress={() => router.push({ pathname: "/capability/[id]", params: { id: row.id } })}
            trailing={<ChevronRight size={16} color={colors.muted} style={{ marginTop: 2 }} />}
            accessibilityHint="Opens what this is, how it helps you, and anything you need to do"
            testID={`${testID}-${i}`}
          />
        ))}
      </Table>
      <View style={s.legend} testID={`${testID}-legend`}>
        {present.map((klass) => {
          const tone = capabilityTone(klass, colors);
          return (
            <View key={klass} style={s.legendRow}>
              <View style={[s.dot, { backgroundColor: tone.dot, marginTop: 5 }]} />
              <Text style={s.legendText}>
                <Text style={[s.legendLabel, { color: tone.text }]}>{CAPABILITY_CLASS_LABEL[klass]} — </Text>
                {LEGEND[klass]}
              </Text>
            </View>
          );
        })}
      </View>
    </>
  );
}
