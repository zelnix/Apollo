import React from "react";
import { Pressable, Text, View } from "react-native";
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
    flexDirection: "row" as const,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.pill,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  label: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    letterSpacing: 0.1,
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
    <View style={s.bar}>
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
                backgroundColor: active
                  ? colors.navyDeep
                  : colors.surfaceTertiary,
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
              numberOfLines={1}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
