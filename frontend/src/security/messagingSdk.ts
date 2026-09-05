// Gate 2 — Security SDK contract for messaging (iOS Swift / Android Kotlin implement these natively).
// The app never assumes automatic message access. When a capability is "unsupported" the UI falls back
// to Share → Check with Apollo or Paste into Apollo. Mock returns truthful "unsupported" values.

import { getNativeModule } from "./nativeBridge";

export type MessagingCapabilityStatus = "supported" | "permission_required" | "unsupported";
export interface MessagingCapabilities {
  smsFiltering: MessagingCapabilityStatus;        // iOS: SMS filter extension (unknown senders only); Android: default SMS role / store policy
  linkInterception: MessagingCapabilityStatus;    // Site Guard hand-off
  senderReputation: MessagingCapabilityStatus;    // caller/number reputation where a provider is licensed
  shareExtension: MessagingCapabilityStatus;      // Share → Check with Apollo
  notificationIntegration: MessagingCapabilityStatus;
}

export interface SdkMessageVerdict {
  status: "clean" | "suspicious" | "malicious" | "unknown";
  riskScore: number;        // 0–100
  confidence: "low" | "medium" | "high";
  threatType: string | null;
  sourceType: string;       // sms | rcs | imessage | whatsapp | ...
  claimedBrand: string | null;
  urlRisk: "none" | "low" | "medium" | "high";
  recommendedDogState: "resting" | "ears_up" | "growling" | "barking" | "biting";
  actionTaken: string;      // none | filtered | blocked
}

const UNSUPPORTED: MessagingCapabilities = { smsFiltering: "unsupported", linkInterception: "unsupported", senderReputation: "unsupported", shareExtension: "unsupported", notificationIntegration: "unsupported" };

async function call<T>(fn: (() => Promise<string>) | undefined, fallback: T): Promise<T> {
  if (!fn) return fallback;
  try { return JSON.parse(await fn()) as T; } catch { return fallback; }
}

export const MessagingSdk = {
  getMessagingCapabilities: () => { const m = getNativeModule(); return call<MessagingCapabilities>(m ? () => m.getMessagingCapabilities() : undefined, UNSUPPORTED); },
  analyseMessageMetadata: (meta: { sender: string; sourceType: string; urlHosts: string[]; claimedBrand: string | null }) => {
    const m = getNativeModule(); return call<SdkMessageVerdict | null>(m ? () => m.analyseMessageMetadata(JSON.stringify(meta)) : undefined, null);
  },
  checkSenderReputation: (sender: string) => { const m = getNativeModule(); return call<{ status: "unknown" | "trusted" | "reported" } | null>(m ? () => m.checkSenderReputation(sender) : undefined, null); },
  registerShareHandler: () => { const m = getNativeModule(); return call<{ registered: boolean }>(m ? () => m.registerShareHandler() : undefined, { registered: false }); },
  getRecentMessageSecurityEvents: () => { const m = getNativeModule(); return call<unknown[]>(m ? () => m.getRecentMessageSecurityEvents() : undefined, []); },
};
