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

export type GuardDogProductionConfigFailure = "missing_trust_manifest" | "missing_rule_bundle" | "missing_controlled_target" | "invalid_https" | "invalid_dedupe_window";
export class GuardDogProductionConfigurationError extends Error {
  constructor(readonly code: GuardDogProductionConfigFailure, message: string) { super(message); this.name = "GuardDogProductionConfigurationError"; }
}

export function getGuardDogProductionConfig(): GuardDogProductionConfig {
  const raw = Constants.expoConfig?.extra?.guardDogProduction as Partial<GuardDogProductionConfig> | undefined;
  const required = ["manifestUrl", "ruleBundleUrl", "controlledHost", "controlledIpv4", "controlledUrl", "rulesetId"] as const;
  for (const key of required) if (!raw?.[key] || typeof raw[key] !== "string") throw new GuardDogProductionConfigurationError(key === "manifestUrl" ? "missing_trust_manifest" : key === "ruleBundleUrl" ? "missing_rule_bundle" : "missing_controlled_target", `GuardDog production configuration is missing ${key}.`);
  for (const key of ["manifestUrl", "ruleBundleUrl", "controlledUrl"] as const) if (!raw![key]!.startsWith("https://")) throw new GuardDogProductionConfigurationError("invalid_https", `GuardDog production ${key} must use HTTPS.`);
  const dedupeWindowMs = Number(raw?.dedupeWindowMs ?? 2000);
  if (!Number.isFinite(dedupeWindowMs) || dedupeWindowMs < 250 || dedupeWindowMs > 60_000) throw new GuardDogProductionConfigurationError("invalid_dedupe_window", "GuardDog production dedupeWindowMs is invalid.");
  return { manifestUrl: raw!.manifestUrl!, ruleBundleUrl: raw!.ruleBundleUrl!, controlledHost: raw!.controlledHost!, controlledIpv4: raw!.controlledIpv4!,
    controlledUrl: raw!.controlledUrl!, rulesetId: raw!.rulesetId!, dedupeWindowMs };
}