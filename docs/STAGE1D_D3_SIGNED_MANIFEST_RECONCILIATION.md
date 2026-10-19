# D3 — reconciliation with the agreed signed-trust-manifest architecture

**Inspected source:** `09bb101d396c35ea4e6795c2a4794825961cf15e`.
**Authority:** `APOLLO_PROTECTION_STAGE0.md` §§9–10, mirrored from the engine-owner decision.
**Scope:** focused design correction and required certified-interface request; no implementation.

## Decision and correction

The previous D1/D3 document incorrectly substituted **APK-pinned everyday bundle-signing
keys and APK-only key rotation** for the agreed architecture. That proposal is **WITHDRAWN**.
It is not an alternative production policy awaiting a quiet default selection.

The governing chain is:

```text
App-pinned PRIMARY + RECOVERY root public keys
       verify a runtime-updatable signed Trusted Key Manifest
       -> active/revoked bundle-signing keys + validity + monotonic trust version
       -> independently verified signed rule bundles
       -> current native rule authority and actual enforcement
```

Roots do not sign ordinary rule bundles. Ordinary bundle-key rotation/revocation uses signed
manifest updates **without requiring a new APK**. A controlled app update is a root-recovery
fallback when the pre-pinned recovery path cannot be used, not the everyday rotation mechanism.
The original frozen bridge still lacks trust injection; the direct-SDK owner remains a
proposed, unapproved topology. Constructor injection alone does not implement this trust protocol.

**Stage 1C.1 launch remains PASS; Stage 1D and production integration remain NOT APPROVED.**
All six P0 findings remain OPEN. D3's policy conflict is corrected; its missing certified
implementation and verification are not thereby resolved.

## 1. How primary/recovery roots authenticate the manifest

### Bootstrap and roles

- The native build contains an immutable production bootstrap set with **two distinct root
  public keys**, stable IDs, fingerprints, roles (primary/recovery), trust domain/profile and
  bootstrap schema version. No private key is shipped. Acceptance/test roots are separately
  provisioned and may never populate production bootstrap or production bundle authority.
- The owner passes bootstrap roots to the **engine-side certified manifest verifier/controller**.
  Neither Apollo JS, a backend response nor a rule bundle can add an arbitrary trusted root.
- Routine manifests are authenticated under the authorized primary root. Recovery manifests
  can be authenticated by the already pinned recovery root **without a compromised primary's
  countersignature**. Recovery must durably disable a compromised primary's manifest authority;
  old primary signatures cannot restore it simply by arriving later or carrying a larger number.
- The recovery root can maintain an authorized trust set while the primary is disabled; thus
  the pre-pinned recovery path can work without an APK update. Adding a new, previously unknown
  bootstrap root is not implicit in a fetched key list; its authorization must be specified by
  the certified recovery protocol or a controlled app update.

### Required authenticated content and validation order

The exact wire schema must be delivered/versioned by the engine owner, not improvised in the
Apollo shim. Proposed encoding for that review: strict JSON, RFC 8785 JCS canonicalization and
Ed25519 signatures, consistent with the existing bundle-verification primitives. This is a
manifest protocol, **not** permission to pass manifest JSON into `RuleBundleVerifier.verify`.

Signed content must bind schema/type (manifest, not bundle), production/test trust domain,
signer-root ID/role, trust-set version, not-before/expiry, active bundle-key entries and
revoked IDs, key purpose/ruleset scope and any per-key validity, plus any recovery-control data.
Only a signature field is excluded from the canonical signed bytes; no security-critical
field is taken from an unsigned transport wrapper.

Before any registry mutation:

1. Apply fixed byte/key-count/depth limits and strict schema/type parsing; reject duplicate
   JSON keys, duplicate/conflicting key IDs, invalid key lengths, unknown critical fields,
   active/revoked overlap, root-key material misused as bundle keys, production test-key
   aliases and cross-profile/domain substitution. Key IDs must not silently change fingerprints.
2. Select the signer **only from an already authorized pinned root** and its persisted role
   state. Never trust a root public key supplied alongside the signature.
