# Modified-field rejection manifest

Frozen verification clock for every consumer: `2026-06-15T00:00:00Z`.
Trusted registry for the baseline run: `signing/trusted_keys.json → trustedKeys` (key `gd-m1-test-ed25519-001` only).
Rollback store state for the rollback case: highest accepted `bundleVersion = 3` for `gd-m1-controlled-block`.

Verification order (all platforms): schema → payloadHash → keyId known → Ed25519 signature → issuedAt/expiresAt → rollback.

| Fixture | Modification | Expected outcome |
|---|---|---|
| `jcs/valid_signature_bundle.json` | none | ACCEPTED (bundleVersion 3) |
| `jcs/invalid_signature_bundle.json` | first signature byte flipped | `SIGNATURE_INVALID` |
| `jcs/modified_payload_bundle.json` | rule[0].action block→allow, payloadHash recomputed, stale signature | `SIGNATURE_INVALID` |
| `jcs/modified_expiry_bundle.json` | expiresAt → 2030-06-01 | `SIGNATURE_INVALID` |
| `jcs/modified_bundle_version_bundle.json` | bundleVersion 3→4 | `SIGNATURE_INVALID` |
| `jcs/modified_ruleset_id_bundle.json` | rulesetId changed | `SIGNATURE_INVALID` |
| `jcs/modified_key_id_bundle.json` | keyId → `gd-m1-test-ed25519-002` | `UNKNOWN_KEY` (baseline registry); `SIGNATURE_INVALID` once key 002 is trusted |
| `jcs/invalid_payload_hash_bundle.json` | payloadHash zeroed, envelope validly re-signed | `PAYLOAD_HASH_MISMATCH` |
| `signing/valid_bundle.json` | none | ACCEPTED |
| `signing/tampered_payload_bundle.json` | rule[0].host swapped; hash and signature untouched | `PAYLOAD_HASH_MISMATCH` |
| `signing/expired_bundle.json` | expiresAt 2026-06-10, validly signed | `EXPIRED` |
| `signing/unknown_key_bundle.json` | signed by key 002 | `UNKNOWN_KEY`; ACCEPTED after key 002 introduced |
| `signing/rollback_bundle.json` | bundleVersion 1, validly signed | `ROLLBACK` when store holds 3 |

`jcs/canonical_bytes.hex` is the RFC 8785 serialization of `jcs/unsigned_envelope.json` produced by the Python `rfc8785`
package. Kotlin (erdtman `java-json-canonicalization`), Swift and TypeScript canonicalizers must reproduce these bytes exactly,
and `SHA-256(canonical payload)` must equal `payloadHash` in `valid_bundle.json`.
