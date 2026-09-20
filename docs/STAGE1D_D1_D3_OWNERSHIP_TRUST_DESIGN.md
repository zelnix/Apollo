# D1 + D3 — concrete Android ownership and trust design

**Source inspected:** `956db060ec6905877371eeaeb703286f0b9c8f81`.
**Frozen source:** `e5d11be912c76775c5a8b27b53218211484ca8bd`, 91-file manifest unchanged.
**Scope:** concrete design / feasibility only. No runtime or packaging changes made.
Stage 1C.1 launch remains **PASS**. Stage 1D implementation / production cutover remain **NOT APPROVED**.

**D3 policy correction:** this document's first revision incorrectly proposed APK-pinned
everyday bundle keys / APK-only rotation. That proposal is **WITHDRAWN**, not a replacement
for Stage 0 §§9–10. The governing primary/recovery-root → signed runtime manifest → bundle-key
architecture and required certified interfaces are now specified in
`STAGE1D_D3_SIGNED_MANIFEST_RECONCILIATION.md`. D1's conditional topology remains unapproved.

## 1. Decision to make — not another generic integration plan

**The original “Apollo JS facade → frozen GuardDogSecurity bridge” topology cannot be given
production trust through its current public API.** Its private engine is constructed with a
fresh test-key registry, with no injectable registry, verifier, engine owner or trust update API.
`configure` and a signed rule bundle do not change that registry.

**Concrete alternative recommended for separate architecture review:** one process-lifetime
Apollo-owned native runtime, calling the public frozen **core + VPN SDK** directly, with the
frozen Expo bridge **excluded from Android autolinking/compilation**. Keep all its source files
unchanged on disk. Inject approved public trust at the SDK's public constructors. This changes
the proposed integration boundary; it is not a silent implementation detail or approval to edit.

| Topology | D1 ownership | D3 trust | Disposition |
|---|---|---|---|
| Existing `ApolloSecurity` + frozen `GuardDogSecurity`, Apollo only consumes bridge APIs | Existing Apollo module contains no GuardDog constructor; frozen bridge owns an engine per module `OnCreate`. Process/context-lifetime uniqueness is not proved. | Bridge initializes only its private test registry; cannot inject production keys through exposed functions. | **No production integration through this bridge as-is.** Any explicitly approved test-only use needs its own bounded lifecycle proof. |
| Add an Apollo-owned engine while leaving the frozen bridge registered | Both can initialize engines/write shared reporter, engine and consent references even with no VPN active; a live reader captures an older reporter. | New production registry would not update the frozen bridge's hidden verifier. | **REJECT.** Last-writer-wins is not ownership; starting only one VPN does not fix it. |
| Apollo-owned native owner + frozen core/VPN; exclude frozen Expo bridge | Exactly one planned construction/publishing site; bridge competition is prevented by build topology. | Public constructors/registry mutation are usable primitives, but a certified signed-manifest/authority controller is missing. | **Source/API-feasible ownership direction**, not implementation of the agreed production trust architecture. Requires D3 reconciliation interfaces and native acceptance. |
| Keep both native modules loaded and require production injection into the frozen bridge | No public ownership transfer/adoption contract exists. | No public production-trust injection API exists. | **DEFER** unless the engine owner supplies a separately approved/certified bridge revision. Do not patch the current frozen source. |

**Important:** excluding the bridge is NOT proof that two competing owners coexist safely.
It deliberately forbids that topology. If retaining both `ApolloSecurity` and `GuardDogSecurity`
in the production APK is mandatory, the recommended alternative is not authorized and the
current frozen-bridge production route must be deferred. Reviewer approval of this boundary
change is the immediate architectural decision requested.

## 2. Source evidence supporting the verdict

All paths below are relative to `frontend/`.

