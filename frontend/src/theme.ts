// Design tokens for this app. Light theme only.Always modify the colors and theme to Dark, Light or Dark and Light according to the design guidelines.
//
// The keys match the "color" block of /app/design_guidelines.json. Fill the
// values from that file (or from the user's brand colors). Keep every key; do
// not add a second theme or colors file; do not write color literals in
// components.
//
// How the names work: a plain key is a background, and its `on` partner is the
// text or icon color that sits on top of it. Always use them as a pair.
//   <View style={{ backgroundColor: colors.brandPrimary }}>
//     <Text style={{ color: colors.onBrandPrimary }}>Continue</Text>
//   </View>
//
// Styling a screen or component: build the sheet with makeStyles so colors
// and layout live together and follow the active scheme:
//   const useStyles = makeStyles((colors) => ({
//     card: { backgroundColor: colors.surfaceSecondary, padding: 16 },
//     title: { color: colors.onSurfaceSecondary, fontSize: 16 },
//   }));
//   function Screen() {
//     const styles = useStyles();
//     return <View style={styles.card}><Text style={styles.title}>Hi</Text></View>;
//   }
// For color props that are not styles (icon color, placeholderTextColor,
// ActivityIndicator) read useTheme().colors inside the component.
// Never call StyleSheet.create with color values at module level; it cannot
// follow the scheme.
//
// To support dark mode later: add `dark` to `themes` with every key filled.
// Nothing else changes; the device setting takes over automatically.
// Feel free to add as many new colors as you need to support the design guidelines.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#F6F7F9",
  onSurface: "#0F172A",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1E293B",
  surfaceTertiary: "#E9EDF3",
  onSurfaceTertiary: "#475569",
  surfaceInverse: "#0B1220",
  onSurfaceInverse: "#F8FAFC",
  muted: "#64748B",

  brand: "#0B1220",
  onBrand: "#F8FAFC",
  brandPrimary: "#0B1220",
  onBrandPrimary: "#F8FAFC",
  brandSecondary: "#F59E0B",
  onBrandSecondary: "#0B1220",
  brandTertiary: "#FEF3C7",
  onBrandTertiary: "#78350F",

  success: "#15803D",
  onSuccess: "#FFFFFF",
  warning: "#B45309",
  onWarning: "#FFFFFF",
  error: "#B91C1C",
  onError: "#FFFFFF",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",

  border: "#DDE3EC",
  borderStrong: "#B8C2D1",
  divider: "#E6EAF0",
};

const dark: ThemeColors = {
  surface: "#0B1220",
  onSurface: "#F1F5F9",
  surfaceSecondary: "#111B2E",
  onSurfaceSecondary: "#E2E8F0",
  surfaceTertiary: "#1A2740",
  onSurfaceTertiary: "#B6C2D3",
  surfaceInverse: "#F8FAFC",
  onSurfaceInverse: "#0B1220",
  muted: "#8B99AE",

  brand: "#F59E0B",
  onBrand: "#0B1220",
  brandPrimary: "#F59E0B",
  onBrandPrimary: "#0B1220",
  brandSecondary: "#1A2740",
  onBrandSecondary: "#F1F5F9",
  brandTertiary: "#2A2113",
  onBrandTertiary: "#FCD34D",

  success: "#4ADE80",
  onSuccess: "#052E16",
  warning: "#FBBF24",
  onWarning: "#1F1300",
  error: "#F87171",
  onError: "#2A0A0A",
  info: "#60A5FA",
  onInfo: "#0B1220",

  border: "#22304A",
  borderStrong: "#334A6E",
  divider: "#1C2A44",
};

export type ThemeColors = typeof light;

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

// In-app theme toggle, only after `dark` exists in `themes`. Call
// setColorScheme("dark"), setColorScheme("light"), or setColorScheme(null) to
// follow the device. Every useTheme() consumer re-renders. Persisting the
// choice and re-applying it on launch is the toggle's job.
export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}

// Keep native surfaces (alerts, pickers, navigation chrome) on the schemes this
// app ships: light only forces light; once `dark` exists the device decides.
// Optional call because react-native-web does not implement it.
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

// Themed StyleSheet: returns a hook that builds the sheet from the active
// scheme's colors and memoizes it until the scheme changes.
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}


