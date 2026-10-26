// Reputation for the telephone and mobile numbers found inside a threat's original evidence.
//
// This is the DETECTION path only: the same `/call/risk-check` reputation lookup the Call gate
// makes, run over each number the captured material actually contains. It never opens an
// investigation case and never spends a Gemini call — Magnum DI is launched separately, and only
// when Triage escalates. Extraction and presentation live in ./phoneNumbers (pure).

import { apiPost } from "@/src/api/client";
import type { EvidencePhoneResult } from "@/src/domain/phoneNumbers";
import { lookupWithRetry, type LookupOutcome } from "@/src/domain/reputationLookup";
import { numberLookupFailure } from "@/src/domain/triage/limitedCause";

export type CallRiskAnswer = Omit<EvidencePhoneResult, "raw" | "lookupFailure">;

/** One caller-number reputation lookup with the controlled retry. The server already retries the provider,
 *  so an answer of "unknown" is final; only transport failures (timeout, no connection, 5xx) are retried. */
export function lookupNumberRisk<T = CallRiskAnswer>(body: { device_id: string; number: string; country?: string }): Promise<LookupOutcome<T>> {
  return lookupWithRetry("number_reputation_lookup", `${body.number}|${body.country ?? ""}`,
    () => apiPost<T>("/call/risk-check", "call_risk_check", body), { budgetMs: 30000 });
}

/** Reputation for each candidate. A number the service could not answer for is still returned, with
 *  decision "unknown" — never silently dropped and never assumed safe. A candidate the service
 *  rejects as not a telephone number at all (422) is dropped. */
export async function fetchEvidencePhoneIntel(
  candidates: string[],
  deviceId: string | null,
  country?: string | null,
): Promise<EvidencePhoneResult[]> {
  const results: EvidencePhoneResult[] = [];
  for (const raw of candidates) {
    const body: { device_id: string; number: string; country?: string } = { device_id: deviceId ?? "local", number: raw };
    if (country) body.country = country;
    const { value: r, failure } = await lookupNumberRisk(body);
    if (r) {
      results.push({
        raw, number: r.number ?? raw, decision: r.decision, fraud_score: r.fraud_score ?? null,
        recent_abuse: r.recent_abuse ?? null, voip: r.voip ?? null, line_type: r.line_type ?? null,
        carrier: r.carrier ?? null, country: r.country ?? null, source: r.source, checked_at: r.checked_at,
        lookupFailure: numberLookupFailure(r),
      });
      continue;
    }
    // 422 = the service parsed it and it is not a telephone number. Nothing to report.
    if (failure === "rejected") continue;
    results.push({
      raw, number: raw, decision: "unknown", fraud_score: null, recent_abuse: null, voip: null,
      line_type: null, carrier: null, country: null, source: "unavailable", checked_at: new Date().toISOString(),
      lookupFailure: failure,
    });
  }
  return results;
}
