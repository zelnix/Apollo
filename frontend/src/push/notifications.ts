// Push notifications: local on-device alerts + remote Expo push token registration.
// Loading lazily keeps web/Expo Go from evaluating unavailable native notification modules.
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

import { apiPost } from "@/src/api/client";

export type NotificationStatus = "granted" | "denied" | "undetermined" | "blocked" | "unsupported";
export type LocalAlert = { title: string; body: string; channel: "threats" | "growling" | "default"; actionUrl: string };
export type PushRegistrationResult = { token: string; registered: true } | { token: null; registered: false; reason: string };

const SUPPORTED = Platform.OS !== "web" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
type NotificationsModule = typeof import("expo-notifications");
let mod: NotificationsModule | null | undefined;
let channelsReady: Promise<void> | null = null;

export function loadNotifications(): NotificationsModule | null {
  if (!SUPPORTED) return null;
  if (mod === undefined) {
    try { mod = require("expo-notifications") as NotificationsModule; } catch { mod = null; } // eslint-disable-line @typescript-eslint/no-require-imports
  }
  return mod;
}

export async function getNotificationStatus(): Promise<NotificationStatus> {
  const N = loadNotifications();
  if (!N) return "unsupported";
  const { status, canAskAgain } = await N.getPermissionsAsync();
  if (status === "granted") return "granted";
  if (status === "denied") return canAskAgain ? "denied" : "blocked";
  return "undetermined";
}

export async function requestNotificationPermission(): Promise<NotificationStatus> {
  const N = loadNotifications();
  if (!N) return "unsupported";
  const current = await N.getPermissionsAsync();
  if (current.status === "granted" || !current.canAskAgain) return getNotificationStatus();
  await ensureNotificationChannels();
  await N.requestPermissionsAsync();
  return getNotificationStatus();
}

export async function ensureNotificationChannels(): Promise<void> {
  const N = loadNotifications();
  if (!N || Platform.OS !== "android") return;
  if (!channelsReady) channelsReady = Promise.all([
    N.setNotificationChannelAsync("default", { name: "Apollo alerts", importance: N.AndroidImportance.MAX, sound: "default" }),
    N.setNotificationChannelAsync("threats", { name: "Threat alerts (Apollo barks)", importance: N.AndroidImportance.MAX, sound: "apollo_bark.wav", vibrationPattern: [0, 250, 120, 250] }),
    N.setNotificationChannelAsync("family", { name: "Family replies", importance: N.AndroidImportance.HIGH, sound: "apollo_chime.wav" }),
    N.setNotificationChannelAsync("growling", { name: "Growling nudges", importance: N.AndroidImportance.DEFAULT, sound: "default" }),
  ]).then(() => undefined).catch((error: unknown) => { channelsReady = null; throw error; });
  return channelsReady;
}

/** Schedule locally; an OS permission or scheduling failure never masquerades as delivery. */
export async function scheduleLocalAlert(alert: LocalAlert): Promise<string> {
  const N = loadNotifications();
  if (!N) throw new Error("Local notifications need an installed Apollo build.");
  await ensureNotificationChannels();
  if (await getNotificationStatus() !== "granted") throw new Error("Notification permission is not granted.");
  return N.scheduleNotificationAsync({
    content: { title: alert.title, body: alert.body, sound: Platform.OS === "ios" && alert.channel === "threats" ? "apollo_bark.wav" : "default", data: { action_url: alert.actionUrl } },
    trigger: Platform.OS === "android" ? { channelId: alert.channel } : null,
  });
}

// ------------------------------------------------------------------ remote push token registration

/** Expo project ID from app config (used to scope the push token to this project). */
const PROJECT_ID: string | undefined =
  Constants.expoConfig?.extra?.eas?.projectId ??
  (Constants.expoConfig as unknown as Record<string, unknown> | undefined)?.projectId as string | undefined;

/**
 * Request an Expo push token and register it with the backend.
 * Returns the token string on success or null on failure.
 *
 * This function is safe to call repeatedly — the backend upserts by device_id,
 * so a duplicate registration is a no-op. It never throws; callers degrade gracefully.
 *
 * Prerequisites (will return { registered: false } if unmet):
 * - Native build (not Expo Go, not web)
 * - Notification permission granted
 * - google-services.json present (Android) or APNs entitlement (iOS)
 * - EXPO_PUSH_ENABLED + EXPO_PUSH_ACCESS_TOKEN on the backend
 */
export async function registerRemotePush(): Promise<PushRegistrationResult> {
  const N = loadNotifications();
  if (!N) return { token: null, registered: false, reason: "Push tokens require a native build (not Expo Go or web)." };
  if (!PROJECT_ID) return { token: null, registered: false, reason: "Expo project ID is not configured in app.json." };

  const permStatus = await getNotificationStatus();
  if (permStatus !== "granted") return { token: null, registered: false, reason: `Notification permission is ${permStatus}.` };

  try {
    const { data: token } = await N.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    if (!token) return { token: null, registered: false, reason: "Expo returned an empty push token." };

    await apiPost("/register-push", "push_register", {
      platform: Platform.OS as string,
      provider: "expo",
      projectId: PROJECT_ID,
      device_token: token,
    });

    return { token, registered: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Push token registration failed.";
    // 503 = backend push not configured (EXPO_PUSH_ENABLED/ACCESS_TOKEN missing) — not a client error.
    return { token: null, registered: false, reason: message };
  }
}