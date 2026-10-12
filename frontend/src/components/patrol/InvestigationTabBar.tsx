import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export type TabKey = "overview" | "investigation" | "evidence" | "history";

const TAB_META: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "investigation", label: "Investigation" },
  { key: "evidence", label: "Evidence" },
  { key: "history", label: "History" },
];

const useStyles = makeStyles((c) => ({
  bar: {
    flexDirection: "row",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    letterSpacing: 0.2,
  },
}));

export function InvestigationTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.bar}
    >
      {TAB_META.map((t) => {
        const active = t.key === activeTab;
        return (
          <Pressable
            key={t.key}
            testID={`tab-${t.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.label}
            onPress={() => onTabChange(t.key)}
            style={[
              s.tab,
              {
                backgroundColor: active ? colors.navyDeep : colors.surfaceTertiary,
              },
            ]}
          >
            <Text
              style={[
                s.label,
                {
                  color: active ? "#FFFFFF" : colors.onSurfaceSecondary,
                },
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
