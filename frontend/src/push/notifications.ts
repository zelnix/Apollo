// Local, on-device alerts only. Never request a remote token or register this device for remote push.
// Loading lazily keeps web/Expo Go from evaluating unavailable native notification modules.
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

export type NotificationStatus = "granted" | "denied" | "undetermined" | "blocked" | "unsupported";
export type LocalAlert = { title: string; body: string; channel: "threats" | "growling" | "default"; actionUrl: string };

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