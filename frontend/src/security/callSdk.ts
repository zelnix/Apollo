// Gate 4 — Security SDK contract for phone-call protection (native iOS CallKit/Call Directory, Android CallScreeningService).
// The app never assumes live-call audio access; Check This Call works from user-selected context alone.
import { getNativeModule } from "./nativeBridge";

export type CallCapabilityStatus = "supported" | "permission_required" | "unsupported";
export interface CallProtectionCapabilities { callerIdentification: CallCapabilityStatus; callScreening: CallCapabilityStatus; numberReputation: CallCapabilityStatus; voicemailTranscript: CallCapabilityStatus; liveTranscript: CallCapabilityStatus }
export interface SdkCallFinding { eventType: "phone_call"; status: "low_risk" | "suspicious" | "high_risk"; riskScore: number; confidence: "low" | "medium" | "high"; threatType: string | null; callerReputation: "unknown" | "trusted" | "reported"; claimedOrganisation: string | null; requestedAction: string | null; relatedThreatScent: string | null; recommendedDogState: "resting" | "ears_up" | "growling" | "barking"; recommendedAction: string }
const UNSUPPORTED: CallProtectionCapabilities = { callerIdentification: "unsupported", callScreening: "unsupported", numberReputation: "unsupported", voicemailTranscript: "unsupported", liveTranscript: "unsupported" };
async function call<T>(fn: (() => Promise<string>) | undefined, fallback: T): Promise<T> { if (!fn) return fallback; try { return JSON.parse(await fn()) as T; } catch { return fallback; } }
export const CallSdk = {
  getCallProtectionCapabilities: () => { const m = getNativeModule(); return call<CallProtectionCapabilities>(m ? () => m.getCallProtectionCapabilities() : undefined, UNSUPPORTED); },
  getCallerMetadata: () => { const m = getNativeModule(); return call<{ number: string | null; inContacts: boolean; country: string | null } | null>(m ? () => m.getCallerMetadata() : undefined, null); },
  checkNumberReputation: (n: string) => { const m = getNativeModule(); return call<{ status: "unknown" | "trusted" | "reported"; reports: number } | null>(m ? () => m.checkNumberReputation(n) : undefined, null); },
  reportCallContext: (ctx: { asks: string[]; claim: string; state: string }) => { const m = getNativeModule(); return call<{ accepted: boolean }>(m ? () => m.reportCallContext(JSON.stringify(ctx)) : undefined, { accepted: false }); },
  getRecentCallSecurityEvents: () => { const m = getNativeModule(); return call<SdkCallFinding[]>(m ? () => m.getRecentCallSecurityEvents() : undefined, []); },
};
