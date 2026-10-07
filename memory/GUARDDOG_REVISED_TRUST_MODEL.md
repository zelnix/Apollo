# GuardDog Revised Trust Model — HTTPS-Authenticated Rules

## Summary

This document replaces the Ed25519-signed rule bundle architecture with
HTTPS-authenticated rule delivery. Apollo no longer manages its own
cryptographic signing keys for rule bundles.

## What is being removed

| Component | Location | Purpose |
|---|---|---|
| `sign-rule-bundle.mjs` | `scripts/guarddog-production/` | Offline Ed25519 signing tool |
| `sign-trust-manifest.mjs` | `scripts/guarddog-production/` | Offline trust manifest signing tool |
| `rule-bundle-v2-unsigned.json` | `scripts/guarddog-production/` | Unsigned bundle template |
| `trust-manifest.json` | `backend/guarddog_artifacts/` | Signed trust manifest (Ed25519 public keys) |
| `rule-bundle.json` | `backend/guarddog_artifacts/` | Signed rule bundle artifact |
| `withGuardDogProductionTrust.js` | `plugins/` | Config plugin injecting Ed25519 root keys into AndroidManifest |
| `ApolloGuardDogProductionTrust.kt` | `apollo-security` module | Trust manifest parsing, Ed25519 key registry, generation tracking |
| `RuleBundleVerifier.kt` | `guarddog-core` SDK | Ed25519 signature verification, payloadHash, JCS canonicalization |
| `TrustedKeyRegistry.kt` | `guarddog-core` SDK | Ed25519 public key store |
| `SignedRuleBundle` data class | `guarddog-core` SDK | Bundle model with `keyId`, `payloadHash`, `signature` fields |
| `BundleVersionStore` | `guarddog-core` SDK | Rollback protection via signed envelope hash |
| Backend `/api/guarddog/trust-manifest` | `routers/guarddog.py` | Serves static signed trust manifest |
| Backend `/api/guarddog/rule-bundle` | `routers/guarddog.py` | Serves static signed rule bundle |
| EAS env vars | `eas.json` | `APOLLO_GUARDDOG_PRIMARY_ROOT_*`, `APOLLO_GUARDDOG_RECOVERY_ROOT_*`, `TRUST_DOMAIN`, `TRUST_PROFILE`, `MANIFEST_URL`, `RULESET_ID` |
| JS config | `GuardDogProductionConfig.ts` | `manifestUrl`, `ruleBundleUrl`, `rulesetId` fields |
| JS adapter references | `GuardDogProductionSecurityAdapter.ts` | `refreshGuardDogProductionAuthority`, `installGuardDogProductionTrustManifest`, `acceptGuardDogProductionRuleBundle` |

## Revised trust model

### Authentication
- Rules are delivered over **HTTPS** from Apollo's backend API.
- TLS certificates are managed by the hosting/cloud provider (Cloudflare + origin cert).
- No Apollo-managed private signing keys exist.
- The app trusts the backend because:
  1. HTTPS ensures transport integrity and server authentication.
  2. The backend URL is baked into the signed APK/IPA at build time.
  3. The API requires authentication (existing Apollo auth).

### Rule delivery API
- **Endpoint**: `GET /api/guarddog/rules`
- **Authentication**: Bearer token (existing Apollo auth) or API key
- **Response schema**:
```json
{
  "schemaVersion": "2.0",
  "rulesetId": "apollo-rules-v1",
  "bundleVersion": 2,
  "issuedAt": "2026-10-06T15:00:00Z",
  "expiresAt": "2027-10-06T15:00:00Z",
  "payload": {
    "rules": [
      {
        "ruleId": "prod-controlled-verify-v1",
        "host": "apolloverify.harmonywellnessgroup.com.au",
        "action": "block",
        "matchType": "exact",
        "category": "controlled-verification"
      }
    ]
  }
}
```
- **Removed fields**: `keyId`, `payloadHash`, `signature` (no longer needed)
- **Retained fields**: `schemaVersion`, `rulesetId`, `bundleVersion`, `issuedAt`, `expiresAt`, `payload`

### Validation (on-device, without signing)
1. **HTTPS only** — reject non-TLS responses.
2. **Schema validation** — strict JSON parsing, no unknown keys, typed fields.
3. **Versioning** — `bundleVersion` must be ≥ the last accepted version (rollback protection).
4. **Expiry** — `issuedAt` must be in the past, `expiresAt` must be in the future.
5. **Rule validation** — non-empty rules, valid `action` (`block`/`allow`), `matchType` (`exact`), non-empty `host`.
6. **Size limit** — reject payloads > 2MB.
7. **Version conflict** — same `bundleVersion` must have identical content (SHA-256 of canonical payload).

### Offline resilience
- The last successfully validated rule bundle is persisted on-device.
- If the backend is unreachable, the app continues with the last valid local rules.
- Expiry is enforced: if the local bundle's `expiresAt` has passed and no refresh succeeds, protection degrades gracefully (no stale rules enforced).

### Blocktest / controlled verification
- `apolloverify.harmonywellnessgroup.com.au` → `52.25.179.131` remains the controlled verification endpoint.
- It proves real packet observation → drop → evidence → THREAT_BLOCKED.
- A blocktest outage only means the controlled test cannot be performed. It does NOT disable GuardDog protection.
- The controlled host must have a matching exact-block rule in the active ruleset.

### THREAT_BLOCKED evidence requirements (unchanged)
- Evidence is only created when a real packet is observed and dropped by the enforcement layer.
- No simulated or assumed evidence.
- The evidence contract and `THREAT_BLOCKED` event path are not weakened.

## Migration path

1. Replace `RuleBundleVerifier` with `RuleBundleValidator` (schema + version + expiry checks only, no Ed25519).
2. Replace `SignedRuleBundle` with `RuleBundle` (remove `keyId`, `payloadHash`, `signature`).
3. Remove `TrustedKeyRegistry`, `ApolloGuardDogProductionTrust`, trust manifest flow.
4. Remove `withGuardDogProductionTrust` config plugin and related EAS env vars.
5. Replace backend static file serving with authenticated API endpoint.
6. Update `GuardDogProductionSecurityAdapter` to fetch rules directly via HTTPS (no trust manifest intermediate).
7. Update production runtime `refreshAuthority()` → `refreshRules()`.
8. Baseline controlled-verify rule ships embedded in the app.
9. Remove signing scripts and unsigned bundle templates.
