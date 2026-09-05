// Gate 8 — Security SDK contract for Network & Accounts. Network: NetworkExtension (iOS) / VpnService (Android)
// domain filtering, VPN/DNS state, recent network events. Accounts: hand-off events from authorised provider
// integrations and breach intelligence. Everything degrades to "not available" — never simulated as live protection.
import { type NetworkSdkSummary, summariseNetworkEvents, type SdkNetworkEvent } from "@/src/domain/networkAnalysis";
export { summariseNetworkEvents };
import { getNativeModule } from "./nativeBridge";

export type NetCapabilityStatus = "supported" | "permission_required" | "unsupported";
export interface NetworkProtectionCapabilities { domainFiltering: NetCapabilityStatus; dnsProtection: NetCapabilityStatus; vpnState: NetCapabilityStatus; wifiSecurityInfo: NetCapabilityStatus; appAttribution: NetCapabilityStatus; networkChangeEvents: NetCapabilityStatus }
export interface SdkAccountEvent { eventType: "authentication"; status: "low_risk" | "suspicious" | "high_risk"; riskScore: number; confidence: "low" | "medium" | "high"; threatType: string | null; accountProvider: string | null; authenticationEvent: "unexpected_mfa" | "new_login" | "password_reset" | "recovery_change" | "breach" | "other"; relatedThreatScent: string | null; recommendedDogState: "resting" | "ears_up" | "growling" | "barking"; recommendedAction: string; occurredAt: string }

const UNSUPPORTED: NetworkProtectionCapabilities = { domainFiltering: "unsupported", dnsProtection: "unsupported", vpnState: "unsupported", wifiSecurityInfo: "unsupported", appAttribution: "unsupported", networkChangeEvents: "unsupported" };
async function call<T>(fn: (() => Promise<string>) | undefined, fallback: T): Promise<T> { if (!fn) return fallback; try { return JSON.parse(await fn()) as T; } catch { return fallback; } }

export const NetworkAccountSdk = {
  getNetworkProtectionCapabilities: () => { const m = getNativeModule(); return call<NetworkProtectionCapabilities>(m ? () => m.getNetworkProtectionCapabilities() : undefined, UNSUPPORTED); },
  getVPNState: () => { const m = getNativeModule(); return call<{ active: boolean; provider: string | null; userInstalled: boolean | null } | null>(m ? () => m.getVPNState() : undefined, null); },
  /** Recent native network events (blocked destinations, DNS/VPN changes). Empty when the SDK isn't present. */
  getRecentNetworkEvents: () => { const m = getNativeModule(); return call<SdkNetworkEvent[]>(m ? () => m.getRecentNetworkEvents() : undefined, []); },
  getRecentAccountSecurityEvents: () => { const m = getNativeModule(); return call<SdkAccountEvent[]>(m ? () => m.getRecentAccountSecurityEvents() : undefined, []); },
  submitAccountSecurityEvent: (ev: { kind: string; provider: string; state: string }) => { const m = getNativeModule(); return call<{ accepted: boolean }>(m ? () => m.submitAccountSecurityEvent(JSON.stringify(ev)) : undefined, { accepted: false }); },
};
