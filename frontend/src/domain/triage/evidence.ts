// Adapters: existing on-device analysers → the shared Triage evidence shape.
// Nothing here decides an outcome; it only normalises evidence for the engine.

import type { LocalAnalysis } from "@/src/domain/types";
import type { MessageAnalysis } from "@/src/domain/messageAnalysis.ts";
import type { CallAnalysis, CallInput } from "@/src/domain/callAnalysis.ts";
import type { TriageEvidence } from "./engine.ts";
import type { TriageOutcome } from "./contract.ts";

export interface CorrelationInput {
  related?: { category: string; event_id: string; occurred_at?: string }[];
  mechanics?: string[];
  supporting_evidence?: boolean;
  case_key?: string | null;
}

export interface UrlIntel {
  verdict?: "clean" | "malicious" | "unknown";
  threat_types?: string[];
  redirect_chain?: string[] | null;
  final_url?: string | null;
  domain_info?: { newly_registered?: boolean; available?: boolean } | null;
  unavailable?: boolean;
}

const CREDENTIAL_SIGNALS = new Set(["credential_lure", "credentials_in_url", "brand_lookalike", "brand_in_path"]);

/** Browser/session/DNS/TLS internals are not observable from an Expo app — the engine records
 *  these as Coverage Gaps instead of pretending the check ran. */
export const DEVICE_VISIBILITY = { browser: false, websocket: false, tls: false, push: false, pwa: false } as const;

export function linkTriageEvidence(args: {
  local: LocalAnalysis;
  intel: UrlIntel | null;
  intelError?: string | null;
  displayedHost?: string | null;
  actualHost?: string | null;
  credentialInteraction?: boolean;
  correlation?: CorrelationInput;
  sourceType?: "link" | "site" | "qr";
  qrPayload?: string | null;
}): TriageEvidence {
  const { local, intel, intelError } = args;
  const signals = local.signals.map((s) => s.code);
  const reputation = intel && !intelError && intel.verdict
    ? { status: "ok", verdict: intel.verdict, source: "Apollo threat intelligence", threat_types: intel.threat_types ?? [] }
    : { status: "unavailable", verdict: "unknown" };
  const hops = (intel?.redirect_chain?.length ?? 0) > 1 ? (intel?.redirect_chain?.length ?? 0) - 1 : 0;
  return {
    source_type: args.sourceType ?? "link",
    host: local.host,
    local_level: local.level,
    local_signals: signals,
    indicator_match: signals.includes("known_test_threat"),
    credentials_in_url: signals.includes("credentials_in_url"),
    credential_interaction: args.credentialInteraction ?? signals.some((code) => CREDENTIAL_SIGNALS.has(code)),
    brand_mismatch: signals.includes("brand_lookalike") || signals.includes("brand_in_path"),
    displayed_host: args.displayedHost ?? null,
    actual_host: args.actualHost ?? null,
    reputation,
    redirect: hops ? { status: "ok", hops, final_url: intel?.final_url ?? null, final_verdict: intel?.verdict ?? "unknown" } : {},
    domain_age: intel?.domain_info
      ? { status: "ok", newly_registered: !!intel.domain_info.newly_registered }
      : (intelError ? { status: "unavailable" } : {}),
    qr_payload: args.qrPayload ?? null,
    qr_is_url: !!args.qrPayload,
    scheme: "https",
    visibility: DEVICE_VISIBILITY,
    correlation: args.correlation ?? {},
    // Structural-only suspicion that no deception rule explains is Limited, never Possible Threat.
    unresolved_concern: local.level === "suspicious" && !signals.some((code) => CREDENTIAL_SIGNALS.has(code)),
    unresolved_concern_detail: "Several structural URL indicators, but no deterministic deception evidence.",
  };
}