3. Verify the signature over the canonical, domain-bound manifest. Current Ed25519/JCS
   helpers are primitives, not evidence that manifest validation is already implemented.
4. Check root role, manifest-level validity and trusted-time policy. Future-dated/expired or
   unverifiable manifests do not replace a still-valid last-known-good manifest. Legitimate
   future key entries may be scheduled but stay ineligible before their own not-before time;
   effective authority is bounded by manifest, key and bundle validity.
5. Enforce a **separate trust-manifest anti-rollback ledger**: a lower effective trust version
   is rejected; same version + same authenticated envelope is idempotent; same version +
   different envelope is a conflict. Bundle-version floors are not a substitute for this ledger.
6. Produce an opaque verified candidate with manifest hash/version, signer role, effective
   key set, validity and revoked/removed authority. No raw JSON/boolean becomes trusted state.

**Recovery ordering must be certified explicitly.** A compromised primary must not defeat the
recovery root by issuing a version jump. Proposed protocol for engine-owner review: a
recovery-root-only root epoch plus a sequence, monotonically ordered as a tuple; primary
manifests cannot advance the recovery epoch, and disabled roots cannot issue within it.
Stage 0 did not settle this wire encoding: it is a required recovery/version test contract,
not an implemented or approved ad-hoc rollback exception in Apollo. Recovery persistence and
restart must preserve both the version floor and disabled-root state.

### Cache and transport boundary

Retain the signed **last-known-good manifest and raw signed rule bundles**, authenticated
envelope hashes, trust/bundle version floors and recovery state. Revalidate on restart; a fetch
is not trust. Cache corruption must not reset floors or restore revoked trust. A packaged,
root-signed bootstrap manifest is allowed only as an initial verified seed, never an unsigned
shortcut or fallback over a newer persisted version.

Apollo may transport signed updates using an approved bounded endpoint/redirect policy, but
TLS/backend authentication alone does not authorize their contents. P0-01 still needs its
own verified remediation; this document does not introduce or approve a new network service.

## 2. How changes update the single owner and existing rule authority

There is still **one native runtime owner**, not a new engine for every manifest. Its certified
trust controller owns the effective registry and trust generation. Apollo exposes read-only
diagnostics and invokes that controller; it does not export unrestricted `trust`, `retire`,
root replacement or a JS-asserted “verified manifest” API.

### Conservative transition, with an explicit commit boundary

For the initial controlled integration, use **quiesce → invalidate/revalidate → resume**, not
an unproved live hot-swap. Re-fetching an unchanged manifest is idempotent, not itself a VPN
restart; clock-driven key/manifest validity transitions still require reevaluation even when
the signed manifest bytes/version have not changed.

1. Authenticate and validate the candidate under §1. Reject invalid candidates without
   disrupting a still-valid working cache merely because an untrusted server sent bad data.
2. Serialize the transition in the existing owner; close new rule admission/authorization
   under the outgoing trust generation. Compute affected keys and **both M1 and M2** admitted
   bundles/bindings; preserve historical evidence separately from current authority.
3. Stage the verified manifest, new high-water mark and revocation/recovery data durably before
   issuing an “installed/applied” receipt. The engine-owner journal must recover interrupted
   transitions without restoring authority already durably revoked. An IO failure is not
   successful installation: quiesce known-invalid authority, surface recovery failure, and
   do not claim crash-safe persistence that was never achieved. The failure/restart behavior
   is a required certified test, not a hand-waved atomicity promise.
4. Invalidate affected current authority and request native quiescence. In the first version,
   a full GuardDog service stop is acceptable where finer invalidation cannot be proved;
   that temporarily reduces protection and must be shown, but is not a reason to block all
   ordinary internet traffic. Observe reader drain / TUN release, not a command acknowledgement.
5. With verification/admission readers quiesced, update the **same registry used by the same
   verifier/engine** from the verified snapshot: remove revoked/no-longer-authorized entries,
   add only manifest-authorized entries, and enforce purpose/scope/validity. No partial key
   set may be visible to concurrent verification. `ConcurrentHashMap` entry safety alone is
   not a transaction for an entire manifest.
