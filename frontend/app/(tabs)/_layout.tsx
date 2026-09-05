import { Redirect, Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import House from "lucide-react-native/icons/house";
import MessageCircle from "lucide-react-native/icons/message-circle";
import ScrollText from "lucide-react-native/icons/scroll-text";
import Settings from "lucide-react-native/icons/settings";
import Shield from "lucide-react-native/icons/shield";
import React from "react";
import { Platform } from "react-native";

import { useApollo } from "@/src/store/ApolloContext";
import { fonts, useTheme } from "@/src/theme";

const isIOS26 = Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

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
        <NativeTabs.Trigger name="ask"><NativeTabs.Trigger.Icon sf="bubble.left.fill" /><NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label></NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings"><NativeTabs.Trigger.Icon sf="gearshape.fill" /><NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label></NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.onSurface,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surfaceSecondary, borderTopColor: colors.border, ...(Platform.OS === "web" ? { height: 64 } : {}) },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.textMedium, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarButtonTestID: "tab-home", tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
      <Tabs.Screen name="guard" options={{ title: "Guard", tabBarButtonTestID: "tab-guard", tabBarIcon: ({ color, size }) => <Shield color={color} size={size} /> }} />
      <Tabs.Screen name="patrol" options={{ title: "Patrol", tabBarButtonTestID: "tab-patrol", tabBarIcon: ({ color, size }) => <ScrollText color={color} size={size} /> }} />
      <Tabs.Screen name="ask" options={{ title: "Ask", tabBarButtonTestID: "tab-ask", tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarButtonTestID: "tab-settings", tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }} />
    </Tabs>
  );
}
