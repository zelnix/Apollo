# Stage 1D acceptance candidate — implementation and provisioning record

**Profile:** `guarddog-stage1d-acceptance` — TEST ONLY. Production remains `legacy` and the
security policy rejects selecting this profile when `EXPO_PUBLIC_APP_ENV=production`.

## Implemented independent work

- `ApolloGuardDogCandidateRuntime` is the single enforcement owner in the candidate. It constructs
  frozen `GuardDogSDKEngine`, installs one reporter wrapper into frozen `GuardDogVpnRuntime`, and
  excludes `guarddog-expo-module` from Android/iOS Expo autolinking.
- The wrapper captures `BlockedThreatEvidence` before invoking the engine, then correlates the
  synchronous genuine engine event by the original evidence ID and destination IP. Protocol number,
  destination/source port, packet observation time, packet length, flow key and evidence ID come
  from the reporter object. Engine event time and default ports are never substituted.
- Native evidence is committed to an Apollo-owned durable candidate inbox. JS persists Patrol and
  delivery state before acknowledging native evidence; seen IDs are retained locally with a 2,048
  cap. Backend P0 truth validation remains independent.
- `/guarddog-acceptance` provides the Pixel workflow: grant VPN consent once, then run one
  consolidated baseline → start/ACTIVE → fresh SYN-drop probe → evidence capture → stop/recovery →
  fresh successful probe. Its record contains installed APK SHA-256, package/version, native stack
  ID and all observations.
- `eas.json` contains an internal APK profile for the acceptance candidate and a separate production
  profile that explicitly selects `legacy`.

## Acceptance trust rotation and fixture result

- Historical `gd-m1-test-ed25519-001` trust is no longer used by the Apollo-owned runtime.
- New acceptance-only key ID: `apollo-stage1d-acceptance-ed25519-001`; its public key is injected
  through the existing `TrustedKeyRegistry(mapOf(...))` constructor in Apollo-owned code. Frozen
  sources remain unchanged.
- The private key was generated with mode `0600` at
  `/root/.apollo-secrets/stage1d-acceptance-ed25519.pem`, outside the repository and APK. No private
  material appears in source, public test vectors, app configuration or the generated Android tree.
- Current public vectors cover valid, tampered, expired and unknown-key envelopes. Python real-clock
  Ed25519 checks pass; equivalent native `RuleBundleVerifier` JUnit tests are packaged for the managed
  Android build. The valid fixture expires `2027-03-19T05:30:31Z` and is scoped only to
  `stage1d-acceptance-fixture.invalid`, never to physical acceptance.
- Production prebuild writes `app.apollo.guarddog.acceptanceEnabled=false`; candidate staging writes
  `true`; attempting a production candidate prebuild fails. The native verifier checks this metadata
  before accepting an acceptance bundle.
- The only historical endpoint values are `m1-block-test.guarddog.example` with `203.0.113.7` or
  `203.0.113.10`. The hostname currently has no IPv4 answer and both addresses are RFC 5737 TEST-NET,
  not owned/routable dedicated infrastructure. They are deliberately rejected and not reused.

## Isolated fixture provisioning

Run `frontend/scripts/provision_guarddog_acceptance.py` only in an isolated signing job. It requires:

1. `GUARDDOG_ACCEPTANCE_PRIVATE_KEY_FILE` pointing to the external mode-0600 key (or PKCS8 bytes from
   a secret manager); it is checked against the Apollo acceptance public key and never copied.
2. A current controlled host/IPv4/HTTPS URL and an ownership-evidence file. The host must resolve to
   exactly that one globally routed IPv4 and return a successful fresh HTTPS baseline.
3. A monotonic `GUARDDOG_BUNDLE_VERSION`.

The script emits only ignored `.acceptance/` public bundle/config/receipt files, uses the real clock,
sets a 24-hour expiry and records ownership-evidence/bundle hashes. The installed engine performs the
final signature, validity and rollback check.

## Concrete remaining physical-run inputs

- A currently owned **dedicated globally routed IPv4 endpoint**, canonical hostname, valid HTTPS
  certificate and ownership evidence. No valid endpoint exists in the saved project assets.
- After endpoint verification, the provisioner writes the public
  `guarddog-acceptance.config.json`; save that generated public configuration with the source.
- Managed build profile: `guarddog-acceptance` in `frontend/eas.json` — internal Android APK,
  staging, native adapter, acceptance engine. Once source/config are saved, the required user action
  is **Publish → Android build → profile `guarddog-acceptance`**. The resulting build ID/APK hash must
  be copied into the Pixel record before running `/guarddog-acceptance` once.

Native compilation and Pixel 10 acceptance remain **NOT RUN** until that managed build exists.

## Iteration 67 independent verification

- Acceptance crypto vectors **2/2**, source ownership/trust guards **4/4**, backend P0/Stage1D
  regressions **50/50**.
- Main frozen-source verification from `frontend/packages` remains **91/91 OK**. The independent
  agent's manifest-path warning came from running the manifest at repository root, not a hash change.
- Native Gradle/JUnit compilation, APK build identifiers and Pixel evidence remain **NOT RUN**.

T1–T5 production trust certification remains outstanding and no candidate code is a production
trust implementation or cutover approval.