| Evidence | Exact source / implication |
|---|---|
| Hidden test verifier/engine | `packages/guarddog-expo-module/android/src/main/java/com/guarddog/expo/GuardDogExpoModule.kt:58–59,73–101`: private engine; `RuleBundleVerifier(TrustedKeyRegistry.m1Default(), …)`; assigns shared runtime references and consent callback. |
| No trust parameter | Same file `107–128`: configuration changes route/DNS inputs; bundle acceptance invokes the already constructed verifier. `TrustedKeyRegistry.kt:28–32` labels `m1Default` test-only. Modifying a newly created registry elsewhere cannot mutate this private instance. |
| Re-creation is not ownership transfer | Bridge event/state unsubscribe handles at `76–79` are not retained; no bridge `OnDestroy` cleanup exists. `GuardDogSDKEngine.kt:72–79` registers a state listener at construction without retaining its disposer; event listeners do have explicit removal handles. Multiple module generations must not be treated as one lifetime owner. This is source evidence, not a claimed device reproduction. |
| Captured reporter | `guarddog-vpn/.../GuardDogVpnService.kt:82–104,112–135` captures the reporter before async resolution and passes it to `PacketDropReporter`; that class stores it in a private constructor field (`31–35`). Reassigning the global later does not retarget the live reader. |
| Supported independent constructors | `guarddog-core/.../GuardDogSDKEngine.kt:57–62`, `rules/RuleBundleVerifier.kt:39–43`, `rules/TrustedKeyRegistry.kt:10–25`, `rules/BundleVersionStore.kt:23–28`. No reflection or source edit is required to construct an Apollo-owned engine with other trusted public keys. |
| Runtime assignment boundary | `guarddog-vpn/.../GuardDogVpnService.kt:23–50`: config/reporter/resolver/M2 references are public setters; activeSession/dropReporter/websiteGateActive have SDK-internal setters. Apollo must not take ownership of those service-managed fields. |
| One service process / fail-closed restart | VPN manifest: service is not exported, no separate `android:process`, always-on unsupported. Service `71–86`: `START_NOT_STICKY`, null restart fails, config/reporter missing fails. Runtime must be rebuilt from validated inputs, not a persisted running flag. |
| Exclusion mechanism | Installed `expo-modules-autolinking/src/commands/autolinkingOptions.ts:90–127,146–166` supports platform-specific `exclude` and CLI exclusion. Read-only query excluding `guarddog-expo-module` retained `apollo-security`. Actual config was not changed. |

The frozen `getPhase6DeviceProvenance` string naming `com.guarddog.*` is a constant module
identity, **not proof of owner uniqueness, a live TUN or which stack is enforcing**. Likewise,
one autolink registration is not an instrumented runtime constructor count.

## 3. Recommended owner: `ApolloGuardDogRuntime`

### 3.1 Process lifetime and exact ownership

Proposed Kotlin object in Apollo's own module:
`com.hucentai.apollosecurity.guarddog.ApolloGuardDogRuntime`.

- Holds application context only; no retained React context/activity in the engine owner.
- A serialized initialization lock/actor creates **at most one engine for the process**.
  `ensureInitialized()` returns that same owner/engine on repeated/concurrent module attaches.
- Owns registry, verifier, version store, engine, the one engine-event subscription, its one
  state observer, OS-consent observation callback, approved configuration and lifecycle commands.
- React module instances are subscribers/permission-dialog delegates only. Attach returns a
  removable subscription; `OnDestroy` removes that consumer, not the process-owned engine/TUN.
- No engine reconstruction on JS reload, activity recreation, stop/start, rules refresh or
  listener reconnect. The SDK retains a state listener internally, so rebuilding engines
  inside one process would leave old observers unless a separate lifecycle design were added.
- Process death ends the owner; next process verifies trust/store/bundle again. Never restore
  ACTIVE from disk. Missing configuration/trust/version store means **not initialized / blocked**.

### 3.2 Construction and publishing sequence

Design pseudocode, using real frozen constructor signatures; **not implemented code**:

```kotlin
val registry = TrustedKeyRegistry(verifiedManifestActiveBundleKeys)
val versions = ApolloGuardDogBundleVersionStore(applicationContext, profileNamespace)
val verifier = RuleBundleVerifier(registry, versions, SystemClock)
val engine = GuardDogSDKEngine(verifier, VpnStateRepository.shared, SystemClock)
```

Within the single owner's initialization transaction:

1. Verify compiled native profile and topology: vendor Expo bridge absent, one Apollo module,
   expected frozen libraries; do not accept profile/keys from JavaScript. In legacy profile,
   do **not** construct or publish a GuardDog engine at all.
2. Load the two approved bootstrap roots, a certified-verified manifest snapshot and the
   durable trust/bundle stores (§4). The registry contains manifest-authorized bundle keys,
   not the roots themselves. The required manifest controller is not in the frozen snapshot.
   On failure, publish
   no reporter/config and expose a qualified initialization error. Never substitute test trust
   or an in-memory production store to keep startup looking successful.
3. Construct the one engine with the existing `VpnStateRepository.shared`; register one
   removable engine-event listener and one owner-level observation listener. Capture the
   returned unsubscribe handles for owner-managed subscriptions. Service state stays authoritative.
