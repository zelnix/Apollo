# Apollo Information Security, Retention & Data Lifecycle

**Document**: SECURITY_LIFECYCLE.md
**Version**: 1.0
**Status**: Package 6 Delivery
**Effective**: February 2026
**Standards**: ISO/IEC 27001:2022, ISO/IEC 27701:2025
**Owner**: Apollo Engineering

---

## 1. Encryption Controls

### 1.1 In Transit

| Layer | Mechanism | Status |
|---|---|---|
| Client ↔ Backend | TLS 1.2+ via Kubernetes ingress termination | ✅ Implemented |
| Backend ↔ Gemini | HTTPS (Google SDK enforces TLS) | ✅ Implemented |
| Backend ↔ MongoDB | TLS when configured in MONGO_URL | ✅ Configuration-dependent |
| Backend ↔ Third-party (Intel, HIBP) | HTTPS | ✅ Implemented |

### 1.2 At Rest

| Data | Mechanism | Key Management | Status |
|---|---|---|---|
| Investigation context | Fernet symmetric encryption | Dedicated key file; `0o077` permission check; separate from API keys | ✅ `encryption.py` |
| Investigation turn integrity | HMAC-SHA256 with domain-separated key | Derived from investigation key via `apollo-investigation-turn-integrity-v1` | ✅ `encryption.py` |
| Bearer tokens | SHA-256 hash stored (raw never persisted) | Hash computation at authentication time | ✅ `auth.py` |
| MongoDB collections | MongoDB at-rest encryption (infrastructure) | Infrastructure-managed | ✅ Configuration-dependent |

---

## 2. Access Control

### 2.1 Device Authentication

| Control | Implementation | File |
|---|---|---|
| Server-issued device identity | Random `device_id` + 256-bit bearer token at registration | `auth.py` |
| Token storage | Only SHA-256 hash persisted; raw token never stored | `auth.py:hash_token()` |
| Token validation | Every non-public request validates bearer token against stored hash | `auth.py:owner_of()` |
| Owner scoping | All DB queries filtered by authenticated `device_id`/`owner_id` | Every router |
| Public paths | Minimal: `/api/health`, `/api/intel/status`, `/api/devices/register`, `/api/gmail/oauth/callback` | `auth.py:PUBLIC_PATHS` |
| Token expiry | Configurable TTL (default from `TOKEN_TTL_DAYS`) | `auth.py` |

### 2.2 Admin Access

| Control | Implementation |
|---|---|
| Separate admin key | `ADMIN_KEY` header, distinct from device auth |
| Least privilege | Admin endpoints limited to operational functions |
| Single-factor | ⚠️ Gap G-09: MFA not implemented for admin access |

### 2.3 Cross-User Isolation

| Control | Implementation |
|---|---|
| Query scoping | All MongoDB queries include `owner_id` or `device_id` filter |
| Device-to-caller binding | Backend verifies path/query `device_id` matches authenticated device |
| Family sharing | Paired guardian access via explicit opt-in; minimal data shared |
| Investigation scoping | Cases, evidence, and conversation history scoped to owner |

---

## 3. Retention & Deletion

### 3.1 Retention Periods

| Data Type | Retention | Mechanism | File |
|---|---|---|---|
| Investigation scoped content | 15 minutes (fixed, non-extendable) | `retention.py:open_scope()` — `LIFETIME_SECONDS` | `retention.py` |
| Temporary evidence | TTL index + sweep loop | MongoDB TTL index on `expires_at` + periodic `sweep()` | `retention.py` |
| Investigation contexts | Scope-bound (15 min) then deleted | `delete_scope()` removes all content + context | `retention.py` |
| Voice cache | Same as investigation scope | TTL-indexed in `voice_cache` collection | `retention.py` |
| Device records | Persistent until device deletion | `delete_owner_content()` for full removal | `retention.py` |
| Patrol events | Persistent within investigation lifecycle | Owner-controlled via patrol clear | `patrol_records.py` |

### 3.2 Deletion Controls

| Control | Implementation | Verification |
|---|---|---|
| Scope-based deletion | `delete_scope()` removes all content collections for a scope | Content collections iterated and deleted |
| Owner-wide deletion | `delete_owner_content()` invalidates generation then deletes | Generation invalidation prevents late workers from publishing |
| Generation fencing | Each owner has a `generation` UUID; stale workers rejected | `require_scope()` checks generation match |
| Sweep loop | Background task runs every 30 seconds | Expired + deleted scopes cleaned up |
| TTL indexes | MongoDB native TTL on `expires_at` with `retention_class` filter | Only `TEMPORARY_RETENTION` records selected |
| Clear Patrol | Soft-delete of patrol events | ⚠️ Gap G-06: Physical erasure mechanism needed |

