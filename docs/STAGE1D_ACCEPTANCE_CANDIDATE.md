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

## Acceptance fixture recovery result (current repository and git object history)

- Pinned public fixture: `gd-m1-test-ed25519-001` /
  `ccf41NL6VHYQsH171Lw98hKiIoQFvAY0t171X4PL/ac=` is present in frozen
  `TrustedKeyRegistry.kt`.
- The `security/test-vectors/signing/valid_bundle.json` content referenced by frozen tests is absent
  from the working tree **and from all reachable git objects**. Therefore there is no bundle whose
  signature/expiry can be rechecked against the real clock.
- No private Ed25519 fixture matching that public key is present in repository files or reachable
  git object names. This is correct for source control, but means a new short-lived signed bundle
  cannot be produced in this workspace without access to that external test signer.
- The only historical endpoint values are `m1-block-test.guarddog.example` with `203.0.113.7` or
  `203.0.113.10`. The hostname currently has no IPv4 answer and both addresses are RFC 5737 TEST-NET,
  not owned/routable dedicated infrastructure. They are deliberately rejected and not reused.

## Isolated fixture provisioning

Run `frontend/scripts/provision_guarddog_acceptance.py` only in an isolated signing job. It requires:

1. `GUARDDOG_ACCEPTANCE_PRIVATE_KEY_PKCS8_B64` supplied from a secret manager; it is held in memory,
   checked against the pinned public key and never written.
2. A current controlled host/IPv4/HTTPS URL and an ownership-evidence file. The host must resolve to
   exactly that one globally routed IPv4 and return a successful fresh HTTPS baseline.
3. A monotonic `GUARDDOG_BUNDLE_VERSION`.

The script emits only ignored `.acceptance/` public bundle/config/receipt files, uses the real clock,
sets a 24-hour expiry and records ownership-evidence/bundle hashes. The installed engine performs the
final signature, validity and rollback check.

## Concrete remaining physical-run inputs

- Access to the external **private test signing fixture matching the pinned public key**.
- A currently owned **dedicated globally routed IPv4 endpoint**, canonical hostname, valid HTTPS
  certificate and ownership evidence. No valid endpoint exists in the saved project assets.
- A managed Android build invocation. Workspace `eas` commands are policy-blocked and local Gradle
  cannot run because Java/Android build tools are absent. Candidate source/prebuild is ready; build ID,
  APK hash and Pixel 10 run ID can only exist after the managed build is triggered.

T1–T5 production trust certification remains outstanding and no candidate code is a production
trust implementation or cutover approval.