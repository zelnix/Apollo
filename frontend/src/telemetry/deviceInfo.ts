// What this phone is, for ApolloSG's admin Devices list: make, model, system and version, the country chosen in its
// region settings, and when ApolloSG was installed. Nothing personal and no hardware identifiers. Sent with
// registration and the heartbeat; anything the phone can't tell is left out, never guessed.
import * as Application from "expo-application";
import * as Device from "expo-device";
import * as Localization from "expo-localization";
import { Platform } from "react-native";

import { getNativeModule } from "@/src/security/nativeBridge";

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

/** True only on one of Google's test phones (Firebase Test Lab, which runs Play's pre-launch reports): Android sets the
 *  system setting `firebase.test.lab` to "true" there. Read by ApolloSG's own native module; false wherever it can't
 *  be read (iPhone, web, Expo Go). */
export async function isGoogleTestLab(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try { return (await getNativeModule()?.isGoogleTestLab?.()) === true; } catch { return false; }
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
