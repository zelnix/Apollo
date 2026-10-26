# Triage "Limited" investigation — by cause (2026-10-26, report only, nothing changed)

## Data available here
- Preview server: `triage_outcome_telemetry` 41 records, all test traffic (server/web/mock); 0 from real phones
  (telemetry only exists since 26 Oct). Server Triage (`triage_investigations`) 274: 168 possible, 106 no threat, 0 Limited.
- Preview logs: `/call/risk-check` 401 ×137 and `/intel/check` 422 ×139 sit between automated auth/security test
  calls (register → unauthenticated calls to many endpoints; admin/audit, fake family tokens) — test traffic, not the app.
- Providers now: Safe Browsing reachable; IPQS answering, account 89 of 1,020 credits used this period.
- Production: not readable from here (admin page needs the owner's login).

## Real engine over realistic inputs (/tmp/sim_limited.ts; 120 labelled links with real /intel/check answers)
| Situation | Clean links Limited | Threat links Limited |
|---|---|---|
| Providers healthy | 0 / 60 | 0 / 60 (51 possible, 9 no threat) |
| Lookup times out / 401 / no source answers | 60 / 60 | 11 / 60 |
| Safe Browsing alone down (blocklist answers → "partial") | 0 / 60 (No threat) | 0 / 60 |
- Messages: an ordinary "call me back on 0412 …" text is Limited when the number lookup fails (CB-03 gap), although
  CB-03 can never be met without an alleged charge or claimed brand — the gap cannot change the outcome.
- Number checks: "review" (IPQS 85–89 or risky) → always Limited (number_risk_moderate, by design); a deliberate check
  whose lookup returned "unknown" → Limited.

## Measurement problems
1. Number checks with decision "allow" (and automatic "unknown") never send telemetry (ApolloContext checkNumberRisk
   only reports inside the review/avoid and deliberate-unknown branches) → the admin Limited share for calls is inflated.
2. Server-side Triage reports `reputation_unavailable` without the failure kind.

## Risks
- `/call/risk-check` uses `persist_cache=False`: no cache read, no stale fallback; every automatic number check spends an
  IPQS credit (1,020/period). Once credits run out every number → "unknown" → Limited (and benign texts with numbers).

## Recommendation
- Do not change thresholds: with providers answering the rules give 0 Limited on clean links; Limited follows failed
  lookups, which is the honest result.
- Fix: (1) report every number-check outcome; (2) CB-03 records a gap only when a callback lure is present;
  (3) `/call/risk-check` reads the cache with stale fallback; (4) server Triage passes the failure kind.
- Owner decisions: Safe-Browsing-down "No threat" on blocklist alone; number "review" staying Limited.
- Found, not fixed: "Your account has been charged $899 … call 1800 123 456 now" → no callback number or alleged
  charge detected → No threat (missed callback scam).
