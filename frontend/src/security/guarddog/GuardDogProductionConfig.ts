import Constants from "expo-constants";

export interface GuardDogProductionConfig {
  manifestUrl: string;
  ruleBundleUrl: string;
  controlledHost: string;
  controlledIpv4: string;
  controlledUrl: string;
  rulesetId: string;
  dedupeWindowMs: number;
}

export function getGuardDogProductionConfig(): GuardDogProductionConfig {
  const raw = Constants.expoConfig?.extra?.guardDogProduction as Partial<GuardDogProductionConfig> | undefined;
  const required = ["manifestUrl", "ruleBundleUrl", "controlledHost", "controlledIpv4", "controlledUrl", "rulesetId"] as const;
  for (const key of required) if (!raw?.[key] || typeof raw[key] !== "string") throw new Error(`GuardDog production configuration is missing ${key}.`);
  for (const key of ["manifestUrl", "ruleBundleUrl", "controlledUrl"] as const) if (!raw![key]!.startsWith("https://")) throw new Error(`GuardDog production ${key} must use HTTPS.`);
  const dedupeWindowMs = Number(raw?.dedupeWindowMs ?? 2000);
  if (!Number.isFinite(dedupeWindowMs) || dedupeWindowMs < 250 || dedupeWindowMs > 60_000) throw new Error("GuardDog production dedupeWindowMs is invalid.");
  return { manifestUrl: raw!.manifestUrl!, ruleBundleUrl: raw!.ruleBundleUrl!, controlledHost: raw!.controlledHost!, controlledIpv4: raw!.controlledIpv4!,
    controlledUrl: raw!.controlledUrl!, rulesetId: raw!.rulesetId!, dedupeWindowMs };
}