4. Install a live consent callback using application context; observation failure is recorded
   as unavailable/degraded, not presented as newly verified consent from cached values.
5. Require no active/starting GuardDog session or foreign pre-existing reporter. Publish the
   approved runtime references before any start command. M1-only initial scope: M2 engine/
   route config remain null and override store remains `NoWebsiteGateOverrides`.
6. Admit/verify the signed M1 bundle and approved controlled host/IP binding before start.
   The owner alone calls authorization and service start, following the existing authority
   chain. A raw service intent or `config != null` is not sufficient product authorization.
7. Start/stop completion uses D6's observed lifecycle rules; no success from a command return.
   Stop clears authorization and closes the service through its lifecycle, but does not create
   a replacement engine. New rule admission/reconfiguration waits for observed stop first.

| Shared item | Writer / lifetime policy |
|---|---|
| `GuardDogVpnRuntime.reporter` | Owner publishes its engine; never replaced while starting/active. Foreign non-null identity is a fatal ownership violation. |
| `.config`, `.resolver` | Owner after approved native configuration; no arbitrary JS route/resolver injection. Reconfiguration only while stopped. |
| `.websiteGateEngine`, `.websiteGateRouteConfig`, upstream/binding lifetime | Disabled for initial M1 scope. Later M2 would use the same engine and a separate approved plan, never a second owner. |
| `.websiteGateOverrideStore` | `NoWebsiteGateOverrides` initially; no implicit generic-unblock allow override. |
| `.activeSession`, `.dropReporter`, `.websiteGateActive` | Frozen VPN service owns these internal setters; owner reads them for evidence. No spoofing them to satisfy status checks. |
| `VpnStateRepository.shared` lifecycle | SDK service writes its native lifecycle. Owner records genuine consent results; it does not manufacture Running/Stopped for acknowledgement or timeout. |
| Listener/event sinks | One native engine-event sink in the owner; bounded client subscriptions may attach/detach. Evidence identity remains native; buffering/delivery still needs D4/P0-05 work. |

### 3.3 Enforce topology, do not merely document it

For the proposed direct-SDK topology, Android autolinking excludes `guarddog-expo-module`
(platform setting under `expo.autolinking.android.exclude`). Frozen source remains present
and hash-checked. Apollo's native module directly depends on `:guarddog-core` and `:guarddog-vpn`;
the existing plugin continues including those Gradle projects and checking source provenance.

Required build checks: resolved autolink JSON, generated module provider, Gradle dependencies
and final APK class/provider inventory must show **ApolloSecurity present; GuardDogExpoModule
absent from registration/compilation**. APK absence is not established by the CLI query alone.
CI fails if the vendor bridge is reintroduced in an owner-enabled profile. Fail initialization
on unexpected shared runtime ownership; never overwrite it and continue.

This explicitly replaces the proposed two-module ownership proof with a **prohibited-topology
negative test**, requiring review approval. In the unchanged current build both modules still
register; no claim is made that this alternative is already applied.

## 4. Corrected trust configuration: pinned roots, runtime signed manifest

The prior APK-only everyday key rotation model is withdrawn. Read
`STAGE1D_D3_SIGNED_MANIFEST_RECONCILIATION.md` for the authoritative reconciliation with
Stage 0 §§9–10; do not implement production trust from the superseded first revision.

### 4.1 Profiles and bootstrap ownership

Native profiles remain proposed **LEGACY / GUARDDOG_ACCEPTANCE / GUARDDOG_PRODUCTION**; JS
cannot change trust mode. LEGACY remains default; no production-default cutover is approved.
Acceptance roots/keys/ledgers are separate and do not confer production assurance.

The production native bootstrap asset is `apollo-guarddog/bootstrap-roots.json`: two
distinct PRIMARY/RECOVERY public root keys, IDs/fingerprints/roles, schema/profile/trust domain.
It does **not** statically select all ordinary bundle keys. A root-authenticated, valid,
non-rolled-back manifest supplies those keys at runtime through the single owner's certified
trust controller. Roots must not become ordinary bundle signers, and a fetched key is never
trusted simply because a backend or JS supplied it.

No private keys ship. The frozen core may still contain the public test-key literal; the
production root set and effective bundle-key registry must exclude certification test trust.
Do not mistake removal of a literal from the APK for a functioning trust protocol.

### 4.2 Runtime update and persistent authority

