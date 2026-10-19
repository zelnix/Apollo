import Constants from "expo-constants";

export interface GuardDogProductionConfig {
  ruleBundleUrl: string;
  /** Optional — only needed for acceptance testing of the native VPN block. */
  controlledHost: string | null;
  controlledIpv4: string | null;
  controlledUrl: string | null;
  rulesetId: string;
  dedupeWindowMs: number;
}

export type GuardDogProductionConfigFailure = "missing_rule_bundle" | "missing_controlled_target" | "invalid_https" | "invalid_target" | "invalid_dedupe_window";
export class GuardDogProductionConfigurationError extends Error {
  constructor(readonly code: GuardDogProductionConfigFailure, message: string) { super(message); this.name = "GuardDogProductionConfigurationError"; }
}

export function getGuardDogProductionConfig(): GuardDogProductionConfig {
  const raw = Constants.expoConfig?.extra?.guardDogProduction as Partial<GuardDogProductionConfig> | undefined;
  const required = ["ruleBundleUrl", "rulesetId"] as const;
  for (const key of required) if (!raw?.[key] || typeof raw[key] !== "string") throw new GuardDogProductionConfigurationError(key === "ruleBundleUrl" ? "missing_rule_bundle" : "missing_controlled_target", `GuardDog production configuration is missing ${key}.`);
  if (!raw!.ruleBundleUrl!.startsWith("https://")) throw new GuardDogProductionConfigurationError("invalid_https", `GuardDog production ruleBundleUrl must use HTTPS.`);
  // Controlled target fields are optional — only required for acceptance testing.
  let controlledHost: string | null = null;
  let controlledIpv4: string | null = null;
  let controlledUrl: string | null = null;
  if (raw?.controlledHost && raw?.controlledIpv4 && raw?.controlledUrl) {
    const host = raw.controlledHost.trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/i.test(host) || new URL(raw.controlledUrl).hostname.toLowerCase() !== host || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(raw.controlledIpv4)) {
      throw new GuardDogProductionConfigurationError("invalid_target", "GuardDog production controlled target is inconsistent.");
    }
    controlledHost = host;
    controlledIpv4 = raw.controlledIpv4;
    controlledUrl = raw.controlledUrl;
  }
  const dedupeWindowMs = Number(raw?.dedupeWindowMs ?? 2000);
  if (!Number.isFinite(dedupeWindowMs) || dedupeWindowMs < 250 || dedupeWindowMs > 60_000) throw new GuardDogProductionConfigurationError("invalid_dedupe_window", "GuardDog production dedupeWindowMs is invalid.");
  return { ruleBundleUrl: raw!.ruleBundleUrl!, controlledHost, controlledIpv4,
    controlledUrl, rulesetId: raw!.rulesetId!, dedupeWindowMs };
}
