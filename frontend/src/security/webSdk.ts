// Gate 3 — Security SDK contract for web/network protection (native iOS/Android implement these).
// The app queries capabilities first and never assumes device-level blocking exists. Mock/Expo Go → "unsupported".

import { getNativeModule } from "./nativeBridge";
import { nativeJson } from "./nativeDiagnostics";

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

// Absent module → the declared "no such capability on this host" value. Present but failing →
// throws NativeCallFailed and is recorded in diagnostics, never read as "nothing found".
async function call<T>(operation: string, fn: (() => Promise<string>) | undefined, whenAbsent: T): Promise<T> {
  return nativeJson<T>(operation, fn, whenAbsent);
}

export const WebSdk = {
  getWebProtectionCapabilities: () => { const m = getNativeModule(); return call<WebProtectionCapabilities>("getWebProtectionCapabilities", m ? () => m.getWebProtectionCapabilities() : undefined, UNSUPPORTED); },
  getDomainReputation: (domain: string) => { const m = getNativeModule(); return call<{ verdict: "clean" | "malicious" | "unknown"; source: string } | null>("getDomainReputation", m ? () => m.getDomainReputation(domain) : undefined, null); },
  getRedirectAssessment: (url: string) => { const m = getNativeModule(); return call<{ chain: string[]; finalUrl: string } | null>("getRedirectAssessment", m ? () => m.getRedirectAssessment(url) : undefined, null); },
  allowDestination: (domain: string) => { const m = getNativeModule(); return call<{ allowed: boolean }>("allowDestination", m ? () => m.allowDestination(domain) : undefined, { allowed: false }); },
  getRecentWebThreatEvents: () => { const m = getNativeModule(); return call<SdkWebFinding[]>("getRecentWebThreatEvents", m ? () => m.getRecentWebThreatEvents() : undefined, []); },
};
