# Apollo GuardDog production trust authority

## Status

The production implementation is source-complete but **not the default engine**. `app-bundle` remains `legacy`. The explicit `guarddog-production` profile fails closed until owner-controlled public roots, signed artifacts and HTTPS update locations are supplied. No private signing key belongs in this repository, application binary, EAS environment or CI.

## Authority model

- The APK pins two distinct Ed25519 public roots: **primary** and **recovery**.
- Roots sign strict trust manifests only. They never sign ordinary rule bundles directly.
- A trust manifest is bound to one `domain` and `profile`, carries monotonic `generation` and `manifestVersion`, and introduces only ordinary rule-signing keys with validity/revocation state.
- Root IDs and the frozen `m1-acceptance` key/ID cannot appear as ordinary keys.
- A recovery manifest may permanently disable the pinned primary root. Disabled primary authority cannot return through a higher generation/version.
- Ordinary keys sign strict frozen-SDK rule bundles. A bundle cannot outlive its ordinary key or trust manifest.
- Trust state and the retained signed bundle are HMAC-bound to an Android Keystore key; Android backup is disabled. Integrity loss fails closed rather than resetting rollback history.

## Runtime transition

1. Fetch candidate manifest and rule bundle over HTTPS without redirects.
2. Verify strict schema, duplicate-member rejection, domain/profile, root signature, validity, revocation and rollback before changing enforcement.
3. If trust or rules change, stop and observe route/TUN recovery; drain evidence reporting; clear runtime bindings/listeners/authorization; rebuild one engine/verifier/registry/version store for the new trust generation.
4. Accept and persist the signed rule bundle, re-authorize the controlled endpoint, then resume only if protection was already intended on.
5. A WorkManager refresh checks for updates every six hours. A separate exact-expiry worker stops enforcement when the manifest, ordinary key or rule bundle expires.

The frozen GuardDog Expo bridge remains excluded. Apollo's `apollo-security` module owns the sole process runtime and native bridge.

## Offline signing

Private keys must be stored outside `/app` and outside source control.

```bash
node scripts/guarddog-production/sign-trust-manifest.mjs unsigned-manifest.json /offline/root-private.pem signed-manifest.json
node scripts/guarddog-production/sign-rule-bundle.mjs unsigned-rules.json /offline/ordinary-private.pem signed-rules.json
```

The application/update service receives only signed JSON and public keys. The scripts refuse repository-contained private key files.

## Required production inputs

- `APOLLO_GUARDDOG_TRUST_DOMAIN`
- `APOLLO_GUARDDOG_TRUST_PROFILE`
- `APOLLO_GUARDDOG_PRIMARY_ROOT_ID`
- `APOLLO_GUARDDOG_PRIMARY_ROOT_PUBLIC_KEY_B64`
- `APOLLO_GUARDDOG_RECOVERY_ROOT_ID`
- `APOLLO_GUARDDOG_RECOVERY_ROOT_PUBLIC_KEY_B64`
- `EXPO_PUBLIC_GUARDDOG_TRUST_MANIFEST_URL`
- `EXPO_PUBLIC_GUARDDOG_RULE_BUNDLE_URL`
- `EXPO_PUBLIC_GUARDDOG_CONTROLLED_HOST`
- `EXPO_PUBLIC_GUARDDOG_CONTROLLED_IPV4`
- `EXPO_PUBLIC_GUARDDOG_CONTROLLED_URL`
- `EXPO_PUBLIC_GUARDDOG_RULESET_ID`

## Failure and recovery matrix

| Event | Required behavior |
|---|---|
| Malformed/duplicate/unknown manifest field | Reject before mutation; retain current valid authority. |
| Wrong domain/profile/root or bad signature | Reject before mutation. |
| Manifest/key/bundle expired | Refuse start; expiry worker stops existing enforcement. |
| Ordinary key revoked | Rebuild without that key; old accepted bundle cannot be restored. |
| Lower generation/version | Reject rollback. |
| Same version, different envelope | Reject version conflict. |
| Recovery disables primary | Persist disablement and recovery floor; all later primary manifests reject regardless of version jump. |
| New manifest valid, replacement bundle invalid | Stop and remain stopped under the new fail-closed authority. |
| Rule update invalid under unchanged trust | Keep the currently accepted valid rule and enforcement unchanged. |
| Keystore/HMAC state unavailable | Fail closed; do not reset trust history. |
| Update network unavailable | Continue only while the already persisted manifest/key/bundle remain valid. |
| App changes back to legacy | Expiry/migration worker stops any remaining GuardDog route before legacy starts. |

## Cutover boundary

Source completion is not production-default approval. Selection requires the explicit `guarddog-production` profile, owner-provided public roots and signed update artifacts, native build verification, real-device enforcement/evidence/rollback observations, and an updated signed build record. `app-bundle` remains reversible legacy until that evidence exists.