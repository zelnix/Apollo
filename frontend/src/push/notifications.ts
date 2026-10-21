// Push notifications: local on-device alerts + registration with Apollo's managed push relay.
// Loading lazily keeps web/Expo Go from evaluating unavailable native notification modules.
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

import { apiGet, apiPost, apiPostEmpty } from "@/src/api/client";

export type NotificationStatus = "granted" | "denied" | "undetermined" | "blocked" | "unsupported";
export type LocalAlert = { title: string; body: string; channel: "apollo_alerts" | "family"; actionUrl: string };
export type PushRegistrationResult = { token: string; registered: true } | { token: null; registered: false; reason: string };

// ── Channel consolidation ────────────────────────────────────────────────────
// All production Apollo notifications route through a single "Apollo alerts" channel.
// Family Help screen sharing retains its own channel (Android foreground service requirement).
// Legacy channels are explicitly deleted so existing installations don't retain confusing categories.
const APOLLO_ALERTS_CHANNEL = "apollo_alerts";
const FAMILY_CHANNEL = "family";
/** Legacy channels to delete on migration. */
const LEGACY_CHANNELS = ["default", "threats", "growling", "apollo_text_guard"];

export { APOLLO_ALERTS_CHANNEL };

/** Detailed notification health: OS permission + channel-level status. */
export interface NotificationHealth {
  /** OS-level notification permission. */
  permission: NotificationStatus;
  /** Whether the Apollo alerts channel specifically is enabled (Android only). */
  alertsChannelEnabled: boolean | null;
  /** Whether notifications are fully working (permission granted + channel enabled). */
  fullyEnabled: boolean;
  /** Human-readable reason if not fully enabled. */
  disabledReason: string | null;
}

/**
 * Check both OS notification permission AND the Apollo alerts channel status.
 * On iOS, only OS permission matters. On Android, the user can disable individual channels.
 */
export async function getNotificationHealth(): Promise<NotificationHealth> {
  const permission = await getNotificationStatus();

  if (permission === "unsupported") {
    return { permission, alertsChannelEnabled: null, fullyEnabled: false, disabledReason: "Notifications are not supported on this platform." };
  }

  if (permission !== "granted") {
    return {
      permission,
      alertsChannelEnabled: null,
      fullyEnabled: false,
      disabledReason: permission === "blocked"
        ? "Notification permission is blocked. Open device Settings to re-enable it."
        : "Notification permission has not been granted. Apollo needs notifications to alert you about threats.",
    };
  }

  // OS permission is granted — now check if the Apollo alerts channel is enabled (Android)
  if (Platform.OS === "android") {
    const N = loadNotifications();
    if (N) {
      try {
        await ensureNotificationChannels();
        const channel = await N.getNotificationChannelAsync(APOLLO_ALERTS_CHANNEL);
        if (channel && channel.importance === N.AndroidImportance.NONE) {
          return {
            permission: "granted",
            alertsChannelEnabled: false,
            fullyEnabled: false,
            disabledReason: "The Apollo alerts notification category is turned off. Open notification settings and enable the \"Apollo alerts\" category.",
          };
        }
        return { permission: "granted", alertsChannelEnabled: channel ? true : null, fullyEnabled: true, disabledReason: null };
      } catch {
        // Can't check channel — assume OK if OS permission is granted
        return { permission: "granted", alertsChannelEnabled: null, fullyEnabled: true, disabledReason: null };
      }
    }
  }

  // iOS or no native module — OS permission is sufficient
  return { permission: "granted", alertsChannelEnabled: null, fullyEnabled: true, disabledReason: null };
}

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
  if (!channelsReady) channelsReady = (async () => {
    // Step 1: Create the single consolidated "Apollo alerts" channel
    await N.setNotificationChannelAsync(APOLLO_ALERTS_CHANNEL, {
      name: "Apollo alerts",
      importance: N.AndroidImportance.MAX,
      sound: "default",
      description: "All Apollo scam protection alerts, warnings, and notifications.",
    });

    // Step 2: Preserve Family channel only — it's a genuinely separate notification
    // system (Family Help replies) requiring independent user control.
    await N.setNotificationChannelAsync(FAMILY_CHANNEL, {
      name: "Family replies",
      importance: N.AndroidImportance.HIGH,
      sound: "apollo_chime.wav",
      description: "Replies and updates from Apollo Family Help.",
    });

    // Step 3: Migration — delete legacy channels so existing installations don't
    // retain confusing obsolete categories. Android permits deleting channels that
    // were previously created. If the channel doesn't exist, the call is a no-op.
    for (const legacyId of LEGACY_CHANNELS) {
      try { await N.deleteNotificationChannelAsync(legacyId); } catch { /* channel may not exist — safe to ignore */ }
    }
  })().catch((error: unknown) => { channelsReady = null; throw error; });
  return channelsReady;
}

