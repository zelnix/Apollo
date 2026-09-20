# D1 + D3 — concrete Android ownership and trust design

**Source inspected:** `956db060ec6905877371eeaeb703286f0b9c8f81`.
**Frozen source:** `e5d11be912c76775c5a8b27b53218211484ca8bd`, 91-file manifest unchanged.
**Scope:** concrete design / feasibility only. No runtime or packaging changes made.
Stage 1C.1 launch remains **PASS**. Stage 1D implementation / production cutover remain **NOT APPROVED**.

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
| Apollo-owned native owner + frozen core/VPN; exclude frozen Expo bridge | Exactly one planned construction/publishing site; bridge competition is prevented by build topology. | Public constructors support an independent non-test registry and durable version store. | **Source/API-feasible alternative**, subject to approval, compilation/device proof and the production limitations in §6. Not a production sign-off. |
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
val registry = TrustedKeyRegistry(validatedProfilePublicKeys)
val versions = ApolloGuardDogBundleVersionStore(applicationContext, profileNamespace)
val verifier = RuleBundleVerifier(registry, versions, SystemClock)
val engine = GuardDogSDKEngine(verifier, VpnStateRepository.shared, SystemClock)
```

Within the single owner's initialization transaction:

1. Verify compiled native profile and topology: vendor Expo bridge absent, one Apollo module,
   expected frozen libraries; do not accept profile/keys from JavaScript. In legacy profile,
   do **not** construct or publish a GuardDog engine at all.
2. Load/validate approved public pins and the durable version store (§4). On failure, publish
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

## 4. Concrete trust configuration: build-pinned native profiles

### 4.1 Profiles and input contract

Use a native build-selected, immutable profile: **LEGACY / GUARDDOG_ACCEPTANCE / GUARDDOG_PRODUCTION**.
These names are proposed native configuration, not current app settings. A JS selector must
agree with the native profile; it cannot change trust mode, trusted keys or route authority.

| Profile | Construction / allowed use |
|---|---|
| LEGACY (retained default) | Existing Apollo protection; no Apollo-owned GuardDog initialization. No default cutover in this task. |
| GUARDDOG_ACCEPTANCE | Explicitly approved, labelled test-only APK and controlled target. Separate test pins, rule namespace and version ledger; test signer stays outside the app. No public/pilot production assurance from this profile. |
| GUARDDOG_PRODUCTION | Only separately approved production public keys, rule authority and target scope. Reject the certified test key by **both key ID and raw key bytes**, including renamed copies. Missing/invalid production pins block initialization. |

Concrete provisioning artifact: one build-selected native asset
`apollo-guarddog/trust.json`, generated from a reviewed build input, covered by the APK's
application-signing chain. Required fields: schema version, profile, trust configuration
version, authorized key IDs with 32-byte Ed25519 public keys/fingerprints, permitted ruleset
IDs/purpose, packaged minimum version/envelope floors where defined, and configuration ID.
Validate these against expected release inputs before `TrustedKeyRegistry(map)` construction.
Native compiled profile and asset profile must agree. Test/prod assets never substitute for
each other; production owner must never call `m1Default()`.

Only public keys go into the APK. The frozen core itself contains the public test-key constant;
therefore **do not claim that its literal bytes disappear from the APK**. The enforceable check
is that the active production trust map excludes that key and the production construction path
does not invoke the test factory. Private signer material never ships or appears in logs.

**Ownership of inputs:** a named Apollo release/security approver must provide/approve public
key fingerprints, rule-signing authority and scope; the build process packages the approved
artifact; the native owner is the only runtime registry constructor. No particular individual,
production key, ruleset or controlled production endpoint has been supplied/approved yet.
Those are concrete provisioning blockers, not permission to use the certification defaults.

### 4.2 Bundle admission and version persistence

For an initial bounded implementation, admit an externally signed bundle supplied as an
approved build asset. Do not invent a new live bundle-delivery endpoint under D1/D3. A later
network update path requires its own allowed destinations, privacy, failure and authenticity
design (P0-01 is still open). Bundle content/signatures are validated by the frozen verifier,
not by trusting a server response or a JS `verified` flag.

- Use actual `RuleBundleVerifier(registry, durableStore, SystemClock)` and
  `engine.acceptRuleBundle(rawJson)`, with rollback protection enabled. Apply owner-side
  ruleset/profile/scope admission before starting; do not reinterpret an M2 slot as M1 authority.
- `ApolloGuardDogBundleVersionStore` implements `highestAccepted` and `recordAccepted`,
  preserving highest version **and authenticated envelope hash**. Use a serialized atomic
  file under Android no-backup storage; persist before admitting an accepted result for use.
  Corrupt/unreadable/failed writes block use, not a reset to an empty in-memory store.
- Separate acceptance and production ledger namespaces. Do not import certification test
  versions as production trust; do not reset production floors on stop, reload or normal update.
  Restore/migration without trustworthy continuity requires explicit recovery, not silent reset.
- Reverify before every authorization/start, including restart and foreground recovery when
  policy calls for renewed observation. Rule refresh must not replace reporter/config under a live TUN.
- No unrestricted JS `trust(key)`, `retire(key)` or verifier replacement endpoint. The initial
  production trust model is **build-pinned rotation**: a reviewed new APK introduces/retires
  keys, with revalidation in its new process. Immediate fleet-wide/offline key revocation is
  **not** supplied by this model and must not be claimed.

### 4.3 Production limitation that cannot be hidden behind the new constructor

Injecting production pins solves **who can sign a newly admitted bundle**; it does not prove
that the frozen data path continuously enforces expiry/revocation of an already admitted rule.

- `RuleBundleVerifier.kt:77–96` checks time/rollback when `verify` runs.
- `GuardDogSDKEngine.kt:109–119` authorizes from its retained accepted bundle without a new
  expiry check; the M1 block-event branch at `203–214` checks destination + ACTIVE, not current
  bundle expiry/key membership. M2 binding TTL is a separate condition, not production key revocation.
- `PacketDropReporter.kt:55–97` drops first and reports evidence afterward. The public reporter
  callback is **not a pre-drop policy hook**. Withholding an event cannot undo an already dropped packet.
- Replacing/retiring a registry key affects future verification; it does not by itself stop
  an established route, purge all admitted authority or retarget a reader that captured an engine.

Consequently, the owner must refuse invalid/expired admission, stop before policy replacement,
and request observed teardown on expiry/revocation—but an asynchronous stop/timer is **not
proof of atomic expiry at every in-flight packet**. Do not redefine `expiresAt` as “admission
only” or claim zero-window revocation merely to make the unchanged SDK appear sufficient.

**Production activation stays DEFERRED** until the reviewer accepts an explicit, tested
validity/shutdown policy or the engine owner provides a separately certified pre-drop validity /
atomic teardown capability appropriate to the required guarantee. There is no such public
per-packet authorization callback in the inspected frozen reader/reporter. No local frozen
source edits are proposed. This is a D3 feasibility limitation, **not a fabricated seventh P0**.

## 5. Exact conditional files for the recommended alternative

This **replaces**, rather than silently supplements, the earlier JS-facade-only ownership
proposal if approved. It is a larger native boundary change; all entries below remain proposed.

| Candidate file | Concrete responsibility |
|---|---|
| `frontend/package.json` | Android autolinking exclusion only; keep dependency versions, lockfile and SVG pin unchanged |
| `frontend/modules/apollo-security/android/build.gradle` | Direct core/VPN project dependencies and native profile/generated-asset wiring, with no vendor-source edits |
| `frontend/plugins/withGuardDogEngine.js` | Preserve library includes/provenance; assert correct bridge-excluded topology when Apollo ownership is selected |
| `frontend/plugins/withApolloGuardDogOwner.js` (new) | Produce native build profile and exactly one approved trust asset; reject missing/mixed profile inputs before native compilation |
| `frontend/app.json` | Register that Apollo-owned plugin only after topology/design approval; no application ID or production default change implied |
| `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt` | Attach/detach from the process owner; route selected operations, guard legacy service start in GuardDog mode, retain non-enforcement features |
| `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/guarddog/ApolloGuardDogRuntime.kt` (new) | Single engine/verifier/registry owner and shared runtime publishing; no arbitrary second engine or ownership replacement |
| `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/guarddog/ApolloPinnedTrustConfig.kt` (new) | Validate native profile, public pins/fingerprints, allowed rulesets and test/prod separation; no signer private keys |
| `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/guarddog/ApolloGuardDogBundleVersionStore.kt` (new) | Durable monotonic version + signed-envelope identity, atomic writes and explicit failure/recovery |
| `frontend/scripts/guarddog-ownership-preflight.cjs` (new) | Check profile-specific autolink/provider/dependency topology; fail attempted dual ownership before build |
| `frontend/tests/guardDogOwnerPackaging.test.cjs` (new) | Test profile/config generation and expected/forbidden registrations without editing frozen packages |
| `frontend/modules/apollo-security/android/src/androidTest/java/com/hucentai/apollosecurity/guarddog/ApolloGuardDogOwnershipTest.kt` (new) | Concurrent/repeated module attach, React reload, object identities, listener counts and prohibited bridge inclusion |
| `frontend/modules/apollo-security/android/src/androidTest/java/com/hucentai/apollosecurity/guarddog/ApolloGuardDogTrustTest.kt` (new) | Test/prod rejection, signed admission, expiry/revocation limitations, persistence/error and restart cases |

Actual public trust/bundle inputs are provisioned separately; no placeholder key or fake
production bundle is proposed for shipping. Test-framework wiring must be reviewed with the
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
| Persistence/rotation (NOT RUN) | Exact-envelope retry accepted; lower version and equal-version conflict rejected; process restart preserves floor; write failure/restore uncertainty blocks use; new-key APK revalidates rather than inheriting assumed trust. |
| Runtime validity (NOT RUN / production blocker) | Exercise expiry, wall-clock change, key retirement policy, in-flight packet/start/stop races and timeout; record actual teardown bounds. Native drop vs evidence suppression must not be confused. No strict pre-drop guarantee is claimed from the public post-drop callback. |

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
3. For the alternative, approve the native profile/public-pin/ledger ownership model and obtain
   actual approved public inputs. Independently settle the runtime validity limitation before
   any production activation; constructor feasibility is not enforcement assurance.

**D1/D3 now have a concrete source-backed design and feasibility verdict, but remain OPEN for
reviewer disposition / unresolved production guarantees. Stage 1D is NOT STARTED.** D2, D4,
D5 and D6 are unchanged and not implicitly resolved. No contract extension or default cutover
is approved. The earlier eight-document sync at `956db060` remains verified; this new focused
design and its handoff updates require a subsequent Save to GitHub / remote verification.