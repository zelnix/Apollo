import { Redirect, Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
// Bottom nav uses genuine solid/filled icons (pure SVG, no native font linking — safe in Expo Go
// and web). Lucide is outline-only by design; faking "solid" with thicker strokes looks wrong, so
// Lucide stays for secondary in-screen actions only (see other screens) and never the tab bar.
import { ChatBubbleLeftRight, Home, Megaphone, ShieldExclamation, BookOpen } from "@nandorojo/heroicons/24/solid";
import React from "react";
import { Platform, Text, useWindowDimensions } from "react-native";

import { useApollo } from "@/src/store/ApolloContext";
import { useAccountMonitorDueCheck } from "@/src/hooks/useAccountMonitorDueCheck";
import { fonts, useTheme } from "@/src/theme";

const isIOS26 = Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
const NAV_ICON_SIZE = 25;
const TAB_COUNT = 5;

// Tab order: Home → Threats → Alerts → Higgins → Learn
// Hidden tabs (accessible via routes but not in the tab bar): check-it, guard, protection, settings
export default function TabsLayout() {
  const { colors } = useTheme();
  const { width: screenW } = useWindowDimensions();
  const { ready, setupDone } = useApollo();
  useAccountMonitorDueCheck();
  if (ready && !setupDone) return <Redirect href="/onboarding" />;

  if (isIOS26) {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="home"><NativeTabs.Trigger.Icon sf="house.fill" /><NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label></NativeTabs.Trigger>
        <NativeTabs.Trigger name="patrol"><NativeTabs.Trigger.Icon sf="exclamationmark.shield.fill" /><NativeTabs.Trigger.Label>Threats</NativeTabs.Trigger.Label></NativeTabs.Trigger>
        <NativeTabs.Trigger name="scams"><NativeTabs.Trigger.Icon sf="megaphone.fill" /><NativeTabs.Trigger.Label>Alerts</NativeTabs.Trigger.Label></NativeTabs.Trigger>
        <NativeTabs.Trigger name="ask"><NativeTabs.Trigger.Icon sf="bubble.left.fill" /><NativeTabs.Trigger.Label>Ask Higgins</NativeTabs.Trigger.Label></NativeTabs.Trigger>
        <NativeTabs.Trigger name="learn"><NativeTabs.Trigger.Icon sf="book.fill" /><NativeTabs.Trigger.Label>Learn</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  // Icon and label use deliberately different golds when active (Brand Gold vs. Gold Highlight) —
  // the icon alone should already make the selected tab obvious; the label is a softer echo.
  const tabIcon = (Icon: React.ComponentType<{ color?: string; width?: number; height?: number }>) =>
    function TabIcon({ focused }: { focused: boolean }) { return <Icon color={focused ? colors.navActiveIcon : colors.navInactiveIcon} width={NAV_ICON_SIZE} height={NAV_ICON_SIZE} />; };
  // One line on every phone: the label never wraps. Its size follows the column width (a fifth of the bar,
  // less the tab's 5pt side padding; "Ask Higgins" is ~6 font-px per point at this weight), so it fits on
  // narrow phones too; a large system text size is capped for the same reason.
  const labelSize = Math.max(9, Math.min(11, (screenW / TAB_COUNT - 10) / 6.1));
  const tabLabel = (title: string) =>
    function TabLabel({ focused }: { focused: boolean }) {
      return (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          maxFontSizeMultiplier={1.2}
          style={{ fontFamily: fonts.textSemibold, fontSize: labelSize, textAlign: "center", marginTop: 2, color: focused ? colors.navActiveLabel : colors.navInactiveLabel }}
        >
          {title}
        </Text>
      );
    };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.navyDeep, borderTopWidth: 0,
          shadowColor: "#000000", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: -3 }, elevation: 12,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        // Five equal columns, so the items sit evenly spaced across every screen width.
        tabBarItemStyle: { alignSelf: "center" },
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarButtonTestID: "tab-home", tabBarIcon: tabIcon(Home), tabBarLabel: tabLabel("Home") }} />
      <Tabs.Screen name="patrol" options={{ title: "Threats", tabBarButtonTestID: "tab-threats", tabBarIcon: tabIcon(ShieldExclamation), tabBarLabel: tabLabel("Threats") }} />
      <Tabs.Screen name="scams" options={{ title: "Alerts", tabBarButtonTestID: "tab-scams", tabBarIcon: tabIcon(Megaphone), tabBarLabel: tabLabel("Alerts") }} />
      <Tabs.Screen name="ask" options={{ title: "Ask Higgins", tabBarButtonTestID: "tab-ask", tabBarIcon: tabIcon(ChatBubbleLeftRight), tabBarLabel: tabLabel("Ask Higgins") }} />
      <Tabs.Screen name="learn" options={{ title: "Learn", tabBarButtonTestID: "tab-learn", tabBarIcon: tabIcon(BookOpen), tabBarLabel: tabLabel("Learn") }} />
      {/* Hidden tabs — still routable for deep links and backwards compatibility */}
      <Tabs.Screen name="check-it" options={{ href: null }} />
      <Tabs.Screen name="guard" options={{ href: null }} />
      <Tabs.Screen name="protection" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
