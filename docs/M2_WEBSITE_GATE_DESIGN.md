# Gate Guard M2 — Website & Browser Gate: Frozen Design

Status: design frozen (this session). Implementation in progress, phase-by-phase. This document is the
durable record of the architecture decisions — mirrors how `M1_CI_RUNBOOK.md` became the durable M1 record.

## 0. Invariant (unchanged from M1)

`THREAT_BLOCKED` / "Apollo is biting" fires only from `GuardDogSDKEngine.reportBlockedPacket()`, only from a
`BlockedThreatEvidence` produced by a real packet observed on TUN and dropped. A DNS match, a rule match, a
cache hit, or a cloud verdict **arms** the gate; none of them **is** the gate.

## 1. Five frozen architectural decisions

1. **New ruleset, not mutation of M1.** `gd-m2-website-gate` is its own ruleset (own bundle, own version
   history, own expiry/rollback lifecycle, same signer/verifier code). `signing_guard.py`'s M1-only lock
   (`enforce_controlled_configuration`) is untouched — it already early-returns for any ruleset id other
   than the M1 controlled one.
2. **DNS is authorization input, never enforcement evidence.** A DNS observation may create an ephemeral
   `WebsiteGateBinding` (hostname -> sinkhole destination -> expiry -> rule/version provenance). It must
   never directly produce `THREAT_BLOCKED`. The only genuine block remains: authorized destination -> real
   TUN packet -> deliberate drop -> `BlockedThreatEvidence` -> `reportBlockedPacket()` -> validated
   `THREAT_BLOCKED`.
3. **Parallel Website Gate authorization table.** `GuardDogSDKEngine` gets a second, independent structure
   (`WebsiteGateBinding(host, sinkholeIp, rulesetId, ruleId, ruleVersion, expiresAt)`) alongside — never
   inside — the existing single-target M1 `authorization` field.
4. **Narrowly-loosened selective routing.** `SelectiveRouteInstaller.isSelective` evolves from "exactly one
   `/32`" to "only the DNS resolver address + a fixed, enumerable sinkhole pool + required bypasses; never
   a default route." Still a hard runtime `check()`, not a comment. No `0.0.0.0/0`, no `::/0`, no
   dynamically-supplied arbitrary ranges.
5. **Additive-only capability change.** `ANDROID_M1_CAPABILITIES.dnsVisibility` (né `dnsInterception`)
   stays `false` forever. A new `ANDROID_M2_CAPABILITIES` sets it `true` only when the website-gate adapter
   is active and validated.

## 2. Core mechanism — DNS-triggered sinkhole (no forwarding, no re-establish)

Android's `VpnService.Builder` fixes routes at `establish()`; routes cannot be added to an already-established
TUN. Rather than resolve a blocked hostname to its real (attacker-controlled) IP, Apollo **never trusts the
hostile domain's real A/AAAA record at all**: for a `block` verdict it synthesizes a DNS answer pointing
directly at one of a small, fixed, pre-provisioned sinkhole `/32`s from the static route table established
at VPN start. No re-establish is ever needed to add a new "block."

Flow:
```
DNS query observed (DnsPacketClassifier, DnsQueryParser)
  -> canonicalize hostname (existing Kotlin/Python parity contract, unchanged)
  -> local rule (gd-m2-website-gate) / provider-cache / sanitized-cloud decision (shared-core layer)
  -> allow/unknown/unavailable: forward the REAL DNS answer untouched (VpnService.protect()'ed
     resolver socket, bypasses the tunnel, no loop) -> no route exists for that IP -> traffic never
     enters TUN -> unrelated browsing provably unaffected
  -> block: SinkholeBindingStore creates a short-lived WebsiteGateBinding; DnsResponseSynthesizer
     answers with a sinkhole /32 from the fixed pool (never the real IP)
  -> application connects to the sinkhole address (already in the static route table)
  -> TUN observes the real packet
  -> WebsiteGatePacketAuthorizer verifies a live binding exists for that sinkhole IP
  -> existing PacketDropReporter/BlockedFlowDeduper: deliberate drop, dedupe
  -> BlockedThreatEvidence created
  -> existing reportBlockedPacket() emits THREAT_BLOCKED (checks the M1 table AND the new
     WebsiteGateBinding table)
  -> consumer may display "Apollo is biting" only when SecurityEvent.isGenuineBlock == true
```