6. Reverify cached raw M1/M2 bundles under the new trust set, current time and existing bundle
   floors. A previously accepted bundle is not grandfathered after its signer is revoked or
   removed. Retained active overlapping keys permit existing valid bundles to remain eligible;
   new key/new bundle delivery need not require an APK. A rejected bundle loses **current**
   authority even if its bytes remain as historical evidence.
7. Clear/invalidate accepted-bundle authority and all derived routes/bindings that are no
   longer eligible; reauthorize only successful results with the new trust generation.
   Persist/commit the coherent generation and emit an applied receipt only after the native
   transition actually satisfies its contract. Restore protection only if user intent,
   permissions, trust, bundle and target configuration are still valid.
8. Resume once, through D6's observed lifecycle completion. On timeout/contradiction, remain
   explicitly **UNRESOLVED/degraded**; do not instantiate a second owner or silently fall back
   to a revoked last-known-good manifest. Trust installation, protection restart and network
   recovery are separate results.

Rotation uses overlapping active bundle keys: introduce the new key in a verified manifest,
admit bundles signed by it, then retire/revoke the old key in a newer verified manifest.
Removal/revocation cannot be undone by an older cache, unsigned payload or implicit omission
handling. Exact reauthorization/recovery rules must be part of the certified manifest protocol.

### Why the current public calls are insufficient for this whole transition

`TrustedKeyRegistry.trust/retire` changes future key lookup. It neither verifies a root-signed
manifest nor invalidates the engine's private `acceptedBundle` / `acceptedWebsiteGateBundle`.
`clearAuthorization()` clears the M1 authorization, not its accepted bundle; the old bundle
can authorize again. `clearWebsiteGateBindings()` clears bindings, not the M2 bundle; DNS
handling can arm new ones. Rejected `accept*RuleBundle` calls leave prior accepted slots intact.
Live VPN readers also retain captured reporter/engine references. Therefore removing a key,
clearing attribution, hiding an event or reassigning a global is **not** proof that the old
authority ceased enforcing. Do not fake clearing with an invalid/empty bundle or recreate
engines to evade this missing lifecycle contract.

## 3. Expiry, learned revocation and offline uncertainty are DIFFERENT cases

Stage 0 §10 remains authoritative: backend unreachability alone never kills ordinary access;
use verified cached rules for locally known-bad traffic, never accept unverifiable updates,
and fail open for unknown/unverified traffic. Cached use is bounded by authenticated validity;
offline operation does not silently extend an expired manifest/key/bundle. No unsigned grace
period is introduced here. Any future offline lease extension would need explicit signed policy
and separate approval—not a blanket timer reset on a failed fetch.

| Situation | Required behavior | What must not be claimed |
|---|---|---|
| **Known expiry** of manifest, key validity or applicable bundle | Compute effective cutoff from the applicable authenticated deadlines. Schedule refresh beforehand; if no valid successor exists, stop admitting authority by cutoff and perform the defined observed invalidation/teardown. Retain historical bytes, not authority to keep enforcing expired policy. Unaffected valid authority may resume after revalidation. | “Offline means expiry does not apply”; a failed refresh extends validity; teardown acknowledgement means completed recovery |
| **Newly received revocation** in a higher, verified manifest | Knowledge begins after successful root/role/version/time validation—not raw receipt. Immediately gate new affected authority, durably stage the change, then invalidate/drain affected enforcement and apply/revalidate the new trust generation. Never revert to the revoked key because replacement delivery fails. | HTTP success is revocation proof; `retire()` alone removed existing routes/bundles; suppressed post-drop event prevented the packet drop |
| **Offline/unreachable, valid cached manifest + bundle, no learned revocation** | Continue authorized locally known-bad enforcement within remaining validity; unknown/unverified traffic fails open. Report stale/unreachable update knowledge without fabricating fresh intelligence. Reconnect/fetch/verify later and then apply any newly learned revocation. | Instantaneous offline revocation discovery; backend outage alone requires blanket blocking or indiscriminate protection shutdown |
| **Offline with no usable cache, known expiry or previously learned revocation** | No new authority from invalid/unknown data. Invalidate known-ineligible enforcement, release obsolete routes with honest completion status, preserve ordinary connectivity and degraded/unknown disclosure. | Resetting trust floors, reviving revoked cached rules, or calling unverified traffic safe |
| **Clock uncertainty / interrupted transition / failed stop** | Expose uncertainty; reject new admission requiring unverifiable time/state; apply certified recovery behavior. Never report a new healthy verification merely because a method returned or a timestamp was read. | A hard timing or freshness guarantee without trustworthy observations |

