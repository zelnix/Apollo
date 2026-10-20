// Gate 2 — Security SDK contract for messaging (iOS Swift / Android Kotlin implement these natively).
// The app never assumes automatic message access. When a capability is "unsupported" the UI falls back
// to Share → Check with Apollo or Paste into Apollo. Mock returns truthful "unsupported" values.

import { getNativeModule } from "./nativeBridge";
import { nativeJson } from "./nativeDiagnostics";

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

// Absent module → the declared "no such capability on this host" value. Present but failing →
// throws NativeCallFailed and is recorded in diagnostics, never read as "nothing found".
async function call<T>(operation: string, fn: (() => Promise<string>) | undefined, whenAbsent: T): Promise<T> {
  return nativeJson<T>(operation, fn, whenAbsent);
}

export const MessagingSdk = {
  getMessagingCapabilities: () => { const m = getNativeModule(); return call<MessagingCapabilities>("getMessagingCapabilities", m ? () => m.getMessagingCapabilities() : undefined, UNSUPPORTED); },
  analyseMessageMetadata: (meta: { sender: string; sourceType: string; urlHosts: string[]; claimedBrand: string | null }) => {
    const m = getNativeModule(); return call<SdkMessageVerdict | null>("analyseMessageMetadata", m ? () => m.analyseMessageMetadata(JSON.stringify(meta)) : undefined, null);
  },
  checkSenderReputation: (sender: string) => { const m = getNativeModule(); return call<{ status: "unknown" | "trusted" | "reported" } | null>("checkSenderReputation", m ? () => m.checkSenderReputation(sender) : undefined, null); },
  registerShareHandler: () => { const m = getNativeModule(); return call<{ registered: boolean }>("registerShareHandler", m ? () => m.registerShareHandler() : undefined, { registered: false }); },
  getRecentMessageSecurityEvents: () => { const m = getNativeModule(); return call<unknown[]>("getRecentMessageSecurityEvents", m ? () => m.getRecentMessageSecurityEvents() : undefined, []); },
  acknowledgeMessageSecurityEvents: (ids: string[]) => { const m = getNativeModule(); return call<{ acknowledged: number }>("acknowledgeMessageSecurityEvents", m ? () => m.acknowledgeMessageSecurityEvents(JSON.stringify(ids)) : undefined, { acknowledged: 0 }); },
  /** Text Guard: opens the Android "Notification access" settings screen. No-op ({opened:false}) on iOS/web. */
  openSmsListenerSettings: () => { const m = getNativeModule(); return call<{ opened: boolean }>("openSmsListenerSettings", m ? () => m.openSmsListenerSettings() : undefined, { opened: false }); },
  /** Text Guard: get local findings from ApolloLocalMessageAnalyzer (Android). Encrypted, survive content expiry. Returns [] on iOS/web. */
  getTextGuardLocalFindings: () => { const m = getNativeModule(); return call<{ findingId: string; submissionId: string; state: string; analyzer: string; source: string; findings: { ruleId: string; title: string; detail: string }[]; detectedAt: string }[]>("getTextGuardLocalFindings", m ? () => m.getTextGuardLocalFindings() : undefined, []); },
  /** Text Guard: acknowledge (remove) local findings by their IDs. */
  acknowledgeTextGuardLocalFindings: (ids: string[]) => { const m = getNativeModule(); return call<{ acknowledged: number }>("acknowledgeTextGuardLocalFindings", m ? () => m.acknowledgeTextGuardLocalFindings(JSON.stringify(ids)) : undefined, { acknowledged: 0 }); },
};
