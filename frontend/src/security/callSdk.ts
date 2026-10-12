// Gate 4 — Security SDK contract for phone-call protection (native iOS CallKit/Call Directory, Android CallScreeningService).
// The app never assumes live-call audio access; Check This Call works from user-selected context alone.
//
// RELIABILITY FIX (12 Oct 2026): getPendingCallLookups and getCallScreeningRoleStatus now return
// explicit status ("ok" | "unavailable" | "error") so callers can distinguish:
//   - Successful query with no pending calls  → { status: "ok", items: [] }
//   - Missing native module (Expo Go / web)   → { status: "unavailable", ... }
//   - Native call-screening failure / bad JSON → { status: "error", ... }
// Other SDK methods retain the existing fallback pattern (they are non-critical for reliability).

import { getNativeModule } from "./nativeBridge";

// ── Types ────────────────────────────────────────────────────────────────────

export type CallCapabilityStatus = "supported" | "permission_required" | "unsupported";

export interface CallProtectionCapabilities {
  callerIdentification: CallCapabilityStatus;
  callScreening: CallCapabilityStatus;
  numberReputation: CallCapabilityStatus;
}

export interface SdkCallFinding {
  eventType: "phone_call";
  status: "low_risk" | "suspicious" | "high_risk";
  riskScore: number;
  confidence: "low" | "medium" | "high";
  threatType: string | null;
  callerReputation: "unknown" | "trusted" | "reported";
  claimedOrganisation: string | null;
  requestedAction: string | null;
  relatedThreatScent: string | null;
  recommendedDogState: "resting" | "ears_up" | "growling" | "barking";
  recommendedAction: string;
}

/** Explicit result from native queue operations — never swallows failures. */
export type NativeCallStatus = "ok" | "unavailable" | "error";

export interface CallLookupResult {
  status: NativeCallStatus;
  items: { number: string; seenAtMs: number }[];
  /** Human-readable detail when status is not "ok". */
  detail?: string;
}

export interface CallScreeningRoleResult {
  status: NativeCallStatus;
  /** True only when Android RoleManager confirms the role is held by Apollo. */
  roleHeld: boolean;
  /** True when the role is available on this Android version. */
  roleAvailable: boolean;
  detail?: string;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

const UNSUPPORTED: CallProtectionCapabilities = {
  callerIdentification: "unsupported",
  callScreening: "unsupported",
  numberReputation: "unsupported",
};

/** Original lenient helper — returns fallback on any failure. Retained for non-critical SDK methods
 *  where a silent fallback is acceptable (e.g., reporting, list management). */
async function call<T>(fn: (() => Promise<string>) | undefined, fallback: T): Promise<T> {
  if (!fn) return fallback;
  try { return JSON.parse(await fn()) as T; } catch { return fallback; }
}

// ── Public SDK ───────────────────────────────────────────────────────────────

export const CallSdk = {

  getCallProtectionCapabilities: (): Promise<CallProtectionCapabilities> => {
    const m = getNativeModule();
    return call<CallProtectionCapabilities>(m ? () => m.getCallProtectionCapabilities() : undefined, UNSUPPORTED);
  },

  getCallerMetadata: () => {
    const m = getNativeModule();
    return call<{ number: string | null; inContacts: boolean; country: string | null } | null>(m ? () => m.getCallerMetadata() : undefined, null);
  },

  checkNumberReputation: (n: string) => {
    const m = getNativeModule();
    return call<{ status: "unknown" | "trusted" | "reported"; reports: number } | null>(m ? () => m.checkNumberReputation(n) : undefined, null);
  },

  reportCallContext: (ctx: { asks: string[]; claim: string; state: string }) => {
    const m = getNativeModule();
    return call<{ accepted: boolean }>(m ? () => m.reportCallContext(JSON.stringify(ctx)) : undefined, { accepted: false });
  },

  getRecentCallSecurityEvents: () => {
    const m = getNativeModule();
    return call<SdkCallFinding[]>(m ? () => m.getRecentCallSecurityEvents() : undefined, []);
  },

  requestCallScreeningRole: () => {
    const m = getNativeModule();
    return call<{ opened: boolean; held?: boolean }>(m ? () => m.requestCallScreeningRole() : undefined, { opened: false });
  },

  // ── RELIABILITY-CRITICAL: Explicit status reporting ─────────────────────

  /** Reads numbers queued by ApolloCallScreeningService with no local signal.
   *  NEVER returns a bare empty array on failure — always reports explicit status. */
  getPendingCallLookups: async (): Promise<CallLookupResult> => {
    const m = getNativeModule();
    if (!m) return { status: "unavailable", items: [], detail: "Native call module is not available (Expo Go, web, or module not loaded)." };
    try {
      const raw = await m.getPendingCallLookups();
      const parsed = JSON.parse(raw) as { number: string; seenAtMs: number }[];
      if (!Array.isArray(parsed)) return { status: "error", items: [], detail: "Native module returned non-array response." };
      return { status: "ok", items: parsed };
    } catch (err) {
      return { status: "error", items: [], detail: `Native getPendingCallLookups failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  /** Explicit role-ownership query — confirms whether Apollo actually holds the Android
   *  call-screening role. Does not assume role ownership from capability alone. */
  getCallScreeningRoleStatus: async (): Promise<CallScreeningRoleResult> => {
    const m = getNativeModule();
    if (!m) return { status: "unavailable", roleHeld: false, roleAvailable: false, detail: "Native module unavailable." };
    try {
      const caps = JSON.parse(await m.getCallProtectionCapabilities()) as CallProtectionCapabilities;
      return {
        status: "ok",
        roleHeld: caps.callScreening === "supported",
        roleAvailable: caps.callScreening !== "unsupported",
        detail: caps.callScreening === "supported"
          ? "Apollo holds the call-screening role."
          : caps.callScreening === "permission_required"
            ? "Call-screening role is available but not held by Apollo. Another app may hold it."
            : "Call screening is not supported on this device.",
      };
    } catch (err) {
      return { status: "error", roleHeld: false, roleAvailable: false, detail: `Failed to query role status: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  acknowledgeCallLookups: (numbers: string[]) => {
    const m = getNativeModule();
    return call<{ acknowledged: number }>(m ? () => m.acknowledgeCallLookups(JSON.stringify(numbers)) : undefined, { acknowledged: 0 });
  },

  retryCallLookups: (numbers: string[]) => {
    const m = getNativeModule();
    return call<{ retried: number }>(m ? () => m.retryCallLookups(JSON.stringify(numbers)) : undefined, { retried: 0 });
  },

  getCallBlockAllowList: () => {
    const m = getNativeModule();
    return call<{ block: string[]; allow: string[]; autoRisky: string[] }>(m ? () => m.getCallBlockAllowList() : undefined, { block: [], allow: [], autoRisky: [] });
  },

  addCallListEntry: (number: string, kind: "block" | "allow") => {
    const m = getNativeModule();
    return call<{ ok: boolean }>(m ? () => m.addCallListEntry(JSON.stringify({ number, kind })) : undefined, { ok: false });
  },

  removeCallListEntry: (number: string, kind: "block" | "allow") => {
    const m = getNativeModule();
    return call<{ ok: boolean }>(m ? () => m.removeCallListEntry(JSON.stringify({ number, kind })) : undefined, { ok: false });
  },

  markNumberRisky: (number: string) => {
    const m = getNativeModule();
    return call<{ ok: boolean }>(m ? () => m.markNumberRisky(JSON.stringify({ number })) : undefined, { ok: false });
  },
};
