// This phone's descriptive name: "Samsung Galaxy Z Fold6" rather than the model code Android reports ("SM-F956B").
// iPhones and iPads already report their descriptive name. Android asks ApolloSG's server, which reads the manufacturer
// and model this phone already reported (nothing new leaves the phone) against Google Play's list of supported devices.
// The answer is kept on the phone, so it is asked for once per model.
import * as Device from "expo-device";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { apiGet } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

const KEY = "apollo.device_model_name.v1";
const code = Device.modelName ?? null;
let known: string | null | undefined;
let asking: Promise<string | null> | null = null;

/** The kept name for this model, or the server's answer (kept when it names it). Null when no list names it. */
async function lookup(): Promise<string | null> {
  if (known !== undefined) return known;
  if (Platform.OS !== "android" || !code) return (known = null);
  const kept = await storage.getItem<string | null>(KEY, null).catch(() => null);
  const saved = kept ? (JSON.parse(kept) as { model: string; name: string }) : null;
  if (saved?.model === code) return (known = saved.name);
  asking ??= apiGet<{ name: string | null; model: string | null }>("/devices/model-name")
    .then(async (r) => {
      const name = r.model === code ? r.name : null;
      if (name) await storage.setItem(KEY, JSON.stringify({ model: code, name })).catch(() => undefined);
      known = name;
      return name;
    })
    .catch(() => null)
    .finally(() => { asking = null; });
  return asking;
}

export interface DeviceModelName {
  /** What to call this device ("Samsung Galaxy Z Fold6"). */
  name: string | null;
  /** The model code it reports, when that says something different ("SM-F956B"). */
  code: string | null;
}

function shown(found: string | null): DeviceModelName {
  const name = found ?? (Platform.OS === "android" && code ? `${titleCase(Device.manufacturer)} ${code}`.trim() : code);
  return { name, code: found && code && found !== code ? code : null };
}

export async function deviceModelName(): Promise<DeviceModelName> {
  return shown(await lookup());
}

export function useDeviceModelName(): DeviceModelName {
  const [found, setFound] = useState<string | null>(known ?? null);
  useEffect(() => {
    let live = true;
    void lookup().then((n) => { if (live) setFound(n); });
    return () => { live = false; };
  }, []);
  return shown(found);
}

function titleCase(maker: string | null): string {
  return maker ? `${maker[0].toUpperCase()}${maker.slice(1)}` : "";
}
