// Apollo design tokens. Dark ("sentinel") theme only, per design_guidelines.json.
// Keys match the "color" block of /app/design_guidelines.json.
// Components build styles with makeStyles() and read useTheme().colors for
// color props. Never write color literals in .tsx files.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#0B1220", // Sentinel Navy — main background
  onSurface: "#F4F7FA", // Soft White — primary text
  surfaceSecondary: "#141A22", // Deep Charcoal — cards / panels
  onSurfaceSecondary: "#9EABB8", // Muted Silver — secondary text on cards
  surfaceTertiary: "#1C242F", // inputs, chips, nested fills
  onSurfaceTertiary: "#9EABB8",
  surfaceInverse: "#F4F7FA",
  onSurfaceInverse: "#0B1220",
  muted: "#9EABB8",

  brand: "#263241", // Slate
  onBrand: "#F4F7FA",
  brandPrimary: "#4FAF83", // primary CTA (resting green)
  onBrandPrimary: "#0B1220",
  brandSecondary: "#141A22",
  onBrandSecondary: "#F4F7FA",
  brandTertiary: "#1C242F",
  onBrandTertiary: "#F4F7FA",

  success: "#4FAF83",
  onSuccess: "#0B1220",
  warning: "#D9A441",
  onWarning: "#0B1220",
  error: "#D9534F",
  onError: "#0B1220",
  info: "#4FAF83",
  onInfo: "#0B1220",

  border: "#263241",
  borderStrong: "#3A4B5F",
  divider: "#263241",

  // Apollo behaviour states
  resting: "#4FAF83",
  growling: "#D9A441",
  barking: "#E47A3F",
  biting: "#D9534F",
  // Capability gaps (visibility lost / unsupported) — neutral, never "safe" green
  unknown: "#6F7F91",

  // Translucent tints used for state-coloured fills over dark surfaces
  restingTint: "rgba(79,175,131,0.14)",
  growlingTint: "rgba(217,164,65,0.16)",
  barkingTint: "rgba(228,122,63,0.16)",
  bitingTint: "rgba(217,83,79,0.16)",
  unknownTint: "rgba(111,127,145,0.16)",
  scrim: "rgba(11,18,32,0.72)",
  glass: "rgba(20,26,34,0.82)",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light: dark, dark };

export const fonts = {
  display: "Outfit-600",
  displayBold: "Outfit-700",
  displayMedium: "Outfit-500",
  text: "Geist-400",
  textMedium: "Geist-500",
  textSemibold: "Geist-600",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 } as const;
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme as ColorScheme);
}

setColorScheme?.(defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && system !== "unspecified" && themes[system as ColorScheme] ? (system as ColorScheme) : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
