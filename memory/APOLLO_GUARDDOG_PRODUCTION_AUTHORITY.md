# GuardDog production-default authority

The product owner's authoritative execution instructions are:

`https://customer-assets-eiarnc6j.emergentagent.net/job_a5041cb8-28d9-44f8-8e40-18fe9e4a5e0e/artifacts/ikrydskc_Apollo_GuardDog_Production_Default_Developer_Execution_Instructions.md`

Issued 23 September 2026; priority FIRST / CRITICAL. This document supersedes weaker GuardDog wording.

Controlling boundaries for every continuation:
- GuardDog is the Android production-default engine; no legacy/acceptance/simulated fallback in production.
- Preserve every frozen file under `frontend/packages/guarddog-*` byte-for-byte.
- `apollo-security` remains the only native bridge and process-lifetime owner.
- Production must wire the accepted engine into the existing M2 Website Gate DNS/sinkhole path before source completion.
- Private signing keys never enter source, EAS, CI, logs, reports or chat; only public roots and signed artifacts reach the app.
- Only a fresh authorised packet intentionally dropped by the active runtime may produce Biting.
- Developer owns GD-PROD-01 through GD-PROD-08 source/configuration/checks/handoff, not signed artifacts or physical-device acceptance.
- Do not ask the owner to approve the GuardDog engine decision again.