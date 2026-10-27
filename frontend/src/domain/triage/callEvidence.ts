// Call evidence — Higgins Triage's classification of what ApolloSG had for a call: what you told it, the number
// checked with a reputation lookup, or the call itself seen by ApolloSG's call screening. The number shown for a call
// can be faked and ApolloSG can't yet read the network's caller verification, so caller ID is never "verified".
// Pure, no Expo imports.

import { capability, fill, newProfile, typeWords, type CapabilityRow, type EvidenceProfile, type EvidenceSignal } from "./evidenceProfile.ts";

export type CallVia = "described" | "entered" | "screened" | "call_log" | "recheck";

const WORDS = typeWords("call") as ReturnType<typeof typeWords> & {
  notes: Record<string, string>; signals: Record<string, string>; upgrade: string; recheck: string;
};
export const CALL_WORDS = WORDS;

/** The number-reputation answer, as CallRiskResult / EvidencePhoneResult carry it. */
export interface CallReputation {
  decision: "allow" | "review" | "avoid" | "unknown";
  fraud_score: number | null; recent_abuse: boolean | null; voip: boolean | null; valid?: boolean | null;
  line_type: string | null; carrier: string | null; failure?: string | null; freshness?: string | null; checked_at?: string | null;
}

export interface CallEvidenceInput {
  via: CallVia;
  number?: string | null;
  /** null for a described call: ApolloSG doesn't look the number up then. */
  reputation?: CallReputation | null;
  /** When ApolloSG's call screening saw the call arrive (ISO). */
  screenedAt?: string | null;
  asks?: string[];
  brand?: string | null;
  carrierWarning?: boolean;
  at?: string;
  /** A preview sample standing in for `via`: processed exactly as `via`, only tagged. */
  simulated?: boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const DECISION: Record<string, string> = { allow: "no strong risk signal", review: "some risk signals", avoid: "strong fraud signals" };

export function callLevelFor(input: Pick<CallEvidenceInput, "via" | "reputation" | "screenedAt">): string {
  if (input.screenedAt || input.via === "screened") return "screened_call";
  if (input.via === "described") return "described";
  return !input.reputation || input.reputation.decision === "unknown" ? "number_only" : "number_checked";
}

export function buildCallProfile(input: CallEvidenceInput): EvidenceProfile {
  const level = callLevelFor(input);
  const rep = input.reputation ?? null;
  const answered = !!rep && rep.decision !== "unknown";
  const stale = answered && rep?.freshness === "stale" && rep.checked_at ? fill(WORDS.notes.stale, { date: when(rep.checked_at) }) : null;
  const gap = !rep
    ? WORDS.notes.notLookedUp
    : fill(WORDS.notes.lookupFailed, { reason: rep.failure ? ` (${rep.failure.replace(/_/g, " ")})` : "" });
  const number = input.number?.trim() || null;
  const caps: CapabilityRow[] = [
    number ? capability("call", "number", "observed", number, WORDS.notes.numberShown) : capability("call", "number", "unavailable", null, WORDS.notes.numberMissing),
    capability("call", "caller_id", "unavailable", null, WORDS.notes.callerId),
    input.screenedAt
      ? capability("call", "timestamp", "verified", when(input.screenedAt), WORDS.notes.timeScreened)
      : capability("call", "timestamp", "unavailable", null, fill(WORDS.notes.timeMissing, { what: input.via === "described" ? "what you told it" : "the number" })),
    level === "screened_call"
      ? capability("call", "screening_result", "verified", "Seen arriving", WORDS.notes.screening)
      : capability("call", "screening_result", "unavailable", null, WORDS.notes.noScreening),
    answered && (rep?.carrier || rep?.line_type)
      ? capability("call", "carrier", "recorded", `${rep?.carrier ?? "Carrier not given"} · ${rep?.line_type ?? "line type not given"}`, stale ?? WORDS.notes.recorded)
      : capability("call", "carrier", "unavailable", null, answered ? WORDS.notes.recorded : gap),
    answered
      ? capability("call", "reputation", "recorded", `${DECISION[rep!.decision]}${rep!.fraud_score != null ? ` · fraud score ${rep!.fraud_score}/100` : ""}${rep!.recent_abuse ? " · recent abuse reported" : ""}`, stale ?? WORDS.notes.recorded)
      : capability("call", "reputation", "unavailable", null, gap),
    answered
      ? capability("call", "spoofing_indicators", "observed", rep!.voip ? "Internet (VOIP) number" : "Not an internet (VOIP) number", WORDS.notes.spoofing)
      : capability("call", "spoofing_indicators", "unavailable", null, gap),
  ];
  const signals: EvidenceSignal[] = [];
  if (answered && rep?.voip) signals.push({ id: "voip", text: WORDS.signals.voip });
  if (answered && rep?.recent_abuse) signals.push({ id: "recent_abuse", text: WORDS.signals.recent_abuse });
  if (answered && rep?.valid === false) signals.push({ id: "invalid", text: WORDS.signals.invalid });
  if (input.carrierWarning) signals.push({ id: "carrier_warning", text: WORDS.signals.carrier_warning });
  const asks = input.asks ?? [];
  if (asks.some((a) => a === "install" || a === "remote" || a === "screen")) signals.push({ id: "remote_ask", text: WORDS.signals.remote_ask });
  if (asks.some((a) => a === "code" || a === "password" || a === "bankdetails")) signals.push({ id: "secret_ask", text: WORDS.signals.secret_ask });
  if (input.brand) signals.push({ id: "brand_claim", text: fill(WORDS.signals.brand_claim, { brand: input.brand }) });
  return newProfile({ type: "call", level, via: input.via, at: input.at, capabilities: caps, signals, simulated: input.simulated });
}