export function messageTriageEvidence(args: {
  // An email carries the same signals a text does (EmailAnalysis exposes the same `signals`), so
  // both gates feed the one message adapter.
  analysis: Pick<MessageAnalysis, "signals" | "verdict" | "why">;
  linkOutcome?: TriageOutcome | null;
  phoneReputation?: { status: string; verdict?: string; fraud_score?: number } | null;
  correlation?: CorrelationInput;
}): TriageEvidence {
  const s = args.analysis.signals;
  return {
    source_type: "message",
    signals: {
      code_request: s.codeRequest,
      login_request: s.loginRequest,
      identity_request: s.identityRequest,
      safe_account: /safe account|secure account|protected account/i.test(args.analysis.verdict),
      gift_cards: s.giftCards,
      remote_access: s.remoteAccess,
      install_request: s.remoteAccess,
      extortion: s.extortion,
      advance_fee: s.advanceFee,
      fake_payment: s.fakePayment,
      family_claim: s.familyClaim,
      new_number: s.newNumber,
      money_request: s.moneyRequest,
      payment_request: s.paymentRequest,
      guaranteed_returns: s.guaranteedReturns,
      job_offer: s.jobOffer,
      romance_escalation: s.romanceEscalation,
      platform_switch: s.platformSwitch,
      urgency: s.urgency,
      threat: s.threat,
      unknown_sender: s.unknownSender,
      claimed_brand: s.claimedBrand,
      brand_kind: s.brandKind,
      crypto: s.crypto,
      instant_payment: /\bpay ?id\b|\bosko\b/i.test(args.analysis.verdict) || /\bpay ?id\b|\bosko\b/i.test(args.analysis.why.join(" ")),
      payment_change: false,
      forwarding_code: false,
      forwarding_intent: false,
      callback_request: s.callbackRequest,
      alleged_charge: s.allegedCharge,
    },
    brand_mismatch: !!s.claimedBrand && args.linkOutcome === "POSSIBLE_THREAT_IDENTIFIED",
    link_outcome: args.linkOutcome ?? null,
    phone_reputation: args.phoneReputation ?? {},
    visibility: DEVICE_VISIBILITY,
    correlation: args.correlation ?? {},
  };
}

export function callTriageEvidence(args: {
  input: CallInput;
  analysis: CallAnalysis;
  reputation?: { status: string; verdict?: string; fraud_score?: number } | null;
  correlation?: CorrelationInput;
}): TriageEvidence {
  const transcript = (args.input.transcript ?? "").toLowerCase();
  return {
    source_type: "call",
    asks: args.analysis.requestedActions,
    claim: args.input.claim,
    safe_account: /safe account|secure account|protected account/.test(transcript),
    threat: /suspend|lock|arrest|warrant|fine|penalty|legal action/.test(transcript),
    dont_hangup: args.analysis.requestedActions.includes("dont_hangup"),
    phone_reputation: args.reputation ?? {},
    visibility: DEVICE_VISIBILITY,
    correlation: args.correlation ?? {},
  };
}

/** Caller-number reputation check (no call content) — reputation evidence only. */
export function numberRiskTriageEvidence(args: {
  decision: string;
  fraudScore?: number | null;
  recentAbuse?: boolean | null;
  voip?: boolean | null;
  unavailable?: boolean;
  correlation?: CorrelationInput;
}): TriageEvidence {
  const reputation = args.unavailable || args.decision === "unknown"
    ? { status: "unavailable", verdict: "unknown" }
    : { status: "ok", verdict: args.decision === "avoid" ? "malicious" : "clean", fraud_score: args.fraudScore ?? null };
  return {
    source_type: "call",
    asks: args.decision === "avoid" ? ["callback"] : [],
    claim: "unknown",
    phone_reputation: reputation,
    visibility: DEVICE_VISIBILITY,
    correlation: args.correlation ?? {},
    // A reputation signal with no observed scam behaviour is explicitly not a threat on its own.
    unresolved_concern: args.decision === "review",
    unresolved_concern_detail: "Moderate caller-reputation signals with no observed scam behaviour.",
  };
}