**Disclosed limitation:** apps using DoH/DoT to a fixed, non-system resolver bypass DNS-based interception.
Surfaced as an honest `PlatformCapabilityProfile` limitation, never hidden, never worked around by
escalating scope (no MITM, no forced device-wide DNS takeover beyond what's described).

**Deferred, not silently dropped:** SNI/port-443 sniffing (a separate future milestone — it would require
full TCP forwarding/reassembly, TLS ClientHello parsing, fragmentation, QUIC/HTTP3 considerations — much
larger scope than a Website Gate extension), Windows/macOS adapters, AccessibilityService-based app
attribution, broad app-inventory permissions, AI-decided blocking.

## 3. Class split inside `guarddog-vpn` (Phase 4)

`DnsPacketClassifier` -> `DnsQueryParser` -> (shared-core decision) -> `SinkholeBindingStore` ->
`DnsResponseSynthesizer` -> `WebsiteGatePacketAuthorizer` -> existing `PacketDropReporter` ->
existing `BlockedFlowDeduper` -> existing `reportBlockedPacket()`. No single giant "DNS interceptor" class.

## 4. Threat intelligence (backend) — mostly already built

`IntelligenceService.lookup()` already implements local-rules -> provider-cache -> sanitized-cloud, fails
open on anything unresolved. Extended (Phase 1, this pass) to be ruleset-parameterized so the same endpoint
serves both M1 (default) and M2 (explicit `rulesetId`) without changing M1's default behavior. Cloud tier
(`GoogleWebRiskProvider`) stays disabled/fail-open until a real `WEBRISK_API_KEY` is provided — held off by
product decision, not a blocker for Phases 1-4.

## 5. Test matrix for Phase 4 (the critical engineering milestone)

Block hostname -> sinkhole -> real packet -> evidence -> `THREAT_BLOCKED`; unknown/unavailable -> pass-
through, no binding, no event theatre; expired binding -> no attribution; packet to a sinkhole IP with no
live binding -> no block; DNS match alone -> no block; forged bridge/native event -> rejected
(`validateSecurityEvent`); M1 path bit-for-bit unchanged; installer rejects any default route; IPv6 explicit.

## 6. Build order

Phase 1 backend (this pass) -> Phase 2 shared contracts (`PlatformCapabilityProfile`, evidence fields) ->
Phase 3 `guarddog-core` (parallel authorization table) -> Phase 4 `guarddog-vpn` (DNS/sinkhole plumbing,
the critical milestone) -> Phase 5 bridge/app wiring + local override store -> Phase 6 tests + physical
device proof (native build required, not testable in Expo Go).

## 7. Consumer UI

"Apollo's Patrol" / the consumer home experience lives in a separate project on `main`, not this repo.
`SecurityEvent` already carries every field that screen will need; wiring happens when it's merged in —
not part of this milestone.

## Phase 1 — backend (complete)

- New `gd-m2-website-gate` ruleset id, added to `GD_SIGNING_ALLOWED_RULESETS` (additive env change; M1's
  `gd-m1-controlled-block` entry untouched).
- `RuleBundleService.local_verdict(host, ruleset_id=None)`: now ruleset-parameterized (defaults to the M1
  ruleset — every existing caller's behavior is unchanged), returns `(action, ruleId, expired)` — `expired`
  distinguishes "bundle exists but past `expiresAt`" from "no bundle"/"no match" (both `expired=False`).
- `IntelligenceService.lookup(raw_url, ruleset_id=None)`: threads the ruleset id and the new
  `localRulesExpired` flag through every return path (local match, provider-cache hit, provider
  unconfigured, provider outage, cloud success).
- `IntelligenceLookupRequest.rulesetId: str | None = None` (additive, optional); `IntelligenceLookupResponse
  .localRulesExpired: bool = False` (additive); `Verdict` gains `"warn"` (type-only, forward-compatible,
  nothing produces it yet).
- `SignRequest.purpose` Literal extended with `"m2-website-gate-block"` (M1 default unchanged).
- `GET /api/config` additively exposes `gateGuard.websiteGateRulesetId`.
- New test file `tests/test_website_gate_ruleset.py`: proves the M2 ruleset signs independently of M1 (M1
  version count unchanged), that a lookup without `rulesetId` cannot see M2-only hosts (isolation), that
  the M2 ruleset resolves locally when `rulesetId` is passed explicitly, that an expired M2 bundle surfaces
  `localRulesExpired=True` and still fails open (never auto-blocks) through the cache/cloud tiers, and that
  `/api/config` exposes the new field.
- Full suite: 95 passed, 50 skipped, 0 failed. M1 frozen v25 verified unchanged after the change
  (`bundleVersion: 25`, `blocktest.btciq.app`, `block`).

## Phase 2 — shared contracts (complete)

- `PlatformCapabilityProfile` (named axes) + `ANDROID_M1_CAPABILITY_PROFILE` (faithful restatement) +
  `ANDROID_M2_CAPABILITIES` (differs by exactly `dnsVisibility`/`domainVisibility`) + shape-only
  `validatePlatformCapabilityProfile()` added to `guarddog-contracts/src/capabilities.ts`, copied
  byte-identical into `frontend/src/contracts/shared/capabilities.ts`. `ProtectionCapabilities`/
  `ANDROID_M1_CAPABILITIES`/`IOS_M1_CAPABILITIES`/`validateCapabilities()` untouched.
- `SecurityEvent` gains 9 additive optional fields (`platform`, `osVersion`, `engineVersion`,
  `enforcementMechanism`, `direction`, `actionRequested`, `actionEnforced`, `confidence`,
  `applicationIdentity`) + `verdict` gains `"warn"`, mirrored 1:1 in Kotlin `guarddog-core/.../
  events/SecurityEvent.kt` (all nullable, default `null`). `validateSecurityEvent()` validates the new
  fields only when present.
- 19/19 TS tests pass (13 existing unchanged + 6 new), both files lint clean, frontend boots clean.
- Known limitation: no local JVM/Kotlin toolchain in this environment; the Kotlin mirror change is a pure
  additive nullable-field addition, code-review verified, compilation confirmed by the `native-gates` CI job.

## Phase 3 — `guarddog-core` (complete)

- `WebsiteGateBinding` (host, sinkholeIpv4, ruleId, rulesetId, bundleVersion, expiresAtEpochMillis) +
  `WebsiteGateAuthorization` sealed class (`Bound`/`Rejected`) added to `GuardDogSDKEngine.kt` -- fully
  separate types from `BlockAuthorization`, never merged.
- New `@Volatile acceptedWebsiteGateBundle` + `ConcurrentHashMap<String, WebsiteGateBinding>
  websiteGateBindings`, parallel to (never sharing state with) `acceptedBundle`/`authorization`.
- `acceptWebsiteGateRuleBundle(rawJson)`: verifies through the same ruleset-agnostic `RuleBundleVerifier`
  (confirmed no M1-specific hardcoding in `RuleBundleVerifier`/`TrustedKeyRegistry` before this work
  started), stores into the separate M2 slot only.
- `authorizeWebsiteGateTarget(host, sinkholeIpv4, expiresAtEpochMillis)`: rule-authority chain identical
  in shape to `authorizeControlledTarget` (bundle -> canonical host exact match -> action must be
  `block`), but reads the M2 bundle slot and writes only to `websiteGateBindings`. Emits nothing --
  DNS is authorization input, never evidence.
- `reportBlockedPacket` extended: M1 branch's conditions, order, and emitted fields are textually
  unchanged except one additive, truthful field (`enforcementMechanism = evidence.enforcementLayer`,
  which already existed on `BlockedThreatEvidence` but was previously never threaded into the emitted
  event at all). Only when the M1 branch does not cover the destination does it fall through to the
  website-gate table: peeks (not removes) the binding so a non-ACTIVE rejection never destroys it (exact
  parity with how a non-matching/non-ACTIVE M1 check never mutates `authorization`); an expired binding
  is discarded (removed, no attribution); a live binding is removed (one-shot) only at the point of a
  genuine attributed block.
- New `BlockedThreatEvidence.ENFORCEMENT_LAYER_ANDROID_DNS_SINKHOLE_DROP` constant, distinct from the
  existing `ENFORCEMENT_LAYER_ANDROID_TUN_DROP`.
- New test file `guarddog-core/src/test/.../GuardDogSDKEngineTest.kt` (first-ever JVM unit test for this
  engine class -- previously only exercised by the physical-device E2E harness): binding-alone emits no
  event; a real dropped packet against a live binding produces a genuine `THREAT_BLOCKED`; bindings are
  one-shot; a packet to a sinkhole with no live binding never blocks; an expired binding is discarded
  without attribution and cannot be reused; three DNS-driven bindings alone emit zero events; rejects
  `allow`-rule/unknown-host/no-bundle/past-expiry authorization attempts; M1 and M2 bundle slots and
  authorization tables are fully independent (accepting one never touches the other; a rejected non-ACTIVE
  attempt does not destroy the binding); the ACTIVE-state gate applies identically to both branches.
  New fixture `security/test-vectors/m2-website-gate/m2_website_gate_valid_bundle.json` (deliberately
  outside `signing/`/`jcs/` so it's never swept into the pre-existing
  `test_regeneration_is_byte_identical` check, which enumerates and byte-verifies only the M1 generator's
  official outputs -- this fixture is a live-signed M2 test vector, not one of them, and adding it inside
  `signing/` broke that test on first pass; caught and fixed before Phase 3 was called complete), genuinely
  Ed25519-signed by the same test key (`gd-m1-test-ed25519-001`) already trusted by
  `TrustedKeyRegistry.m1Default()`, generated via the running backend's real `/api/rules/sign` endpoint.
- Same known limitation as Phase 2: no local JVM/Kotlin toolchain; code-review verified against the exact
  existing method signatures/enum names in the surrounding files, compilation confirmed by CI.

## Phase 4 — `guarddog-vpn` DNS/sinkhole plumbing (complete)

Exact class split from the frozen design, all new, all in `guarddog-vpn`:

- `DnsPacketClassifier`: is a parsed IPv4 packet a UDP/53 query addressed to the fixed virtual DNS
  endpoint? Nothing else in the pipeline runs unless this says yes.
- `DnsQueryParser` (+ `DnsQuery`): parses a single-question, standard-query, IN-class A/AAAA request
  with an uncompressed question name. Anything else (multi-question, response, compressed name,
  unsupported type/class, truncated) returns null -- fails open to the untouched upstream forward,
  never guessed, never blocked.
- `SinkholeBindingStore`: the decision wiring into shared-core. `arm(host)` calls
  `GuardDogSDKEngine.authorizeWebsiteGateTarget` (Phase 3) and returns a sinkhole IPv4 only for a
  genuine `block` rule match; null (allow/unknown/no-bundle/rejected) means fail open. Per-host sticky
  assignment with a free-slot-preferring round robin over the fixed pool; disclosed limitation: two
  different hosts blocked at the same instant can momentarily contend for one pool slot, bounded by
  the short binding TTL -- worst case is mis-attribution, never a missed or over-claimed block.
- `DnsResponseSynthesizer`: the only place that writes bytes back into the TUN. Builds a real
  IPv4/UDP packet (checksums included) addressed from the query's destination back to the querying
  app, preserving transaction id and question section. Three modes: sinkhole A-answer (block),
  NXDOMAIN (block + AAAA -- never leaks a real IPv6 address for an adjudicated-block host, since there
  is no IPv6 sinkhole pool), and untouched-raw-wrap (upstream forward).
- `WebsiteGatePacketAuthorizer`: merges the M1 controlled IPv4 with the fixed M2 sinkhole pool into
  one "is this a recognized enforcement destination" check for `PacketDropReporter`. Never decides
  whether a block is emitted -- only `GuardDogSDKEngine.reportBlockedPacket` does that.
- `DnsGatewayPacketHandler`: the thin orchestrator composing the above plus `UpstreamDnsForwarder`
  (fun interface; real impl `ProtectedUdpDnsForwarder` over a `VpnService.protect()`-ed
  `DatagramSocket`, abstracted behind `SocketProtector` so the pure-Kotlin classes never import
  Android types). Fail-open by construction at every step.
- `WebsiteGateAddressing` / `WebsiteGateRouteConfig`: the fixed pool, drawn from RFC 5737 TEST-NET-1
  (`192.0.2.53` DNS gateway; `192.0.2.240-243` sinkhole pool) -- never RFC1918 (LAN/router/VPN
  collision risk), never loopback (OS-level ambiguity). Hard `init` validation, not a comment.

Additive changes to existing M1 files (all verified to preserve the exact M1 call/behavior when the
new optional parameters are left at their default/null):

- `Ipv4PacketParser.udpPayloadRange()`: new method; `parse()`/`classify()` untouched.
- `PacketDropReporter`: new optional `websiteGateAuthorizer` parameter (inserted before the existing
  trailing-lambda-compatible `idGenerator` parameter, so the one existing trailing-lambda call site in
  `TunPacketReaderTest` keeps compiling unchanged). Null preserves the exact M1 matching/counting
  logic; wired in, it additionally recognizes the sinkhole pool and tags `BlockedThreatEvidence
  .enforcementLayer` accordingly -- recognition never implies emission.
- `TunPacketReader`: new optional `output`/`dnsGatewayIpv4`/`dnsGateway` parameters, all null by
  default. Null means the read loop is bit-for-bit the M1 loop (nothing ever written back). Wired in,
  a DNS-gateway packet is diverted to the handler instead of `PacketDropReporter` and any response is
  the only thing ever written to the TUN.
- `SelectiveRouteInstaller`: `TunSpec.isSelective` generalized from "exactly one /32" to "every route
  is an explicit /32, none is a default-route address" (still a hard runtime `check()`); the M1
  single-route case is an unaffected special case, proven by the existing frozen-M1 test still
  passing. New `buildWebsiteGateSpec()` (additive function, `buildSpec()` untouched) adds the fixed
  DNS gateway + sinkhole pool /32s and sets `TunSpec.dnsServers` (also additive, empty by default ->
  `addDnsServer` never called under M1).
- `GuardDogVpnService`/`GuardDogVpnRuntime`: new optional runtime fields (`websiteGateEngine`,
  `websiteGateRouteConfig`, `upstreamDnsResolverIpv4`, `websiteGateBindingLifetimeMillis`), all null/
  default until Phase 5 wires them from the bridge. `establish()` branches on
  `websiteGateRouteConfig`/`websiteGateEngine` being non-null to build the M2-aware route spec and
  construct the DNS pipeline; either missing means the service behaves exactly as before this phase.

Test files (all new, pure JVM/`kotlin.test`, same "code-review ready / CI-verified" convention as
Phase 2/3 for anything touching `android.*` types -- `ProtectedUdpDnsForwarder` itself only imports
`java.net`/`java.io` and has its own loopback-resolver unit test, independent of the real
`VpnService.protect()` call exercised only by the Phase 6 physical-device proof):
`DnsPacketClassifierTest`, `DnsQueryParserTest`, `DnsResponseSynthesizerTest`,
`WebsiteGatePacketAuthorizerTest`, `WebsiteGateAddressingTest`, `SinkholeBindingStoreTest`,
`DnsGatewayPacketHandlerTest`, `ProtectedUdpDnsForwarderTest`, `PacketDropReporterTest` (new --
M2-awareness only; the existing `TunPacketReaderTest` continues to prove the M1-only path unchanged),
`TunPacketReaderDnsGatewayTest` (new -- M2 routing only, same non-interference principle). Additive
tests appended to `Ipv4PacketParserTest`/`SelectiveRouteInstallerTest` for the new methods; every
pre-existing test in those two files, and in `TunPacketReaderTest`/`GuardDogSDKEngineTest`, was left
untouched and re-read after the edits to confirm no behavioral drift.

## Phase 5 — bridge/app wiring + local override store (complete)

- **`WebsiteGateOverrideStore`** (`guarddog-vpn`): `WebsiteGateOverrideDecision { ALLOW, NONE }` --
  structurally no `BLOCK` value exists anywhere in this type. `NoWebsiteGateOverrides` (M1-equivalent
  default) + `MutableWebsiteGateOverrideStore` (thread-safe, canonicalized-key, in-memory session
  cache the DNS pipeline consults synchronously). Wired as a new optional, defaulted parameter into
  `SinkholeBindingStore.arm()`: an ALLOW override short-circuits *before* the rule-authority chain
  runs, so an overridden host never arms a binding -- structurally the same "no binding, no possible
  block" property Phase 3/4 already proved for allow/unknown hosts. `SinkholeBindingStoreTest` gained
  4 new cases proving the override beats a real signed `block` rule, is fully reversible, doesn't
  affect unrelated hosts, and that the new parameter is genuinely additive (existing Phase 4 call
  sites/tests unchanged). `WebsiteGateOverrideStoreTest` (new, 6 cases) proves the store itself in
  isolation: canonicalization, set/unset, snapshot, and rejecting a host that fails canonicalization.
- **Bridge** (`guarddog-expo-module`): `GuardDogExpoModule` gets one `MutableWebsiteGateOverrideStore`
  instance (session-scoped, never persisted natively) plus 6 new sync functions --
  `configureWebsiteGate`, `acceptWebsiteGateRuleBundle`, `getWebsiteGateStatus`,
  `setWebsiteGateAllowOverride`, `getWebsiteGateOverrides`, `clearWebsiteGateOverrides` -- all
  additive; no M1 function signature or behavior touched. `getWebsiteGateStatus().dnsGatewayActive`
  is read directly from `GuardDogVpnRuntime.websiteGateActive` (only ever set by a live TUN session
  that actually built the DNS gateway pipeline), never derived from "configured" alone.
  `GuardDogExpoModuleDefinitionTest` asserts the exact registered function-name set (regression test
  for the Pika-compiler physical-device blocker found during M1) now includes all 6 new names.
- **JS bridge types** (`frontend/src/sdk/nativeModule.ts`, mirrored in
  `packages/guarddog-expo-module/src/index.ts`): `NativeWebsiteGateStatus` + the 6 new method
  signatures on `GuardDogNativeModule`, additive only.
- **Shared contracts — `websiteGateOverrides.ts`** (new file, `packages/guarddog-contracts/src`,
  synced byte-identical into `frontend/src/contracts/shared/` by the now-fixed `sync-to-app.mjs`):
  the durable override *record* shape (`{ host, type: "allow", source: "user", decidedAt }`) plus
  pure `upsertWebsiteGateOverride` / `removeWebsiteGateOverride` / `pruneWebsiteGateOverrides` /
  `validateWebsiteGateOverrideRecord` / `validateWebsiteGateOverrideList`. **Structural invariant**:
  `type` is a TS literal union of exactly one value, `"allow"` -- there is no "block" (or any other)
  variant in the type or in the validator, so a corrupted/tampered/future-buggy persisted record can
  never be resurrected as a block. Bounded to `MAX_WEBSITE_GATE_OVERRIDES = 500`, oldest-by-`decidedAt`
  evicted first, so the durable record can never grow unbounded across app restarts. 11 new
  `node --test` cases (30/30 total in the package, up from 19/19 after Phase 2) cover: canonicalized
  add/dedupe/refresh, reversible remove (incl. no-op on an unrelated/invalid host), the eviction
  bound, and -- the explicit proof this milestone required -- a validator test that a record tampered
  to `type: "block"` (or any non-`"allow"` value) is rejected outright, plus a mixed-corruption list
  test proving malformed/tampered entries are dropped rather than trusted.
- **Durable JS store** (new, `frontend/src/sdk/websiteGateOverrides.ts`): thin `storage` (AsyncStorage)
  glue around the pure contracts module -- single bounded JSON blob under
  `guarddog.websiteGate.overrides.v1`; failed reads/corrupted blobs fail safe to empty, never throw or
  trust unvalidated data. This is the source of truth across app restarts; the native
  `MutableWebsiteGateOverrideStore` is intentionally session-only (matches how
  `GuardDogVpnRuntime.config` is re-pushed every bridge session) and is rehydrated from here.
- **`GuardDogSecuritySDK.ts`** (public SDK boundary): additive Website Gate surface --
  `configureWebsiteGate`, `acceptWebsiteGateRuleBundle`, `getWebsiteGateStatus`,
  `setWebsiteGateAllowOverride` / `removeWebsiteGateAllowOverride` / `getWebsiteGateOverrides` /
  `clearWebsiteGateOverrides` (all persist to the durable JS store first, then mirror into the native
  session cache) and `hydrateWebsiteGateOverrides` (pushes every persisted record into the native
  cache once per bridge session). **Truthful capability reporting**:
  `getPlatformCapabilityProfile()` returns `ANDROID_M2_CAPABILITIES` *only* when
  `getWebsiteGateStatus().dnsGatewayActive` is currently `true` (a live TUN session actually built the
  DNS pipeline); otherwise `ANDROID_M1_CAPABILITY_PROFILE`; `null` on iOS/web/Expo Go (Website Gate
  does not apply there) -- never a fabricated claim merely because the app version supports it. Zero
  M1 methods/signatures on the class were touched.
- **Invariant proof, explicit**: the override type can never represent a block (contracts validator
  test, above); `arm()` short-circuits to "no binding" on ALLOW (`SinkholeBindingStoreTest`, above),
  and Phase 3's `armingAloneNeverEmitsAnyEvent` already proves arming/DNS alone never emits an event
  -- so an override, which can only ever prevent an arm, is two structural layers removed from
  `THREAT_BLOCKED`, which (unchanged since M1) only ever comes from
  `GuardDogSDKEngine.reportBlockedPacket()` given a real, dropped TUN packet.
- Consumer UI ("Apollo's Patrol") wiring is out of scope per §7 -- this phase only adds the SDK/bridge
  surface; no screen in this repo's harness app (`frontend/app/index.tsx`) was changed.
- Verification in this environment: `guarddog-contracts` 30/30 `node --test` passing; ESLint clean on
  all new/changed frontend files; Expo web bundle rebuilds clean (953 modules, was 950), harness
  screen boots with no console errors, `nativeAvailable: false` truthfully reported (no native module
  in web preview). Native compile + the Kotlin-side tests above are the same "code-review ready,
  CI-verified" convention as every other native-only change this milestone -- confirmed by the
  `native-gates` CI job, not runnable in this sandbox (no JVM/Android toolchain here).

## Phase 5.1 — Android capability-truth correction (Gate Guard M2 branch only, not a shared-schema change)

Scoped, standalone correction on `m2-native-acceptance`, independent of the Phase 5 write-up above.
**Not** a redesign of `PlatformCapabilityProfile`, `SecurityPlatformAdapter`, or `EnforcementEvidence`
(that shared cross-platform model is a separate stream's ownership) -- no field was added, removed, or
retyped; iOS, backend, and M1 were not touched.

- **Problem**: `ANDROID_M2_CAPABILITIES.dnsVisibility`/`domainVisibility` were `true` with no
  documented scope. Android Private DNS (DoT, device-level, entirely outside plaintext UDP/53) and
  app-embedded DoH (HTTPS to a hardcoded resolver, indistinguishable from other HTTPS/443 traffic)
  both bypass Apollo's DNS-triggered sinkhole completely -- an unscoped `true` risks being read as
  system-wide/universal DNS visibility, which was never proven and is not true.
- **Correction, deliberately narrow**: values were **not** flipped to `false` (that would erase the
  one real, CI-verified capability gain this milestone built) and no new field was added to
  `PlatformCapabilityProfile` (that would be exactly the shared-schema redesign this correction must
  avoid). Instead: (1) `PlatformCapabilityProfile.dnsVisibility`/`domainVisibility`'s doc comments were
  generalized to state every boolean in this interface is scoped to what the platform's own mechanism
  actually observes, never universal device-wide coverage -- a documentation clarification applicable
  to any platform, not an Android-only carve-out; (2) `ANDROID_M2_CAPABILITIES` got an expanded doc
  comment naming the two bypasses explicitly; (3) new exported, testable constant
  `ANDROID_M2_DNS_VISIBILITY_SCOPE` (a plain string, not a `PlatformCapabilityProfile` field) states the
  limitation for any consumer that surfaces capabilities to a user/analyst to quote verbatim, instead
  of re-deriving or mis-stating it.
- **Tests**: new `securityEvent.test.ts` case locks in that the values were *not* flipped (still
  `true`/`true`) and asserts the new constant names both bypasses (Private DNS/DoT, DoH) and explicitly
  disclaims system-wide/universal coverage. `guarddog-contracts` suite: **31/31 passing** (was 30/30).
- **Deferred, not silently dropped**: a formally-typed `coverageScope` (or similar) axis distinguishing
  "some traffic" from "all traffic" is shared cross-platform contract work for the separate Apollo/main
  stream; if/when it lands there, M2 should adopt it rather than inventing a competing version here.
- No Kotlin file references `dnsVisibility`/`domainVisibility`/`PlatformCapabilityProfile` today --
  this capability is synthesized entirely at the JS/SDK layer
  (`GuardDogSecuritySDK.getPlatformCapabilityProfile()`) from the live native `dnsGatewayActive` flag,
  so this correction is TS/contracts-only; no native (Kotlin/Swift) file needed a change.

## Phase 5.2 — architectural duplication flagged: two independent native Android VPN stacks (not reconciled)

**Finding (verified against `github.com/zelnix/Apollo`, fetched into this sandbox as `origin`):** the
separate Apollo product/UI stream on GitHub `main` has its own complete, independent native Android
DNS-filtering VPN implementation -- `frontend/modules/apollo-security/android/.../com/hucentai/apollosecurity/`
(`ApolloDnsVpnService.kt`, `ApolloSecurityModule.kt`, `EnforcementEvidence.kt`, `SiteGuardTruth.kt`,
`DnsPacket.kt`), bridged via its own Expo native module and its own TS contract
(`frontend/src/security/{PlatformCapabilityProfile,SecurityPlatformAdapter,NativeSecurityAdapters}.ts`,
using a tri-state `CapabilityLevel = "full"|"partial"|"none"` plus `ProtectionStatus.coverageScope:
string[]`, e.g. `["dns:udp-53"]`). This is entirely separate from Gate Guard's `com.guarddog.*` stack
in this repo (`packages/guarddog-android-sdk`, `packages/guarddog-expo-module`) -- different package,
different files, different native bridge, independently built across this milestone's 5 phases and
111+ CI-verified tests.

**This was NOT known before this correction pass** (main had only been reviewed for its shared-contract
changes, not identified as also shipping a second, competing native Android VPN engine). **Flagged as
an architectural duplication/coordination issue for the product owner to resolve -- explicitly not
reconciled, merged, wrapped, or cross-wired by this branch.** Decision recorded: prove Gate Guard's own
`com.guarddog.*` stack on a physical device first (this milestone's remaining goal, Phase 6); a
dedicated **Android Native Consolidation** milestone will then make the deliberate call on which native
stack survives (current lean: Gate Guard becomes the canonical native engine, `com.hucentai.apollosecurity`
retired or thinned to an adapter -- not decided or acted on here).

**Consequence for the Phase 5.1 correction above**: `main`'s `PlatformCapabilityProfile.ts`/
`SecurityPlatformAdapter.ts` were deliberately **NOT copied or wired into this branch** -- doing so
now, before the two native stacks are unified, would risk making Gate Guard look integrated with
Apollo's product layer when it isn't, and would create a second, drifting copy of that contract.
Gate Guard's own boolean-only `PlatformCapabilityProfile` (`packages/guarddog-contracts`) is kept
exactly as `true`/`true` for `dnsVisibility`/`domainVisibility` -- per product decision, **not
redesigned to a tri-state now** even though main's contract already has one. Instead:
`ANDROID_M2_DNS_VISIBILITY_SCOPE` (exported string, unchanged shape) now also names the concrete scope
tag `"dns:udp-53"` inline, and a new standalone constant `ANDROID_M2_DNS_COVERAGE_TAG = "dns:udp-53"`
was added -- in the same tag vocabulary as main's `coverageScope`, but **not that type, not imported
from it, not wired into anything shared**; a plain, disconnected constant until the two stacks are
deliberately unified. 2 new tests (32/32 total, was 31/31): the new tag's exact value, and that the
scope-disclosure string names it. No `PlatformCapabilityProfile`/`ProtectionStatus` interface anywhere
in this repo was touched.

**Reminder for Phase 6 (physical-device acceptance, next)**: the backend used for the end-to-end
device test must include the Biting/Truth-of-State backend invariant that just landed on `main`
(reject synthesized/unearned block evidence server-side) -- otherwise a real native block could be
proven against stale/older server semantics. Confirm which backend service the acceptance environment
actually points at before running the device test. Also: Expo Go/web preview cannot validate this
milestone's native DNS/VPN path at all (TUN, `VpnService`, DNS interception) -- Phase 6 requires the
generated native Android development/release build, not the Expo Go QR route.