- Primary/recovery roots authenticate the signed Trusted Key Manifest, with active/revoked
  bundle keys, validity, overlap, trust-version rollback protection and certified recovery roles.
- The same native owner/controller applies verified changes; it does not create a new engine
  for every update or expose unrestricted JS registry setters. Ordinary key rotation happens
  through verified manifests and signed bundle updates **without an APK update**.
- Cache signed last-known-good manifests and raw signed bundles, authenticated hashes,
  trust-set/recovery floors and separate bundle-version floors. Rejected/tampered updates do
  not replace valid caches; corruption/failed writes are not an empty-store recovery strategy.
- Coordinate reader/admission quiescence, registry update and revalidation/invalidation of
  **both M1 and M2** accepted bundles and derived bindings before reporting the new generation
  applied. `trust/retire` alone does not clear private accepted authority. Required certified
  T1–T5 semantics and staged/committed receipts are defined in the reconciliation document.
- Apollo transports raw signed updates and consumes diagnostics. The engine owner must
  provide/certify manifest verification, recovery and authority-transition logic, consistent
  with Stage 0 ownership. This is not permission to rebuild trust algorithms in the Apollo shim.

### 4.3 Three separate validity cases, not instantaneous offline revocation

1. **Known expiry:** authenticated deadlines remain meaningful offline; if no valid successor
   exists, invalidate affected authority and observe the defined teardown/recovery. No unsigned
   grace period or fabricated fresh verification is introduced.
2. **New verified revocation:** close new affected admission, durably record/apply the new trust
   generation, invalidate affected existing authority and observe completion. Never fall back
   to a now-revoked cached key merely because replacement delivery fails.
3. **Offline without knowledge of a newer revocation:** keep valid last-known-good rules for
   locally known-bad traffic; unknown/unverified traffic fails open. Backend failure alone does
   not kill ordinary connectivity. Revocation discovery waits for reconnect/verified update,
   with known cached expiry independently limiting use. This delay is an acknowledged policy
   limitation, not a missing promise of instantaneous offline revocation.

The current verifier validates expiry at admission; the packet reporter calls back after a
drop. Event suppression is not packet prevention. The required production contract is explicit,
measured validity/invalidation/shutdown behavior (including failed bounds and in-flight work),
not an invented zero-latency global guarantee. Existing primitives may be reused where the
engine owner can certify the accepted semantics; missing capabilities require approved upstream
work. No frozen source edits or runtime tests occurred here; D3 production approval remains open.

## 5. Exact conditional files for the recommended alternative

This **replaces**, rather than silently supplements, the earlier JS-facade-only ownership
proposal if approved. It is a larger native boundary change; all entries below remain proposed.

| Candidate file | Concrete responsibility |
|---|---|
| `frontend/package.json` | Android autolinking exclusion only; keep dependency versions, lockfile and SVG pin unchanged |
| `frontend/modules/apollo-security/android/build.gradle` | Direct core/VPN project dependencies and native profile/generated-asset wiring, with no vendor-source edits |
| `frontend/plugins/withGuardDogEngine.js` | Preserve library includes/provenance; assert correct bridge-excluded topology when Apollo ownership is selected |
| `frontend/plugins/withApolloGuardDogOwner.js` (new) | Produce native profile and approved two-root bootstrap input; never substitute APK-only ordinary bundle-key trust; reject mixed/missing profiles |
| `frontend/app.json` | Register that Apollo-owned plugin only after topology/design approval; no application ID or production default change implied |
| `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt` | Attach/detach from the process owner; route selected operations, guard legacy service start in GuardDog mode, retain non-enforcement features |
| `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/guarddog/ApolloGuardDogRuntime.kt` (new) | Single engine/verifier/registry owner and shared runtime publishing; no arbitrary second engine or ownership replacement |
| `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/guarddog/ApolloTrustBootstrapConfig.kt` (new) | Load profile and pinned PRIMARY/RECOVERY roots for the certified manifest controller; no local reimplementation or private keys |
| `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/guarddog/ApolloGuardDogBundleVersionStore.kt` (new) | Durable monotonic version + signed-envelope identity, atomic writes and explicit failure/recovery |
| `frontend/scripts/guarddog-ownership-preflight.cjs` (new) | Check profile-specific autolink/provider/dependency topology; fail attempted dual ownership before build |
| `frontend/tests/guardDogOwnerPackaging.test.cjs` (new) | Test profile/config generation and expected/forbidden registrations without editing frozen packages |
| `frontend/modules/apollo-security/android/src/androidTest/java/com/hucentai/apollosecurity/guarddog/ApolloGuardDogOwnershipTest.kt` (new) | Concurrent/repeated module attach, React reload, object identities, listener counts and prohibited bridge inclusion |
| `frontend/modules/apollo-security/android/src/androidTest/java/com/hucentai/apollosecurity/guarddog/ApolloGuardDogTrustTest.kt` (new) | Test/prod rejection, signed admission, expiry/revocation limitations, persistence/error and restart cases |

