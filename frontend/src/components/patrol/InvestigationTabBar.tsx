import React from "react";
import { Pressable, Text, View } from "react-native";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

export type TabKey = "overview" | "evidence" | "history";

const TAB_META: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Briefing" },
  { key: "evidence", label: "Evidence" },
  { key: "history", label: "History" },
];

const useStyles = makeStyles((c) => ({
  wrapper: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  container: {
    flexDirection: "row" as const,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  label: {
    fontFamily: fonts.textSemibold,
    fontSize: 12,
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
    <View style={s.wrapper}>
      <View style={s.container}>
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
                    ? "#1E3A5F"
                    : "#D4D8DE",
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
    </View>
  );
}
