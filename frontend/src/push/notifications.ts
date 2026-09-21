// Alert notifications — Expo push protocol (spec §10A).
// Permission (OS), registration (backend knows this installation's Expo token) and delivery (per-notification status) are
// three separate facts. The token registered is the Expo push token for the owner's Expo project — never a raw FCM/APNs token.
// A failed registration is kept pending and retried with a bounded policy; it never masquerades as "granted and registered".
//
// expo-notifications is loaded lazily: importing it at module scope throws inside Expo Go on Android and is unsupported on web.
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

import { apiGet, apiPost } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

export type PushStatus = "granted" | "denied" | "undetermined" | "blocked" | "unsupported";
export type RegistrationStatus = "registered" | "pending" | "unconfigured" | "failed" | "not_applicable";
export interface PushState { permission: PushStatus; registration: RegistrationStatus; registrationId: string | null; detail: string | null }
export interface DeliveryStatus { deliveryId: string; channel: "email" | "push" | "family_voice"; state: "queued" | "submitted" | "provider_accepted" | "device_observed" | "failed" | "outcome_unknown"; retryable: boolean; failureCode: string | null; updatedAt: string }

export const PUSH_SUPPORTED = Platform.OS !== "web" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
const PENDING_KEY = "apollo.push.pending_registration";
const MAX_ATTEMPTS = 6;

type NotificationsModule = typeof import("expo-notifications");
let mod: NotificationsModule | null | undefined;

/** Returns expo-notifications only where remote push can work (dev/production builds); null in Expo Go and web. */
export function loadNotifications(): NotificationsModule | null {
  if (!PUSH_SUPPORTED) return null;
  if (mod === undefined) {
    try { mod = require("expo-notifications") as NotificationsModule; } catch { mod = null; } // eslint-disable-line @typescript-eslint/no-require-imports
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

function projectId(): string | null {
  const id = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return id ?? null;
}

async function pendingAttempts(): Promise<number> {
  const raw = await storage.getItem<string | null>(PENDING_KEY, null).catch(() => null);
  return raw ? Number(raw) || 0 : 0;
}

/** Registers the Expo push token with the backend. Never swallows the outcome: returns the real registration state. */
async function register(N: NotificationsModule): Promise<Pick<PushState, "registration" | "registrationId" | "detail">> {
  const id = projectId();
  if (!id) return { registration: "failed", registrationId: null, detail: "This build has no Expo project id; push registration is not possible." };
  try {
    const token = await N.getExpoPushTokenAsync({ projectId: id });
    const res = await apiPost<{ registered: true; registrationId: string; registeredAt: string }>("/register-push", "push_register", { platform: Platform.OS, provider: "expo", projectId: id, device_token: token.data });
    await storage.removeItem(PENDING_KEY).catch(() => undefined);
    return { registration: "registered", registrationId: res.registrationId, detail: null };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Registration failed.";
    const attempts = (await pendingAttempts()) + 1;
    await storage.setItem(PENDING_KEY, String(attempts)).catch(() => undefined);
    const unconfigured = /503|Expo push configuration|credentials/i.test(message);
    return { registration: unconfigured ? "unconfigured" : attempts >= MAX_ATTEMPTS ? "failed" : "pending", registrationId: null, detail: message };
  }
}

/** Permission first (asking only when `ask`), then registration. Re-run on every app open; tokens rotate and pending registrations retry. */
export async function registerForPush(_deviceId: string, opts: { ask: boolean }): Promise<PushState> {
  const N = loadNotifications();
  if (!N) return { permission: "unsupported", registration: "not_applicable", registrationId: null, detail: "Needs a native build (not available in Expo Go or web)." };
  let { status, canAskAgain } = await N.getPermissionsAsync();
  if (status !== "granted" && opts.ask && canAskAgain) ({ status, canAskAgain } = await N.requestPermissionsAsync());
  if (status !== "granted") {
    const permission: PushStatus = status === "denied" && !canAskAgain ? "blocked" : status === "denied" ? "denied" : "undetermined";
    return { permission, registration: "not_applicable", registrationId: null, detail: null };
  }
  if ((await pendingAttempts()) >= MAX_ATTEMPTS && !opts.ask) {
    return { permission: "granted", registration: "failed", registrationId: null, detail: "Registration has failed repeatedly; tap to retry." };
  }
  return { permission: "granted", ...(await register(N)) };
}

/** Backend view of this installation's registration (separate from the OS permission). */
export function getRegistration() {
  return apiGet<{ configured: boolean; registered: boolean; registrationId: string | null; registeredAt: string | null; setupDetail: string | null }>("/push/registration");
}

export function getDelivery(deliveryId: string) { return apiGet<DeliveryStatus>(`/push/deliveries/${deliveryId}`); }