### Timing contract to define and test (not current SDK guarantees)

Record separately: raw receipt; cryptographic verification/knowledge time; durable staging;
admission gate closure; effective cutoff; stop request; native quiescence/TUN release; trust
commit; restart; fresh connection recovery. Retain the event's original native time/identity;
do not relabel delayed historical evidence as a block under a new manifest.

**Proposed acceptance targets for engine-owner ratification:** request a controlled stop ten
seconds before a known validity cutoff when it is known in advance; require observed native
quiescence within five seconds of a stop request; after a newly verified revocation, close
new affected admission immediately in the serialized native transition and request teardown
in that same transition. These are reviewable test targets, not measurements or promises
already provided by Android/the frozen SDK. A delayed timer, missed bound, in-flight authority
race or contradictory observation is recorded as a failure/UNRESOLVED, never hidden as PASS.

The certified contract must define its exact decision boundary for in-flight packets and
report any transition-window drops/losses. Known invalid authority must not be presented as
current verified protection. If a stricter no-post-cutoff admission guarantee is required,
the enforcement decision path must enforce it; a post-drop event filter cannot. We do **not**
require or claim instantaneous knowledge of an offline revocation. Its delay is the time
until a newer signed manifest is learned, bounded independently by the cached validity policy.

Recovery is separately observed: removing a VPN route does not prove cached DNS answers or
existing connections have recovered. A fresh controlled connection/DNS check is required.
Current consumer health/freshness defects remain P0-02; a historical block must not mask loss
of current authority. P0-05 still blocks end-to-end reporting even when native proof succeeds.

## 4. Frozen capabilities versus required engine-owner interfaces

Names below are **requested interface semantics, not APIs that exist today**. Per Stage 0
§9 ownership, the engine owner must implement/certify the trust mechanism in its own project.
Apollo main must not reconstruct it from this prose or patch the imported frozen packages.

| Needed guarantee / proposed interface | Frozen snapshot provides | Engine-owner work / explicit gap |
|---|---|---|
| **T1 `verifyTrustManifest`**: pinned primary/recovery authentication, roles, strict schema/domain, validity and anti-rollback | Generic public Ed25519/JCS helpers; **no trust-manifest verifier/schema/controller** found | Certified manifest protocol, key-purpose separation, recovery/root-disable/version ordering, deterministic cross-platform vectors |
| **T2 `stage/commit/recoverTrustGeneration`**: signed LKG cache + trust-version/hash/recovery journal | Rule-bundle `BundleVersionStore`, not trust-set/root-state persistence | Separate trust ledger and crash/IO/rollback recovery; exact installed-receipt boundary; never reset floors to recover silently |
| **T3 `applyVerifiedTrustGeneration`**: same-owner registry update coordinated with readers and all admitted authority | Injected mutable `TrustedKeyRegistry`; per-entry `trust/retire`, future bundle verification | Transaction/quiescence semantics, no partially applied manifest, revalidation/invalidation of both private accepted-bundle slots and derived M1/M2 bindings, generation-linked receipt |
| **T4 `invalidateAndQuiesceAuthority` / observed completion** | Clear M1 authorization / M2 bindings; service stop, lifecycle observations; **no complete accepted-authority invalidation or reader-drain completion API** | Stop new authorization/re-arming from old bundles, define and prove cutoff/in-flight behavior, actual stopped/recovered/timeout outcomes; avoid duplicate owners |
| **T5 validity/diagnostic snapshot**: trust generation, deadlines, last update knowledge, current eligible authority | Some bundle metadata and native lifecycle; not a coherent manifest/authority generation | Separate current validity from cached intelligence, update failure, raw/local verification time and OS health; no false refreshed trust or per-packet provenance |
| Existing rule-bundle signature/expiry/version checks | Present at verification time via `RuleBundleVerifier`; injected keys are looked up for future verification | Reuse these proven functions inside the certified controller; they do not establish continuous accepted-rule validity by themselves |
| Ordinary offline operation with valid LKG | Existing accepted rules can continue locally; no network lookup is required for each packet | Certified restore/expiry/revocation coordination and honest status; no instantaneous offline discovery promise |

