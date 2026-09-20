import Constants from "expo-constants";
import { APP_ENV, SECURITY_CONFIG } from "@/src/config/appEnvironment";

export interface GuardDogCandidateConfig {
  profile: "guarddog-stage1d-acceptance";
  controlledHost: string;
  controlledIpv4: string;
  controlledUrl: string;
  rulesetId: string;
  signedBundle: string;
  dedupeWindowMs: number;
}

type Extra = Omit<GuardDogCandidateConfig, "signedBundle" | "dedupeWindowMs"> & { engine?: string; signedBundleB64?: string };

export function validateGuardDogCandidateConfig(extra: Partial<Extra>, appEnvironment: string): GuardDogCandidateConfig {
  if (appEnvironment === "production") throw new Error("GuardDog candidate configuration is prohibited in production");
  const required = ["controlledHost", "controlledIpv4", "controlledUrl", "rulesetId", "signedBundleB64"] as const;
  const missing = required.filter((key) => !extra[key]);
  if (missing.length) throw new Error(`GuardDog acceptance input missing: ${missing.join(", ")}`);
  if (extra.profile !== "guarddog-stage1d-acceptance") throw new Error("GuardDog acceptance profile mismatch");
  const signedBundle = decodeBase64(String(extra.signedBundleB64));
  const envelope = JSON.parse(signedBundle) as { rulesetId?: string; expiresAt?: string };
  if (envelope.rulesetId !== extra.rulesetId) throw new Error("Signed bundle ruleset does not match candidate configuration");
  if (!envelope.expiresAt || Date.parse(envelope.expiresAt) <= Date.now()) throw new Error("Signed acceptance bundle is expired");
  return { profile: extra.profile, controlledHost: String(extra.controlledHost), controlledIpv4: String(extra.controlledIpv4),
    controlledUrl: String(extra.controlledUrl), rulesetId: String(extra.rulesetId), signedBundle, dedupeWindowMs: 2_000 };
}

export function getGuardDogCandidateConfig(): GuardDogCandidateConfig {
  if (SECURITY_CONFIG.androidEnforcementEngine !== "guarddog_acceptance") throw new Error("GuardDog candidate is not selected");
  return validateGuardDogCandidateConfig((Constants.expoConfig?.extra?.guardDogCandidate ?? {}) as Partial<Extra>, APP_ENV);
}

function decodeBase64(value: string): string {
  if (typeof globalThis.atob !== "function") throw new Error("Base64 decoder unavailable");
  return globalThis.atob(value);
}