/** Schedule locally; an OS permission or scheduling failure never masquerades as delivery. */
export async function scheduleLocalAlert(alert: LocalAlert): Promise<string> {
  const N = loadNotifications();
  if (!N) throw new Error("Local notifications need an installed Apollo build.");
  await ensureNotificationChannels();
  if (await getNotificationStatus() !== "granted") throw new Error("Notification permission is not granted.");
  // Route all alerts through the consolidated channel. Family uses its own channel.
  const channelId = alert.channel === "family" ? FAMILY_CHANNEL : APOLLO_ALERTS_CHANNEL;
  return N.scheduleNotificationAsync({
    content: { title: alert.title, body: alert.body, sound: "default", data: { action_url: alert.actionUrl } },
    trigger: Platform.OS === "android" ? { channelId } : null,
  });
}

// ------------------------------------------------------------------ remote push registration

/**
 * Register this device's native push token (FCM on Android, APNs on iOS) with Apollo's servers,
 * which forward it to the managed alert relay. The relay resolves the token from the installation id
 * at send time, so Apollo's own database never stores it.
 *
 * Safe to call repeatedly — the backend upserts by device, so a duplicate registration is a no-op,
 * and tokens rotate, so re-registering on every app open is intended. It never throws.
 *
 * Prerequisites (will return { registered: false } with the real reason if unmet):
 * - Native build (not Expo Go, not web)
 * - Notification permission granted
 * - google-services.json present (Android) or APNs key uploaded at build time (iOS)
 * - The managed alert key on the backend, which the build pipeline fills in at publish time
 */
export async function registerRemotePush(): Promise<PushRegistrationResult> {
  const N = loadNotifications();
  if (!N) return { token: null, registered: false, reason: "Push tokens require a native build (not Expo Go or web)." };

  const permStatus = await getNotificationStatus();
  if (permStatus !== "granted") return { token: null, registered: false, reason: `Notification permission is ${permStatus}.` };

  try {
    const { data: token } = await N.getDevicePushTokenAsync();
    if (!token) return { token: null, registered: false, reason: "This device returned an empty push token." };

    await apiPost("/register-push", "push_register", {
      platform: Platform.OS as string,
      device_token: typeof token === "string" ? token : String(token),
    });

    return { token: typeof token === "string" ? token : String(token), registered: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Push registration failed.";
    // 503 = the managed alert key is not in place yet (it arrives when the app is published).
    return { token: null, registered: false, reason: message };
  }
}

// ------------------------------------------------------------------ on-device diagnostics
// Permission, registration and delivery are three separate states. The Notification check screen
// reads each one from its real source so a person can see exactly which one is failing.

export interface PushRegistrationState {
  configured: boolean;
  registered: boolean;
  registeredAt: string | null;
  provider: string | null;
  setupDetail: string | null;
}

/** Server's view of this installation's push registration. */
export function getPushRegistration() {
  return apiGet<PushRegistrationState>("/push/registration");
}

/** Ask Apollo's servers to send this installation a sample alert. Returns the delivery state. */
export function sendServerTestAlert() {
  return apiPostEmpty<{ deliveryId: string; state: string; failureCode: string | null }>(
    "/push/test",
    `push-test-${Date.now()}`,
  );
}