import { QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Alert, LogBox, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { ToastHost } from "@/src/components/Toast";
import { loadNotifications } from "@/src/push/notifications";
import { queryClient } from "@/src/query-client";
import { ShareIntakeListener } from "@/src/share/ShareIntakeListener";
import { ApolloProvider } from "@/src/store/ApolloContext";
import { useTheme } from "@/src/theme";

LogBox.ignoreAllLogs(true);
void SplashScreen.preventAutoHideAsync().catch(() => {});

// Alert notifications — module scope so the handler/channel exist before any push arrives.
// `loadNotifications()` is null on web and in Expo Go (remote push needs a native build).
const Notifications = loadNotifications();
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === "android") {
    void Notifications.setNotificationChannelAsync("default", { name: "Apollo alerts", importance: Notifications.AndroidImportance.MAX, sound: "default" });
  }
}

function openFromNotification(router: ReturnType<typeof useRouter>, data: Record<string, unknown> | undefined) {
  const url = (data?.deeplink ?? data?.action_url) as string | undefined;
  if (!url) return;
  if (url.startsWith("http")) void Linking.openURL(url);
  else router.push(url as never);
}

export default function RootLayout() {
  const { colors } = useTheme();
  const router = useRouter();
  const [loaded] = useFonts({
    "Outfit-500": require("../assets/fonts/Outfit-500.ttf"),
    "Outfit-600": require("../assets/fonts/Outfit-600.ttf"),
    "Outfit-700": require("../assets/fonts/Outfit-700.ttf"),
    "Geist-400": require("../assets/fonts/Geist-400.ttf"),
    "Geist-500": require("../assets/fonts/Geist-500.ttf"),
    "Geist-600": require("../assets/fonts/Geist-600.ttf"),
  });
  useEffect(() => { if (loaded) void SplashScreen.hideAsync().catch(() => {}); }, [loaded]);

  useEffect(() => {
    if (!Notifications) return;
    // Warm tap (app open / backgrounded)
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromNotification(router, response.notification.request.content.data as Record<string, unknown>);
    });
    // Cold start tap (app was killed)
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openFromNotification(router, response.notification.request.content.data as Record<string, unknown>);
    });
    // Weekly nudge when notifications are blocked at the OS level.
    (async () => {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status !== "denied" || canAskAgain) return;
      const last = await AsyncStorage.getItem("pushNudgeAt");
      if (last && Date.now() - Number(last) <= 7 * 24 * 60 * 60 * 1000) return;
      const stamp = () => AsyncStorage.setItem("pushNudgeAt", String(Date.now()));
      Alert.alert("Apollo can't bark when the app is closed", "Notifications are off. Turn them on so you hear about threats the moment they happen.", [
        { text: "Later", style: "cancel", onPress: () => void stamp() },
        { text: "Open Settings", onPress: () => { void stamp(); void Linking.openSettings(); } },
      ]);
    })();
    return () => { tapSub.remove(); };
  }, [router]);

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
          <SafeAreaProvider>
            <KeyboardProvider>
              <ApolloProvider>
                <StatusBar style="light" />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="onboarding" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="check" options={{ presentation: "modal" }} />
                  <Stack.Screen name="patrol/[id]" options={{ presentation: "modal" }} />
                  <Stack.Screen name="dev-tools" options={{ presentation: "modal" }} />
                  <Stack.Screen name="benchmark" options={{ presentation: "modal" }} />
                  <Stack.Screen name="privacy-disclosure" options={{ presentation: "modal" }} />
                  <Stack.Screen name="digest" options={{ presentation: "modal" }} />
                  <Stack.Screen name="family" options={{ presentation: "modal" }} />
                </Stack>
                <ShareIntakeListener />
                <ToastHost />
              </ApolloProvider>
            </KeyboardProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
