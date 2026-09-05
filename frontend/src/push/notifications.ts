// Alert notifications — Emergent managed push relay.
// The device token goes to our backend (/api/register-push) which forwards it to the managed
// push service; we never store it. Recipient identity = anonymous device_id.
//
// expo-notifications is loaded lazily: importing it at module scope throws inside Expo Go on
// Android (remote push was removed from Expo Go in SDK 53) and is unsupported on web.
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

import { apiPost } from "@/src/api/client";

export type PushStatus = "granted" | "denied" | "undetermined" | "blocked" | "unsupported";

export const PUSH_SUPPORTED = Platform.OS !== "web" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

type NotificationsModule = typeof import("expo-notifications");
let mod: NotificationsModule | null | undefined;

/** Returns expo-notifications only where remote push can work (dev/production builds); null in Expo Go and web. */
export function loadNotifications(): NotificationsModule | null {
  if (!PUSH_SUPPORTED) return null;
  if (mod === undefined) {
    try { mod = require("expo-notifications") as NotificationsModule; } catch { mod = null; }
  }
  return mod;
}

export async function getPushStatus(): Promise<PushStatus> {
  const N = loadNotifications();
  if (!N) return "unsupported";
  const { status, canAskAgain } = await N.getPermissionsAsync();
  if (status === "granted") return "granted";
  if (status === "denied") return canAskAgain ? "denied" : "blocked";
  return "undetermined";
}

/** Permission first, then native (FCM/APNs) token → backend relay. Re-run on every app open; tokens rotate. */
export async function registerForPush(deviceId: string, opts: { ask: boolean }): Promise<PushStatus> {
  const N = loadNotifications();
  if (!N) return "unsupported";
  let { status, canAskAgain } = await N.getPermissionsAsync();
  if (status !== "granted" && opts.ask && canAskAgain) {
    ({ status, canAskAgain } = await N.requestPermissionsAsync());
  }
  if (status !== "granted") return status === "denied" && !canAskAgain ? "blocked" : status === "denied" ? "denied" : "undetermined";
  try {
    const token = await N.getDevicePushTokenAsync();
    await apiPost("/register-push", "push_register", { user_id: deviceId, platform: Platform.OS, device_token: String(token.data) });
  } catch {
    // Offline / relay unavailable: registration retries on next launch. Never block the app.
  }
  return "granted";
}