These gaps do not prove direct SDK integration is impossible forever. They establish that
**the inspected frozen snapshot does not expose the complete agreed trust/authority lifecycle**.
It can supply primitives and controlled experiments; it cannot be declared production-ready
merely because a new registry constructor accepts production public keys.

The engine owner may deliver a certified controller/composition that reuses unchanged core/VPN
primitives **where it can demonstrate the accepted semantics and bounds**. New core hooks are
needed only where that composition cannot meet the agreed contract; atomic zero-latency offline
revocation is not a requirement. A certified update/composition still needs reviewed provenance
and import approval before Apollo relies on it; no local product-side workaround is approved.

### Focused engine-owner acceptance matrix (all NOT RUN here)

- Primary-signed manifest, recovery-signed recovery, disabled primary after recovery and
  restart; primary cannot impersonate recovery or defeat its approved version/epoch ordering.
- Unknown/fetched root; ordinary bundle key attempting to sign a trust manifest; root used as
  an ordinary bundle key; wrong profile/domain/type; malformed/duplicate keys; signature failure.
- Lower trust version; identical replay; same-version different signed envelope; clock rollback,
  not-before/expiry and missing trusted time. Manifest floors and bundle floors both preserved.
- Runtime overlapping-key rotation **without an APK update**; new-key bundle acceptance;
  retirement/revocation of old keys prevents new authority and invalidates eligible existing
  M1/M2 authority as specified, not merely its reporting.
- Crash/IO failure at each stage: no mixed registry/manifest/bundle generation, no false applied
  receipt, no resurrection of durably revoked authority; recovery failure visible.
- Known expiry with active traffic, main-thread stall/Doze/resume and in-flight packets;
  record cutoff/request/quiescence/drop intervals and the proposed bounds rather than assuming them.
- Newly learned valid revocation with active traffic versus an unsigned/invalid revocation
  response. Invalid candidates alone cannot remotely disable still-valid local protection.
- Offline valid cache keeps known-bad blocking and unknown traffic open; reconnect learns
  revocation; offline cache expiration has its own invalidation result; no zero-latency claim.
- Separate trust installation, native stop/start and network recovery; delayed callbacks or
  historical blocks cannot manufacture current health or packet-backed Biting.

Each device record still requires source SHA, APK build ID/hash, OS/profile, manifest version/hash,
bundle signer/version, native event identity and the timeline above. No new builds, runtime
tests, network attacks or trust code were executed/implemented for this reconciliation.

## Delivery / approval disposition

1. **Policy reconciliation: complete in the design record.** Stage 0's root-pinned bootstrap,
   runtime signed manifests, overlapping key rotation, LKG cache and offline limitation govern.
   APK-only everyday bundle-key rotation is withdrawn, including from the earlier owner design.
2. **Production implementation: blocked on certified T1–T5 contracts and evidence**, owner
   topology approval, actual bootstrap roots/policy inputs and approved/measured transition
   behavior. These requirements belong in the engine owner's durable decision/implementation
   record; this file is a handoff request, not evidence it has been delivered there.
3. **Current frozen source remains untouched.** Any engine-owner changes require a new reviewed
   certified snapshot and deliberate import approval, not edits to the 91 current files.
4. Stage 1D remains NOT STARTED; other design decisions and all six P0 findings remain OPEN.
   Launch PASS is unchanged. No contract extension or production-default cutover is approved.