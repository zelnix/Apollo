import { Redirect, Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
// Bottom nav uses genuine solid/filled icons (pure SVG, no native font linking — safe in Expo Go
// and web). Lucide is outline-only by design; faking "solid" with thicker strokes looks wrong, so
// Lucide stays for secondary in-screen actions only (see other screens) and never the tab bar.
import { ChatBubbleLeftRight, Cog6Tooth, Home, QueueList, ShieldCheck } from "@nandorojo/heroicons/24/solid";
import React from "react";
import { Platform, Text } from "react-native";

import { useApollo } from "@/src/store/ApolloContext";
import { fonts, useTheme } from "@/src/theme";

const isIOS26 = Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
const NAV_ICON_SIZE = 25;

export default function TabsLayout() {
  const { colors } = useTheme();
  const { ready, setupDone } = useApollo();
  if (ready && !setupDone) return <Redirect href="/onboarding" />;

  if (isIOS26) {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="home"><NativeTabs.Trigger.Icon sf="house.fill" /><NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label></NativeTabs.Trigger>
        <NativeTabs.Trigger name="guard"><NativeTabs.Trigger.Icon sf="shield.fill" /><NativeTabs.Trigger.Label>Guard</NativeTabs.Trigger.Label></NativeTabs.Trigger>
        <NativeTabs.Trigger name="patrol"><NativeTabs.Trigger.Icon sf="list.bullet.rectangle" /><NativeTabs.Trigger.Label>Patrol</NativeTabs.Trigger.Label></NativeTabs.Trigger>
        <NativeTabs.Trigger name="ask"><NativeTabs.Trigger.Icon sf="bubble.left.fill" /><NativeTabs.Trigger.Label>Higgins</NativeTabs.Trigger.Label></NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings"><NativeTabs.Trigger.Icon sf="gearshape.fill" /><NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  // Icon and label use deliberately different golds when active (Brand Gold vs. Gold Highlight) —
  // the icon alone should already make the selected tab obvious; the label is a softer echo.
  const tabIcon = (Icon: React.ComponentType<{ color?: string; width?: number; height?: number }>) =>
    function TabIcon({ focused }: { focused: boolean }) { return <Icon color={focused ? colors.navActiveIcon : colors.navInactiveIcon} width={NAV_ICON_SIZE} height={NAV_ICON_SIZE} />; };
  const tabLabel = (title: string) =>
    function TabLabel({ focused }: { focused: boolean }) { return <Text style={{ fontFamily: fonts.textSemibold, fontSize: 11, color: focused ? colors.navActiveLabel : colors.navInactiveLabel }}>{title}</Text>; };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.navyDeep, borderTopWidth: 0,
          shadowColor: "#000000", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: -3 }, elevation: 12,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarButtonTestID: "tab-home", tabBarIcon: tabIcon(Home), tabBarLabel: tabLabel("Home") }} />
      <Tabs.Screen name="guard" options={{ title: "Guard", tabBarButtonTestID: "tab-guard", tabBarIcon: tabIcon(ShieldCheck), tabBarLabel: tabLabel("Guard") }} />
      <Tabs.Screen name="patrol" options={{ title: "Patrol", tabBarButtonTestID: "tab-patrol", tabBarIcon: tabIcon(QueueList), tabBarLabel: tabLabel("Patrol") }} />
      <Tabs.Screen name="ask" options={{ title: "Higgins", tabBarButtonTestID: "tab-ask", tabBarIcon: tabIcon(ChatBubbleLeftRight), tabBarLabel: tabLabel("Higgins") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarButtonTestID: "tab-settings", tabBarIcon: tabIcon(Cog6Tooth), tabBarLabel: tabLabel("Settings") }} />
    </Tabs>
  );
}
