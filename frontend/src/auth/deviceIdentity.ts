// Apollo device identity — SERVER-issued device_id + 256-bit bearer token (Hardening Gate step 2).
// The raw token lives only on this device: expo-secure-store on iOS/Android. On web the preview keeps it in
// AsyncStorage — the web build is preview-only (the security config refuses production without the native module),
// and this is documented as such; never treat web storage as a secure credential store.
// The backend never trusts a caller-supplied device_id: it resolves identity from the token on every request.
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

export interface DeviceIdentity { deviceId: string; token: string; expiresAt: string | null }

const KEY = "apollo.device.identity.v2";
let cached: DeviceIdentity | null | undefined;
const resetListeners = new Set<(why: string) => void>();

async function read(): Promise<DeviceIdentity | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = Platform.OS === "web" ? await storage.getItem<string | null>(KEY, null) : await SecureStore.getItemAsync(KEY);
    cached = raw ? (typeof raw === "string" ? (JSON.parse(raw) as DeviceIdentity) : (raw as unknown as DeviceIdentity)) : null;
  } catch { cached = null; }
  return cached;
}

async function write(id: DeviceIdentity | null): Promise<void> {
  cached = id;
  if (Platform.OS === "web") { if (id) await storage.setItem(KEY, JSON.stringify(id)); else await storage.removeItem(KEY); return; }
  if (id) await SecureStore.setItemAsync(KEY, JSON.stringify(id)); else await SecureStore.deleteItemAsync(KEY);
}

export async function getDeviceIdentity(): Promise<DeviceIdentity | null> { return read(); }
export async function getDeviceToken(): Promise<string | null> { return (await read())?.token ?? null; }

/** Register a brand-new identity with the server (no auth). Returns it after storing it locally. */
export async function registerDeviceIdentity(base: string, meta: Record<string, unknown>): Promise<DeviceIdentity> {
  const res = await fetch(`${base}/devices/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) });
  if (!res.ok) throw new Error("Apollo couldn't register this device right now.");
  const j = (await res.json()) as { device_id: string; device_token: string; token_expires_at: string | null };
  const id = { deviceId: j.device_id, token: j.device_token, expiresAt: j.token_expires_at };
  await write(id);
  return id;
}

/** Replace the stored token after a successful server rotation. */
export async function storeRotatedToken(token: string, expiresAt: string | null): Promise<void> {
  const cur = await read();
  if (cur) await write({ ...cur, token, expiresAt });
}

/** Called when the server answers 401: the credential is dead. Clears it and tells the app to re-register. */
export async function resetDeviceIdentity(why: string): Promise<void> {
  await write(null);
  resetListeners.forEach((l) => l(why));
}

export function onIdentityReset(l: (why: string) => void): () => void { resetListeners.add(l); return () => { resetListeners.delete(l); }; }
