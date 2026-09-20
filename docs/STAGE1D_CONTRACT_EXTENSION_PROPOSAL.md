# CE-01 — minimal truthful selective-packet-filter status (PROPOSAL ONLY)

**Status: OPEN — separately reviewed approval required; NOT IMPLEMENTED.**
Stage 1C.1 launch remains PASS; Stage 1D implementation and production-default cutover are not approved.

## Reason and proposed decision

`ProtectionStatus.enforcementMethod` currently accepts only `dns_filter`, `content_blocker`,
`none`, and `simulated`. A live selective packet filter is none of these. Do not preserve
that enum by reporting an inaccurate mechanism. The user's review authorizes a **proposal**,
not a contract edit. If this proposal is not approved, defer the incompatible integration.

Propose adding exactly **`packet_filter`** to `EnforcementMethod`. No new adapter methods,
changed return-field shapes or modified certified engine API. `EnforcementEvidence.mechanism`
already includes `packet_filter`; no evidence-schema expansion is implied. Existing legacy,
iOS and mock values keep their meanings and defaults.

Only report `packet_filter` when it is the configured mechanism; operational truth still
requires fresh actual lifecycle/TUN/route evidence. Explicit coverage/scope must describe the
selective routes/rule authority, not all device traffic. The value itself is neither an
observed block nor proof that a service is currently healthy.

## Minimal proposed file set (conditional on separate approval)

| File | Proposed purpose |
|---|---|
| `frontend/src/security/SecurityPlatformAdapter.ts` | Add one `EnforcementMethod` member, document selective scope; no method/signature/field additions |
| `frontend/src/domain/protectionTruth.ts` | Handle the existing exhaustive `METHOD_LABEL` mapping and selective-filter operational wording accurately; no undefined label, DNS claim or packet-block claim from status alone |
| `frontend/tests/protectionTruth.test.ts` | Cover the new method in active/stopped/unknown/offline conditions and selective coverage wording |
| `frontend/tests/adapterContract.test.ts` | Verify existing adapter contract compatibility and distinct new mechanism semantics |
| `frontend/tests/platformCapability.test.ts` | Verify mechanism does not manufacture broad capability or verified evidence |
| `frontend/tests/failureModes.test.ts` | Preserve false-assurance protections under unavailable/stale/failed state with the new value |

These are separate from the base Stage 1D allow-list. Before approval, confirm all serialized /
exhaustive consumers and any additional affected files; return a revised list if the inventory
expands. Public method shapes, iOS behavior, `PlatformCapabilityProfile.ts` and backend/native
schemas are not silently changed. No broad UI/Higgins vocabulary redesign is authorized.

## Review/acceptance requirements

1. Explicit acceptance of the added value/name and the exact affected file list.
2. Exhaustive TypeScript consumer checks and focused compatibility tests; old adapters continue
   to work and legacy remains default. Never coerce unknown mechanisms to a false familiar label.
3. Snapshot new contract hash/version decision only after approval; preserve the original
   baseline in the record. Frozen GuardDog's 91-file manifest remains byte-for-byte unchanged.
4. No THREAT_BLOCKED/Biting from an operational `packet_filter` status. Packet evidence remains
   a separate, intentional-observation requirement. P0-03 call screening remains separately OPEN.
5. New wording does not fix P0-02 freshness/recovery, P0-05 upload rejection or P0-04 privacy.
   Their respective evidence gates cannot be signed off through this contract addition.

**Outstanding:** reviewer approval, final consumer inventory, implementation revision and
verification evidence. **Fix/code SHA: NONE.** No contract source changed in this task.