// Gate 3 — Security SDK contract for web/network protection (native iOS/Android implement these).
// The app queries capabilities first and never assumes device-level blocking exists. Mock/Expo Go → "unsupported".

import { getNativeModule } from "./nativeBridge";

export type WebCapabilityStatus = "supported" | "permission_required" | "unsupported";
export interface WebProtectionCapabilities {
  domainFiltering: WebCapabilityStatus;   // iOS content blocker / Android VPN-DNS filter
  urlInterception: WebCapabilityStatus;
  redirectAssessment: WebCapabilityStatus;
  domainReputation: WebCapabilityStatus;
  threatEventReporting: WebCapabilityStatus;
}

/** Structured finding the SDK returns for a destination; the app turns it into the Apollo experience. */
export interface SdkWebFinding {
  eventType: "web_destination";
  status: "observed" | "warned" | "blocked";
  riskScore: number;
  confidence: "low" | "medium" | "high" | "confirmed";
  threatType: string | null;
  domain: string;
  claimedBrand: string | null;
  brandMismatch: boolean;
  recommendedDogState: "resting" | "ears_up" | "growling" | "barking" | "biting";
  actionTaken: "none" | "warned" | "blocked";
  threatIntelligenceSource: string | null;
  occurredAt: string;
}

const UNSUPPORTED: WebProtectionCapabilities = { domainFiltering: "unsupported", urlInterception: "unsupported", redirectAssessment: "unsupported", domainReputation: "unsupported", threatEventReporting: "unsupported" };

async function call<T>(fn: (() => Promise<string>) | undefined, fallback: T): Promise<T> {
  if (!fn) return fallback;
  try { return JSON.parse(await fn()) as T; } catch { return fallback; }
}

export const WebSdk = {
  getWebProtectionCapabilities: () => { const m = getNativeModule(); return call<WebProtectionCapabilities>(m ? () => m.getWebProtectionCapabilities() : undefined, UNSUPPORTED); },
  getDomainReputation: (domain: string) => { const m = getNativeModule(); return call<{ verdict: "clean" | "malicious" | "unknown"; source: string } | null>(m ? () => m.getDomainReputation(domain) : undefined, null); },
  getRedirectAssessment: (url: string) => { const m = getNativeModule(); return call<{ chain: string[]; finalUrl: string } | null>(m ? () => m.getRedirectAssessment(url) : undefined, null); },
  allowDestination: (domain: string) => { const m = getNativeModule(); return call<{ allowed: boolean }>(m ? () => m.allowDestination(domain) : undefined, { allowed: false }); },
  getRecentWebThreatEvents: () => { const m = getNativeModule(); return call<SdkWebFinding[]>(m ? () => m.getRecentWebThreatEvents() : undefined, []); },
};
