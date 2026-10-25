// What this phone is, for ApolloSG's admin Devices list: make, model, system and version, the country chosen in its
// region settings, and when ApolloSG was installed. Nothing personal and no hardware identifiers. Sent with
// registration and the heartbeat; anything the phone can't tell is left out, never guessed.
import * as Application from "expo-application";
import * as Device from "expo-device";
import * as Localization from "expo-localization";
import { Platform } from "react-native";

const clip = (value: string | null | undefined, max: number) => {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
};

/** Two-letter country code from the region setting, or nothing (some regions are numeric, e.g. "419"). */
export function regionCountry(region: string | null | undefined): string | undefined {
  const code = region?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
}

async function installedAt(): Promise<string | undefined> {
  if (Platform.OS === "web") return undefined;
  try { return (await Application.getInstallationTimeAsync()).toISOString(); } catch { return undefined; }
}

export async function deviceInfo(): Promise<Record<string, string>> {
  const info: Record<string, string | undefined> = {
    manufacturer: clip(Device.manufacturer, 64),
    model: clip(Device.modelName, 64),
    os_name: clip(Device.osName, 32),
    os_version: clip(Device.osVersion, 32),
    country: regionCountry(Localization.getLocales()[0]?.regionCode),
    installed_at: await installedAt(),
  };
  return Object.fromEntries(Object.entries(info).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
