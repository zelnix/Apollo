// Visually distinct classification badge for patrol records.
// Each classification type gets its own icon, color scheme, and label
// to make the record type immediately scannable.

import Archive from "lucide-react-native/icons/archive";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Info from "lucide-react-native/icons/info";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import ShieldMinus from "lucide-react-native/icons/shield-minus";
import Stethoscope from "lucide-react-native/icons/stethoscope";
import React from "react";
import { Text, View } from "react-native";

import type { RecordClass } from "@/src/domain/types";
import { fonts, makeStyles, spacing, useTheme, type ThemeColors } from "@/src/theme";

interface ClassConfig {
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  bg: (c: ThemeColors) => string;
  fg: (c: ThemeColors) => string;
  iconColor: (c: ThemeColors) => string;
}

const CLASS_CONFIG: Record<RecordClass, ClassConfig> = {
  security_threat: {
    label: "Security threat",
    icon: ShieldAlert,
    bg: (c) => c.barkingTint,
    fg: (c) => c.barkingText,
    iconColor: (c) => c.barking,
  },
  threat_stopped: {
    label: "Threat stopped",
    icon: ShieldCheck,
    bg: (c) => c.bitingTint,
    fg: (c) => c.bitingText,
    iconColor: (c) => c.biting,
  },
  protection_issue: {
    label: "Protection issue",
    icon: CircleAlert,
    bg: (c) => c.growlingTint,
    fg: (c) => c.growlingText,
    iconColor: (c) => c.growling,
  },
  reduced_protection: {
    label: "Reduced protection",
    icon: ShieldMinus,
    bg: (c) => c.ears_upTint,
    fg: (c) => c.ears_upText,
    iconColor: (c) => c.ears_up,
  },
  diagnostic_result: {
    label: "Diagnostic",
    icon: Stethoscope,
    bg: (c) => c.sniffingTint,
    fg: (c) => c.sniffingText,
    iconColor: (c) => c.sniffing,
  },
  informational: {
    label: "Informational",
    icon: Info,
    bg: (c) => c.unknownTint,
    fg: (c) => c.onSurfaceSecondary,
    iconColor: (c) => c.onSurfaceSecondary,
  },
  resolved: {
    label: "Resolved",
    icon: CircleCheck,
    bg: (c) => c.restingTint,
    fg: (c) => c.restingText,
    iconColor: (c) => c.resting,
  },
  unverifiable_legacy: {
    label: "Legacy record",
    icon: Archive,
    bg: (c) => c.unknownTint,
    fg: (c) => c.onSurfaceSecondary,
    iconColor: (c) => c.unknown,
  },
};

const useStyles = makeStyles(() => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  label: {
    fontFamily: fonts.textSemibold,
    fontSize: 11,
    letterSpacing: 0.2,
    lineHeight: 16,
  },
}));

/**
 * Compact classification badge with icon.
 * Shows the record's classification with a color-coded icon and label.
 * Use `compact` prop on PatrolItem list view, full label on detail view.
 */
export function ClassBadge({ recordClass, compact = false, testID }: {
  recordClass: RecordClass;
  compact?: boolean;
  testID?: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const config = CLASS_CONFIG[recordClass];
  if (!config) return null;

  const Icon = config.icon;
  const bg = config.bg(colors);
  const fg = config.fg(colors);
  const ic = config.iconColor(colors);

  return (
    <View testID={testID} accessibilityLabel={config.label} style={[s.badge, { backgroundColor: bg }]}>
      <Icon size={12} color={ic} />
      {!compact ? <Text style={[s.label, { color: fg }]}>{config.label}</Text> : null}
    </View>
  );
}

/** Get the border accent color for a classification (used on cards). */
export function classBorderColor(colors: ThemeColors, recordClass?: RecordClass | null): string | undefined {
  if (!recordClass) return undefined;
  const config = CLASS_CONFIG[recordClass];
  return config ? config.iconColor(colors) : undefined;
}
