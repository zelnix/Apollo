// App version + build identity, shown on Settings → "About this build".
// A real native build (produced by Emergent's Publish → generate build flow) carries a real
// iOS buildNumber / Android versionCode baked into the manifest at build time — show that.
// There is no such number in Expo Go / the web preview (no native build exists yet), so we show
// when this preview bundle started running instead — the closest honest proxy, client-side, for
// "when this was last published".
import * as Application from "expo-application";
import Constants from "expo-constants";

export const APP_VERSION: string = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "Unknown";

const configuredIosBuild = Constants.expoConfig?.ios?.buildNumber ?? null;
const configuredAndroidBuild = Constants.expoConfig?.android?.versionCode ?? null;
export const NATIVE_BUILD_NUMBER: string | null = Application.nativeBuildVersion ?? configuredIosBuild ?? (configuredAndroidBuild != null ? String(configuredAndroidBuild) : null);

// Captured once per loaded bundle (module scope) — not per render.
const PREVIEW_LOADED_AT = new Date();

export function buildLabel(): string {
  if (NATIVE_BUILD_NUMBER) return `Build ${NATIVE_BUILD_NUMBER}`;
  return `Preview · ${PREVIEW_LOADED_AT.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}
