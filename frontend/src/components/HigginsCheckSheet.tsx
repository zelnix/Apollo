/**
 * HigginsCheckSheet — Bottom sheet that opens when the user taps the
 * attachment/action button in Ask Higgins.
 *
 * Presents the six protection categories as the entry point for
 * user-initiated checks through Higgins:
 *   1. Screenshot (first-class, top option)
 *   2. Websites & Links
 *   3. Messages & Calls
 *   4. Email & Accounts
 *   5. Apps & Files
 *   6. Device & Internet
 *
 * After selecting a category, the user is guided to provide the relevant
 * artifact (image, URL, message text, etc.). Higgins then routes to the
 * correct investigation gate.
 */

import Camera from "lucide-react-native/icons/camera";
import FileSearch from "lucide-react-native/icons/file-search";
import Globe from "lucide-react-native/icons/globe";
import Mail from "lucide-react-native/icons/mail";
import Phone from "lucide-react-native/icons/phone";
import Smartphone from "lucide-react-native/icons/smartphone";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { Sheet } from "./Sheet";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// ── Category definitions ────────────────────────────────────────────────────

export type HigginsCheckCategory =
  | "screenshot"
  | "websites_links"
  | "messages_calls"
  | "email_accounts"
  | "apps_files"
  | "device_internet";

interface CategoryItem {
  id: HigginsCheckCategory;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  bg: string;
}

const CATEGORIES: CategoryItem[] = [
  {
    id: "screenshot",
    label: "Screenshot",
    description: "Select a screenshot and ask Higgins to check it",
    icon: Camera,
    bg: "#E09430",
  },
  {
    id: "websites_links",
    label: "Websites & Links",
    description: "Paste or share a URL for Higgins to investigate",
    icon: Globe,
    bg: "#2E9E6B",
  },
  {
    id: "messages_calls",
    label: "Messages & Calls",
    description: "Share a message, number or call details",
    icon: Phone,
    bg: "#7C5CBF",
  },
  {
    id: "email_accounts",
    label: "Email & Accounts",
    description: "Provide an email or account-related information",
    icon: Mail,
    bg: "#3B82C4",
  },
  {
    id: "apps_files",
    label: "Apps & Files",
    description: "Choose an app, file, download or attachment",
    icon: FileSearch,
    bg: "#1A8D8D",
  },
  {
    id: "device_internet",
    label: "Device & Internet",
    description: "Run a device or network diagnostic check",
    icon: Smartphone,
    bg: "#5A6B7B",
  },
];

const useStyles = makeStyles((c) => ({
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    minHeight: 60,
  },
  categoryIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryContent: {
    flex: 1,
    gap: 2,
  },
  categoryLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 16,
    color: c.onSurface,
  },
  categoryDesc: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    color: c.onSurfaceSecondary,
  },
}));

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (category: HigginsCheckCategory) => void;
}

export function HigginsCheckSheet({ visible, onClose, onSelect }: Props) {
  const s = useStyles();
  const { colors } = useTheme();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="What do you want to check?"
      testID="higgins-check-sheet"
    >
      {CATEGORIES.map((cat) => {
        const Icon = cat.icon;
        return (
          <Pressable
            key={cat.id}
            testID={`higgins-check-${cat.id}`}
            accessibilityRole="button"
            accessibilityLabel={cat.label}
            accessibilityHint={cat.description}
            onPress={() => {
              onClose();
              onSelect(cat.id);
            }}
            style={({ pressed }) => [
              s.categoryRow,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={[s.categoryIcon, { backgroundColor: cat.bg }]}>
              <Icon size={22} color="#FFFFFF" />
            </View>
            <View style={s.categoryContent}>
              <Text style={s.categoryLabel}>{cat.label}</Text>
              <Text style={s.categoryDesc}>{cat.description}</Text>
            </View>
          </Pressable>
        );
      })}
    </Sheet>
  );
}

export { CATEGORIES };
