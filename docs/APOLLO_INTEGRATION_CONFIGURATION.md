# Apollo integration configuration (names only — never values)

| Variable | Purpose | Status if absent |
|---|---|---|
| `GEMINI_API_KEY` | Owner's Gemini key — every AI modality (investigation, research grounding, vision, transcription, speech) | All AI modalities `unconfigured`; no fallback provider |
| `GEMINI_TEXT_MODEL` (default `gemini-3-flash-preview`) | Investigation/research/vision/transcription model; must be in `provider.CAPABILITIES` with `functions`+`search` | Startup capability check fails closed |
| `GEMINI_SPEECH_MODEL` (default `gemini-3.1-flash-tts-preview`), `GEMINI_SPEECH_VOICE` | Narration | Speech `unsupported`; text remains usable |
| `GEMINI_RECOVERY_MODEL` | Optional capability-compatible Gemini recovery model | No model switch; retries then honest partial |
| `INVESTIGATION_KEY_FILE` | Path to the 0600 Fernet key for all temporary investigation content | 503 on any content-bearing operation |
| `MONGO_URL`, `DB_NAME` | Existing database (new collections: `investigation_*`) | — |
| `SAFE_BROWSING_API_KEY` | `lookup_reputation` url/domain | integration `unconfigured`; blocklist still checked |
| `IPQS_API_KEY` | `lookup_reputation` phone | `unconfigured`; number validity still parsed |
| `HIBP_API_KEY` | `lookup_breach` | tool returns `unconfigured` |
| `GOOGLE_CLIENT_ID/SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `PUBLIC_API_BASE` | Read-only Gmail OAuth | Gmail routes `not_configured` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Guardian email delivery | **Blocked** — adapter still a 503 stub |
| Push delivery credentials (owner Expo/FCM project) | Push | **Blocked** — 503 stub |
| Object storage endpoint/bucket/credentials | Family voice notes | **Blocked** — 503 stub |

`GET /api/ai/capabilities` reports each modality/integration as `available | unconfigured | unsupported` without values. `scripts/check-gemini-configuration.py` (prior session) verifies no Emergent-managed key or alternate provider is referenced.

## Implementation vs configuration

- Implemented and live with owner configuration: Gemini text/vision/transcription/speech, Search grounding, blocklist, Safe Browsing (if keyed), IPQS (if keyed), HIBP (if keyed).
- Implemented, credential-dependent: none pending beyond the keyed lookups above.
- **Not implemented** (spec §10 says these are implementation work, not configuration-only): `EmailDelivery`, `PushDelivery`, `FamilyVoiceStorage` adapters with receipts/idempotency. The stubs return 503 and `/api/ai/capabilities` lists them `unconfigured`. Historic managed-store family audio has not been claimed erased.
