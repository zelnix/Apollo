/**
 * Device Capabilities, as tables grouped by category.
 *
 * One table per category — Calls and messages, Apps on this device, Web and network, Who can get in,
 * Updates and system, If it is lost or stolen — each holding everything that covers that ground:
 *   • the protections this device runs itself (the provider owns the row, so its name and its state
 *     label are printed verbatim), then
 *   • the capabilities Apollo looks for there, with the one status a real read produced. A failed
 *     read stays "Apollo couldn't check"; it is never shown as clear.
 *
 * Every row is a link into Capability Details, which answers what it is, how it helps, and whether
 * anything needs doing.
 */
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import React from "react";
import { Pressable, Text, View } from "react-native";

import {
  CAPABILITY_CLASS_LABEL, PROTECTION_AREA_LABEL, PROTECTION_AREA_ORDER,
  type CapabilityClass,
  type CapabilityRow,
  type DeviceProtectionRow,
  type DeviceProtectionState,
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

function protectionTone(state: DeviceProtectionState, c: ThemeColors): Tone {
  switch (state) {
    case "active": return { dot: c.resting, text: c.restingText };
    case "as_recommended": return { dot: c.resting, text: c.restingText };
    case "installed_not_default": return { dot: c.gold, text: c.onSurface };
    case "off": return { dot: c.biting, text: c.bitingText };
    case "not_readable_here": return { dot: c.muted, text: c.unknownText };
    case "out_of_date": return { dot: c.growling, text: c.growlingText };
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

interface AreaItem {
  id: string;
  name: string;
  sub?: string;
  statusLabel: string;
  tone: Tone;
  hint: string;
}

/**
 * One table per category, each holding everything in that category: the protections the device runs
 * itself, then the capabilities Apollo looks for there. A protection keeps its owner's state label,
 * a capability keeps its class — the two vocabularies stay distinct inside one list.
 */
export function DeviceAreaTables({
  protections, capabilities, testID,
}: { protections: DeviceProtectionRow[]; capabilities: CapabilityRow[]; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();

  const groups = PROTECTION_AREA_ORDER.map((area) => ({
    area,
    label: PROTECTION_AREA_LABEL[area],
    items: [
      ...protections.filter((p) => p.area === area).map<AreaItem>((p) => ({
        id: p.id, name: p.title, sub: p.subtitle, statusLabel: p.stateLabel,
        tone: protectionTone(p.state, colors),
        hint: "Opens what this is, how it helps you, and how to check it",
      })),
      ...capabilities.filter((c) => c.area === area).map<AreaItem>((c) => ({
        id: c.id, name: c.title, statusLabel: CAPABILITY_CLASS_LABEL[c.klass],
        tone: capabilityTone(c.klass, colors),
        hint: "Opens what this is, how it helps you, and anything you need to do",
      })),
    ],
  })).filter((group) => group.items.length > 0);

  const classes = CLASS_ORDER.filter((k) => capabilities.some((c) => c.klass === k));
  let index = 0;

  return (
    <View style={{ gap: spacing.lg }}>
      {groups.map((group) => (
        <Table key={group.area} nameHeading={group.label} testID={`${testID}-${group.area}`}>
          {group.items.map((item) => {
            const i = index++;
            return (
              <RowShell
                key={`${group.area}:${item.id}`}
                name={item.name}
                sub={item.sub}
                statusLabel={item.statusLabel}
                tone={item.tone}
                onPress={() => router.push({ pathname: "/capability/[id]", params: { id: item.id } })}
                trailing={<ChevronRight size={16} color={colors.muted} style={{ marginTop: 2 }} />}
                accessibilityHint={item.hint}
                testID={`${testID}-${i}`}
              />
            );
          })}
        </Table>
      ))}

      {classes.length ? (
        <View style={s.legend} testID={`${testID}-legend`}>
          {classes.map((klass) => {
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
      ) : null}
    </View>
  );
}
