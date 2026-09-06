// Rule bundle fixtures for the harness: the live signed bundle from the backend plus the
// committed tampered vector (for the negative path). Fetching uses react-query in the UI.
import { type SignedRuleBundle } from "@/src/contracts/shared/ruleBundle.ts";
import type { ProtectionConfig } from "@/src/sdk/GuardDogSecuritySDK";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export interface M1Config {
  rulesetId: string;
  controlledEndpoint: { host: string; ipv4: string; url: string; isPlaceholder: boolean };
  blockDedupeWindowMs: number;
  signingKeyId: string;
  capabilities: Record<string, unknown>;
  privacy: Record<string, unknown>;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchM1Config = () => getJson<M1Config>("/config");
export const fetchLatestBundle = (rulesetId: string) => getJson<SignedRuleBundle>(`/rules/${rulesetId}/latest`);
export const fetchKeys = () => getJson<{ keyId: string; publicKeyB64: string; status: string }[]>("/keys");

export function toProtectionConfig(config: M1Config): ProtectionConfig {
  return {
    controlledHost: config.controlledEndpoint.host,
    controlledIpv4: config.controlledEndpoint.ipv4,
    controlledUrl: config.controlledEndpoint.url,
    rulesetId: config.rulesetId,
    dedupeWindowMs: config.blockDedupeWindowMs,
  };
}

/** Negative fixture: valid envelope whose payload was swapped after signing (payloadHash mismatch). */
export function tamperedCopy(bundle: SignedRuleBundle): SignedRuleBundle {
  return {
    ...bundle,
    payload: { rules: bundle.payload.rules.map((r, i) => (i === 0 ? { ...r, host: "attacker-swapped.guarddog.example" } : r)) },
  };
}

/** Negative fixture: same bundle re-presented with an unknown keyId (must be UNKNOWN_KEY or SIGNATURE_INVALID). */
export function unknownKeyCopy(bundle: SignedRuleBundle): SignedRuleBundle {
  return { ...bundle, keyId: "gd-m1-test-ed25519-999" };
}
