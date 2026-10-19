# Apollo capacity, coverage and retention (as built, 2026-09-21)

All bounds are application defaults published by `GET /api/ai/capabilities` (`bounds`, `policyVersion`); none is a claim about Gemini's maximum capability or measured deployment capacity.

| Control | Value | Source | Overflow |
|---|---|---|---|
| Text transport | 262,144 characters per item | `capacity.TEXT` | 413/422 explicit; never sliced |
| Items per request | 256 | `capacity.ITEMS` | explicit rejection; inventory paginated (100/page) |
| File upload | 32 MiB per file | `evidence.MAX_FILE_BYTES` | 413; item recorded as not received |
| Aggregate case payload | 64 MiB | `evidence.MAX_CASE_BYTES` | 413 |
| Document pages | 200 | `evidence.MAX_PAGES` | later pages omitted and recorded |
| Expanded extraction | 64 MiB | `evidence.MAX_EXPANDED` | coverage `unavailable`, `materialGap=true` |
| Image decode | 40 megapixels | `evidence.MAX_IMAGE_PIXELS` | coverage `unavailable` |
| Inline model text | 24,000 chars per item; 2,000-char preview above that | `evidence.INLINE_TEXT_CHARS` | remainder via `read_evidence` (30,000 chars per read) |
| Tool rounds per turn | 10 | `coordinator.MAX_TOOL_ROUNDS` | final answer requested; `partial` if material evidence remains |
| Grounded research calls per turn | 6 | `tools.ToolContext.research_calls` | `budget_exhausted` tool result |
| Work slice | 120 s (capped by case expiry) | `capacity.WORK_SECONDS` | `partial` + Retry/Resume |
| Provider call | 50 s | `capacity.CALL_SECONDS` | retryable `provider_unavailable` |
| Transient retries | 2 per turn, jittered exponential backoff | `jobs.MAX_TRANSIENT_RETRIES` | typed failure |
| Output tokens | 8,192 (min with model limit) | `capacity.OUTPUT` | non-STOP = incomplete, repair/partial |
| Temporary lifetime | 15 minutes from case creation | `capacity.LIFETIME_SECONDS` | 410; never extended by retry/turn/speech |
| Speech segment | 1,200 characters at sentence boundaries | `capacity.SPEECH_SEGMENT_CHARACTERS` | all segments queued in order |

## Coverage ledger

Every `EvidenceItem.coverage` records `status`, `unit`, `total`, `examined`, `examinedRanges` (union, no double counting), `omittedRanges` with reasons and `materialGap`. Parser extraction creates a derived child item (`transformations: decode` with page offsets); model reads via `read_evidence`/inline update the child's character ranges and project page coverage onto the parent. Parsing is never counted as examination. `InvestigationCase.inventory` summarises examined/partial/unavailable/purged counts; `HigginsResponse.remainingEvidenceIds` names what was not examined.

## Encryption and secret handling

All content-bearing fields (`meta_ciphertext`, chunk `ciphertext`, `payload_ciphertext`, `checkpoint_ciphertext`, `commit_ciphertext`, `payload_ciphertext` on events, `response_ciphertext`, `sources_ciphertext`, `audio_ciphertext`, `plan_ciphertext`, `report_ciphertext`) use Fernet under the dedicated key at `INVESTIGATION_KEY_FILE` (0600, never derived from or interchangeable with `GEMINI_API_KEY`). Mount it from an owner-controlled secret in deployment; do not regenerate per start. Indexed fields contain only IDs, digests, statuses, timestamps and non-secret labels.

Secrets in text (`password=…`, codes, tokens, bearer values, credential-like URL parameters) are replaced with `[redacted]` before storage; each redaction is recorded as a `secret_redaction` transformation without the value. `inspect_url` refuses to follow links carrying credential-like parameters. Image-region secret preflight is **not** implemented.

## Deletion lifecycle

`DELETE /investigations/{id}`, `DELETE /ask/history`, cancellation and expiry call `repository.revoke` (rotates `epoch`, strips response/sources/profile, marks cleanup pending) then `run_cleanup` (deletes evidence, chunks, events, turn commits, jobs, device requests, settings plans, `voice_cache` rows for the case, uploads). Failures leave a retry task in `investigation_cleanup`; `cleanup_status` is reported truthfully. Expiry is enforced on every read (`get_case`, `get_evidence`, `read_bytes`) independent of Mongo TTL, which is a backstop (`expireAfterSeconds` 0–3600 after `expires_at`). Content-free tombstones (`deleted=True`) remain so IDs cannot be reused.

Provider side: no Gemini Files objects are created (inline parts only), so no provider-file deletion obligation exists today. Google account data retention is **not** verified by this code; do not claim zero provider retention.
