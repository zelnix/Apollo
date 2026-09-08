// Apollo design tokens. "Light Sentinel" palette (single theme, applied in both system schemes).
// Keys match the "color" block of /app/design_guidelines.json.
// Components build styles with makeStyles() and read useTheme().colors for
// color props. Never write color literals in .tsx files.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

// "Light Sentinel": bright, clean surfaces with strong navy structure; amber / green / red are reserved for Apollo's
// security states so colour always means something.
const light = {
  surface: "#F5F7FA", // app background — neutral cool grey, not blue
  onSurface: "#0B1220", // primary navy text
  surfaceSecondary: "#FFFFFF", // primary cards
  onSurfaceSecondary: "#52606D", // secondary text
  surfaceTertiary: "#EDF2F7", // secondary surface — inputs, chips, nested fills
  onSurfaceTertiary: "#52606D",
  surfaceInverse: "#0B1220",
  onSurfaceInverse: "#F5F7FA",

  // Navigation bar: Deep Sentinel Navy structure with Brand Gold for the active tab — one of
  // Apollo's strongest branded surfaces, not neutral chrome. Icon and label use two slightly
  // different golds on purpose (see design_guidelines.json) so the active tab still reads as
  // "premium", not just "highlighted".
  nav: "#0B1220",
  navActiveIcon: "#C9A34A",
  navActiveLabel: "#E2C06B",
  navInactiveIcon: "#C3CEDA",
  navInactiveLabel: "#9EABB8",
  muted: "#52606D",

  // Premium navy accents — subtle sub-surfaces/wells/rings that give the light theme structure without darkening
  // it. Never a background for a whole screen or a whole card; only icon wells, title rows, dividers, framing.
  navyTint: "#E8EBF1",
  navyTintStrong: "#D9DFEA",
  navyBorder: "#C7CEDA",
  brandGlow: "rgba(22,34,53,0.10)", // navy at low opacity — hero halo / top-edge accents only, never a card fill

  // Structural navy scale (see design_guidelines.json "Apollo premium colour system"). navyDeep and
  // onSurface share a hex on purpose — one is "this is the brand's darkest structural navy" (nav bar,
  // strong headers), the other is "this is body/heading text" — keep them named separately so intent
  // stays clear even though the value coincides today.
  navyDeep: "#0B1220", // Deep Sentinel Navy — bottom nav, strong headers, premium framing
  navySoft: "#22324A", // Soft Navy — secondary dark surfaces

  // Brand Gold — premium accent, DELIBERATELY separate from the amber/orange Apollo STATE colours
  // below (ears_up/growling). Gold means "premium/Apollo brand"; amber/orange means "Apollo is
  // concerned". Never substitute one for the other. Use sparingly: active nav, hero framing details,
  // the Apollo animation's inner ring, selected icon accents, fine dividers — never body text, large
  // backgrounds, every button/border, or a security warning label.
  gold: "#C9A34A",
  goldHighlight: "#E2C06B", // small highlights/glow only — even more restrained than gold itself
  goldTint: "rgba(201,163,74,0.14)",
  goldBorder: "rgba(201,163,74,0.55)",

  brand: "#162235", // Apollo Navy — buttons, icon wells, section accents
  onBrand: "#FFFFFF",
  brandPrimary: "#162235", // primary CTA (navy); security states never double as CTA colours
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#EDF2F7",
  onBrandSecondary: "#0B1220",
  brandTertiary: "#FFFFFF",
  onBrandTertiary: "#0B1220",

  success: "#4FAF83", // protected green
  onSuccess: "#0B1220",
  warning: "#E8943A", // warning amber-orange
  onWarning: "#0B1220",
  error: "#D9534F", // threat red
  onError: "#FFFFFF",
  info: "#162235",
  onInfo: "#FFFFFF",

  border: "#D7E0EA",
  borderStrong: "#B9C4D1",
  divider: "#D7E0EA",

  // Apollo behaviour states
  sniffing: "#52606D", // checking, no verdict yet — neutral
  resting: "#4FAF83", // protected green
  ears_up: "#F4B942", // Apollo amber
  growling: "#E8943A", // warning amber-orange
  barking: "#D9534F", // threat red
  biting: "#D9534F",
  // Capability gaps (visibility lost / unsupported) — neutral, never "safe" green
  unknown: "#7A8794",
  // Text-safe variants of the state hues (≥ 4.5:1 on white/tints). Dots, borders and icons keep the bright hue;
  // any TEXT painted in a state colour must use these.
  sniffingText: "#3E4A56",
  restingText: "#1B6B47",
  ears_upText: "#7A5200",
  growlingText: "#9A4A0B",
  barkingText: "#B3261E",
  bitingText: "#B3261E",
  unknownText: "#54636F",

  // Translucent tints used for state-coloured fills over light surfaces (pills, stronger glow)
  sniffingTint: "rgba(82,96,109,0.14)",
  restingTint: "rgba(79,175,131,0.20)",
  ears_upTint: "rgba(244,185,66,0.26)",
  growlingTint: "rgba(232,148,58,0.20)",
  barkingTint: "rgba(217,83,79,0.16)",
  bitingTint: "rgba(217,83,79,0.16)",
  unknownTint: "rgba(122,135,148,0.16)",

  // Even lighter washes — full hero-card tint only. Card must still read as "white with a wash", not coloured.
  // Strength increases with state severity (see design_guidelines.json "State strength").
  sniffingWash: "rgba(82,96,109,0.05)",
  restingWash: "rgba(79,175,131,0.08)",
  ears_upWash: "rgba(244,185,66,0.10)",
  growlingWash: "rgba(232,148,58,0.11)",
  barkingWash: "rgba(217,83,79,0.10)",
  bitingWash: "rgba(217,83,79,0.13)",
  unknownWash: "rgba(122,135,148,0.05)",

  scrim: "rgba(11,18,32,0.55)",
  glass: "rgba(255,255,255,0.88)",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark: light };

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