### 3.3 Deletion Verification

| Test | Mechanism |
|---|---|
| Scope expiry | `require_scope()` raises 410 for expired scopes |
| Generation invalidation | New generation hex prevents stale scope access |
| Content collection cleanup | `delete_scope()` deletes from all `CONTENT_COLLECTIONS` |
| Owner deletion | `delete_owner_content()` invalidates + deletes across all collections |

---

## 4. Key & Secret Management

| Secret | Storage | Rotation | File |
|---|---|---|---|
| Investigation encryption key | File on disk; `0o077` permissions enforced | Manual rotation; key file replacement | `encryption.py` |
| Bearer tokens | SHA-256 hash in MongoDB | Per-device, on registration/refresh | `auth.py` |
| Admin key | Environment variable | Manual rotation via deployment | `core/config.py` |
| Gemini API key | Environment variable | Manual rotation via deployment | `provider.py` |
| Gmail OAuth tokens | Encrypted in MongoDB per device | Google-managed refresh | `routers/gmail.py` |
| Third-party API keys | Environment variables | Manual rotation via deployment | `.env` |

---

## 5. Privacy-Safe Audit & Monitoring

### 5.1 What IS Logged

| Event | Content | Privacy |
|---|---|---|
| Gateway binary transmission | `purpose`, `model`, `capability` (no content) | ✅ No personal data |
| Provider failures | Error code only (no prompt/response text) | ✅ No personal data |
| Sweep operations | Count of deleted records | ✅ No personal data |
| Authentication failures | Device ID hash + error type | ✅ No personal data |
| Content cleanup | Collection name + deleted count | ✅ No personal data |

### 5.2 What is NOT Logged

| Data | Reason |
|---|---|
| Gemini prompts/responses | Privacy — contains investigation evidence |
| User messages | Privacy — personal content |
| Bearer tokens (raw) | Security — only hashes stored |
| Investigation content | Privacy — encrypted at rest |
| Evidence byte content | Privacy — stored encrypted, not logged |

---

## 6. Incident & Breach Response

### 6.1 Procedure (To Be Formalised)

| Step | Action | Status |
|---|---|---|
| **Detection** | Privacy boundary middleware; provider error containment; monitoring | ⚠️ Automated alerting not configured |
| **Containment** | Generation invalidation; scope deletion; owner content purge | ✅ Implemented |
| **Assessment** | Determine affected data categories, subjects, scope | ⚠️ Manual process |
| **Notification** | Australian Privacy Act breach notification obligations | ⚠️ Procedure not formalised |
| **Remediation** | Key rotation; token revocation; code fix deployment | ✅ Mechanisms available |
| **Review** | Post-incident review; compliance matrix update | ⚠️ Process not formalised |

### 6.2 Available Response Actions

| Action | Command | Scope |
|---|---|---|
| Invalidate all owner content | `delete_owner_content(owner)` | Single owner |
| Invalidate specific scope | `delete_scope(owner, scope_id)` | Single investigation |
| Revoke admin key | Rotate `ADMIN_KEY` env var | All admin access |
| Rotate investigation key | Replace key file, restart backend | All investigation encryption |
| Force token refresh | Update `token_expires_at` to past | Single device |

---

## 7. Compliance Matrix Updates

| Gap ID | Resolution | Status |
|---|---|---|
| G-06 | Clear Patrol is soft-delete; physical erasure mechanism documented as gap | ⚠️ Remains open |
| G-08 | Incident procedures documented with available response actions | ⚠️ Partially addressed — formalisation needed |
| G-09 | Admin access uses single-factor API key; documented as residual risk | ⚠️ Remains open |

---

## 8. Test Evidence

| Test | Covers |
|---|---|
| `test_higgins_authority.py` | Completion/verification validation, evidence integrity |
| `test_image_consent_enforcement.py` | Consent recording, trust boundary documentation |
| `test_gateway_enforcement.py` | Single gateway enforcement, purpose mandatory |
| `test_llm_boundary.py` | Credential stripping, PII minimisation |
| Existing retention tests | Scope lifecycle, generation fencing, sweep |
| Existing auth tests | Token validation, owner scoping |

---

## Package Delivery Record

| Item | Value |
|---|---|
| **Implemented** | SECURITY_LIFECYCLE.md documentation; compliance matrix updated |
| **Verification performed** | Code inspection of encryption.py, auth.py, retention.py, privacy_boundary.py |
| **Remaining limitations** | G-06 (soft delete), G-08 (incident formalisation), G-09 (admin MFA) |
| **Acceptance requested** | Yes |
