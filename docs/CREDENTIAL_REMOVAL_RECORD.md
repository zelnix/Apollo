# User credential removal record

## Policy

Apollo never asks for or stores login usernames, passwords, app-specific passwords, PINs, recovery codes, verification codes, OTPs or one-time security codes for another service. Provider-hosted OAuth may return limited, revocable tokens; those tokens are application authorisation, not the user's password.

An email address submitted specifically to Account Gate for a breach check is an assessment target. It is processed for that check and not persisted by Apollo.

## Removed

- Generic IMAP mailbox connection UI, including host, username and app-password fields.
- `/api/imap/*` connection, scan, monitoring and disconnect routes.
- IMAP TLS/login and encrypted credential-storage service.
- IMAP mailbox monitor path and frontend egress permissions.
- All current `imap_connections` rows and IMAP-specific receipts, queued events and Patrol records.
- Existing Ask Higgins history was purged so any previously pasted secrets cannot remain in chat storage.

## Current mailbox path

- Manual Email Gate assessment through pasted content, chosen screenshots and shared content.
- Gmail read-only OAuth. Authentication occurs on Google's hosted page; Apollo never receives the Gmail password.

## Secret handling

- Manual Text, Email, Account and Ask Higgins text is redacted before external analysis.
- Backend request boundaries apply the same redaction even if a client bypasses the mobile check.
- Screenshot extraction instructs the OCR model not to return secret values and applies redaction before the extracted text enters the shared investigation.
- Higgins is forbidden from requesting, repeating or storing login secrets and security codes.

## Purge execution — 2026-09-20

- Legacy IMAP connection rows remaining: `0`.
- IMAP receipts/events/queue rows found and removed in the current database: `0`.
- Existing Ask Higgins history rows purged: `176`.
- Backend supervisor logs contained `0` credential-pattern matches for `app_password`, IMAP username/password field IDs, `password=` or `username=`.
- No app-managed database backup or snapshot process exists in this repository. Any infrastructure-managed historical backup remains subject to the storage provider's retention/deletion process and is outside application-level access.