This native allow-list is **not sufficient on its own**: the certified signed-manifest and
authority-controller interfaces requested in the D3 reconciliation must be delivered first.
Actual root/public inputs and signed manifests/bundles are provisioned separately; no placeholder
key or fake production bundle is proposed for shipping. Test-framework wiring must be reviewed with the
build file before implementation. D2's CE-01 and D4–D6 adapter/evidence/lifecycle work remain
separate prerequisites; this document does not approve their files or UI/backend/P0 fixes.

## 6. Proof required and what was actually checked

| Check | Required evidence / result |
|---|---|
| Current registration (performed, read-only) | Normal autolinking resolves one `ApolloSecurityModule` and one `GuardDogExpoModule`; current packaging is unchanged. |
| Alternative registration (performed, CLI option only) | `npx expo-modules-autolinking resolve --platform android --exclude guarddog-expo-module --json` resolves Apollo but excludes the vendor Expo module. Does not constitute a build/runtime test. |
| Frozen integrity (performed) | All 91 files match the certified manifest. |
| Public constructor/source trace (performed) | Explicit constructor injection exists in core; private hardcoded trust and shared-reference writes exist in current bridge; no public injection/owner transfer was found. |
| Native owner proof (NOT RUN) | Native constructor count/owner identity remain one across simultaneous/repeated attaches, activity/React recreation and start/stop; event subscription counts do not grow. Consumer count may vary; engine count must not. |
| Both-module negative (NOT RUN) | Deliberately include the vendor bridge in an owner-enabled build: preflight/APK registration check fails. Runtime foreign-reference check must refuse initialization, never overwrite it. This is exclusion evidence, not a coexistence claim. |
| Live reader safety (NOT RUN) | No reporter/config replacement during async start or a live TUN; captured reporter identity remains the owner; recovery verified before reconfiguration. |
| Test/prod trust separation (NOT RUN) | Production refuses known/renamed test key, wrong profile, unknown key, invalid signature, mismatched ruleset and corrupt/missing store; no fallback. Acceptance fixtures never confer production approval. |
| Persistence/rotation (NOT RUN) | Root-verified runtime manifest rotation/revocation without an APK update; independent trust/bundle floors and recovery state; exact replay idempotent, same-version conflict rejected; interrupted apply cannot falsely report installed or restore durably revoked trust. |
| Runtime validity (NOT RUN / production blocker) | Separately test known expiry, newly verified revocation and offline valid cache/unknown revocation; record admission/stop/quiescence/recovery bounds and failures. A post-drop callback cannot prevent a drop; no instantaneous offline knowledge guarantee is claimed. |

Every device test still needs source SHA + APK build identifier/hash + device/OS/profile and
original native evidence. No native build/emulator/device tests were performed here. Native
packet proof is distinct from full Patrol delivery, which remains blocked by P0-05; call
rejection negative remains required under P0-03. All six original P0 findings remain OPEN.

## 7. Approval disposition

1. **Reject production trust injection through the existing frozen Expo bridge:** concrete
   public API is absent; a JS configuration layer cannot supply it.
2. **Review the direct-SDK / excluded-bridge native topology above** as a scope change, or require
   both modules to remain registered and defer production until a new certified bridge supports
   explicit process ownership and trust injection. Do not mix the two designs.
3. For the alternative, retain Stage 0's primary/recovery roots and runtime signed-manifest
   architecture. Obtain the engine-owner certified T1–T5 semantics, actual bootstrap inputs
   and measured validity/shutdown evidence before production approval. Constructor feasibility
   and APK-pinned bundle keys are not substitutes for the agreed trust architecture.

**D1/D3 now have a concrete source-backed design and feasibility verdict, but remain OPEN for
reviewer disposition / unresolved production guarantees. Stage 1D is NOT STARTED.** D2, D4,
D5 and D6 are unchanged and not implicitly resolved. No contract extension or default cutover
is approved. The earlier eight-document sync at `956db060` remains verified; this new focused
design and its handoff updates require a subsequent Save to GitHub / remote verification.