# Apollo Phase 2 remediation and Learn with Higgins implementation record

Authority: `memory/APOLLO_PHASE2_LEARNING_AUTHORITIES.md`.

## C22 — pre-provider device-result contract

- The privacy serializer accepts canonical `unavailableReason` while retaining fail-closed unknown-field rejection.
- Rejections expose stable code `EGRESS_SCHEMA_REJECTED` and generic user copy; field names remain non-enumerable internals.
- Device-result submission uses the original request ID as the idempotency key. Retry retains and resends the exact same observation rather than re-running the device capability.

## C23 — ordinary Higgins chat

- Added explicit `turnId`, `conversationId`, bounded prior turn IDs, optional selected Patrol/report references, evidence basis, uncertainty, context provenance, suggested destinations and retention metadata.
- Registered read-only context functions include capabilities, Gate states, protection, recent cases/reports/Patrol, learning preferences and recognised-government alerts.
- Ordinary chat cannot invoke the investigation coordinator. Investigation is an explicit app destination only.
- Server content expires after five minutes; a non-content receipt may remain for 30 days. Device content is encrypted with platform secure storage and limited to one hour.

## C21 — capability and Gate truth

- Added an authoritative capability registry with ten immutable Gate declarations, server integration configuration truth, and owner-scoped device snapshots that expire after 30 minutes.
- The device publishes bounded Gate/capability/protection observations. Missing or stale observations remain unavailable.
- Higgins reads the same registry through `get_product_capabilities` and `get_gate_states`.

## C24 — Patrol outcome truth

- Added immutable `patrol_records` with deterministic record IDs, stable logical issue keys, revisions, supersession, source type, raw/effective state, evidence/assessment references, freshness, outage, resolution and duplicate fields.
- Display state and deduplication are server-owned. Biting/blocked remains possible only with server-validated fresh enforcement evidence.
- Consumer history reads current server records and opens a server revision timeline. Local-only records remain provisional until sync.

## C25 and Learn with Higgins

- Replaced startup seed code with a governed MongoDB catalogue, version store, source registry, feed registry, candidate queue, run logs, preferences and feedback.
- Added 43 reviewed Australian starter articles through the explicit backend import path. Published types include guides, checklists, explainers, recovery guides and alert-context articles.
- Added category/audience/risk/type/tag/language/search filters, cursor pagination, structured article sections, citations, review freshness, clickable official sources and Higgins handoff.
- Added source and feed CRUD/upsert, JSON and CSV import, preview, version history, review/approve/publish/archive/rollback, review queues, candidate reject/promote, feed refresh/pause/resume, health and audit APIs.
- Admin key records may carry distinct `learning_content_view`, `learning_content_edit`, `learning_content_review`, `learning_content_publish`, `learning_source_manage` and `learning_feed_manage` permissions. The existing master key remains backward-compatible and full-scope.
- Feed ingestion uses pinned public transport controls, redirect-host revalidation, content-type and one-megabyte bounds, recognised-government source allowlists, normalized fingerprints and review-only candidates.
- Because public RSS endpoints are retired or absent, the canonical registry explicitly approves two source-owned government listing pages: Scamwatch news/alerts and ACSC alerts/advisories. The HTML parser is enabled only for `approved_listing_page` records with strict host and path-prefix allowlists.
- Latest development refresh: Scamwatch was fresh and produced review candidates; ACSC truthfully recorded `unavailable` after a read timeout. No candidate was auto-published.

## Validation boundary

- Passed: TypeScript, ESLint, 385/385 Node unit/source checks, Python lint/compile, 77/77 bounded provider-disabled pytest checks, and local no-provider consumer/admin/capability/Patrol API assertions.
- Development feed observation: Scamwatch fresh with 55 review candidates; ACSC unavailable after a read timeout; zero feed candidates auto-published.
- Not run or claimed: live Gemini, Playwright, testing agent, automated device scenarios, production feed acceptance, signed artifacts, or physical-device acceptance.