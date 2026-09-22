import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { SafeStartScreen } from "@/src/components/SafeStartScreen";
import { ToastHost } from "@/src/components/Toast";
import { loadNotifications } from "@/src/push/notifications";
import { queryClient } from "@/src/query-client";
import { getSecurityBootError } from "@/src/security/securityBoot";
import { ShareIntakeListener } from "@/src/share/ShareIntakeListener";
import { ApolloProvider } from "@/src/store/ApolloContext";
import { useTheme } from "@/src/theme";

LogBox.ignoreAllLogs(true);
void SplashScreen.preventAutoHideAsync().catch(() => {});

// Security boot boundary: if any security selector failed validation during module evaluation, the app
// must not mount. Evaluated once — configuration is baked into the build.
const SECURITY_BOOT_ERROR = getSecurityBootError();

// Alert notifications — module scope so the handler/channel exist before any push arrives.
// `loadNotifications()` is null on web and in Expo Go (remote push needs a native build).
const Notifications = loadNotifications();
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === "android") {
    // Channels are frozen once created on-device; sound/priority live here, not in the payload.
    void Notifications.setNotificationChannelAsync("default", { name: "Apollo alerts", importance: Notifications.AndroidImportance.MAX, sound: "default" });
    void Notifications.setNotificationChannelAsync("threats", { name: "Threat alerts (Apollo barks)", importance: Notifications.AndroidImportance.MAX, sound: "apollo_bark.wav", vibrationPattern: [0, 250, 120, 250] });
    void Notifications.setNotificationChannelAsync("family", { name: "Family replies", importance: Notifications.AndroidImportance.HIGH, sound: "apollo_chime.wav" });
    void Notifications.setNotificationChannelAsync("growling", { name: "Growling nudges", importance: Notifications.AndroidImportance.DEFAULT, sound: "default" });
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
    if (!Notifications || SECURITY_BOOT_ERROR) return;
    // Warm tap (app open / backgrounded)
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromNotification(router, response.notification.request.content.data as Record<string, unknown>);
    });
    // Cold start tap (app was killed)
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openFromNotification(router, response.notification.request.content.data as Record<string, unknown>);
    });
    return () => { tapSub.remove(); };
  }, [router]);

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
  // Fail closed, visibly: no providers, no navigation, no protection start-up behind this screen.
  if (SECURITY_BOOT_ERROR) return <SafeStartScreen error={SECURITY_BOOT_ERROR} />;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
          <SafeAreaProvider>
            <KeyboardProvider>
              <ApolloProvider>
                <StatusBar style="dark" />
                {/* Tablet/desktop: readable column width on wide windows (phones unaffected). Navigation stays identical across form factors. */}
                <View style={{ flex: 1, width: "100%", maxWidth: 1180, alignSelf: "center" }}>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="onboarding" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="settings/index" options={{ presentation: "modal" }} />
                  <Stack.Screen name="higgins/history" />
                  <Stack.Screen name="higgins/learning" />
                  <Stack.Screen name="higgins/scams" />
                  <Stack.Screen name="check" options={{ presentation: "modal" }} />
                  <Stack.Screen name="message" options={{ presentation: "modal" }} />
                  <Stack.Screen name="call" options={{ presentation: "modal" }} />
                  <Stack.Screen name="scan" options={{ presentation: "modal" }} />
                  <Stack.Screen name="file" options={{ presentation: "modal" }} />
                  <Stack.Screen name="app-check" options={{ presentation: "modal" }} />
                  <Stack.Screen name="device" options={{ presentation: "modal" }} />
                  <Stack.Screen name="network" options={{ presentation: "modal" }} />
                  <Stack.Screen name="account" options={{ presentation: "modal" }} />
                  <Stack.Screen name="email" options={{ presentation: "modal" }} />
                  <Stack.Screen name="share" options={{ presentation: "modal" }} />
                  <Stack.Screen name="patrol/scent/[id]" options={{ presentation: "modal" }} />
                  <Stack.Screen name="patrol/[id]" options={{ presentation: "modal" }} />
                  <Stack.Screen name="benchmark" options={{ presentation: "modal" }} />
                  <Stack.Screen name="privacy-disclosure" options={{ presentation: "modal" }} />
                  <Stack.Screen name="support" options={{ presentation: "modal" }} />
                  <Stack.Screen name="digest" options={{ presentation: "modal" }} />
                  <Stack.Screen name="family" options={{ presentation: "modal" }} />
                  <Stack.Screen name="family/alert/[id]" options={{ presentation: "modal" }} />
                  <Stack.Screen name="family/incident/[id]" options={{ presentation: "modal" }} />
                </Stack>
                </View>
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
