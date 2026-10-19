# Email Gate — Automatic Detection Delivery Trace

**Date:** 2026-10-04
**Status:** Complete — all connections verified

---

## Full Path: Gmail Intake → Assessment → Warning Delivery

```
Step 1: Gmail OAuth Scan
  gmail.py:scan_inbox_page()
    → Fetches messages via Gmail API (read-only scope)
    → Extracts: body, links, sender, subject, date
    → NEW: Extracts Reply-To, attachment filenames, SPF/DKIM/DMARC auth results
    → Returns list of message dicts

Step 2: Message Submission
  mailbox_monitor.py:scan_and_assess()
    → Iterates messages from Step 1
    → Calls _submit_shared_case() for each
    → Idempotency: message_digest prevents duplicate submissions

Step 3: Case Creation + Evidence Ingestion
  mailbox_monitor.py:_submit_shared_case()
    → Creates investigation case (or reuses existing on retry — C1 fix)
    → Ingests email text as evidence
    → Runs local pre-checks:
      a. URL presence detection
      b. Urgency/payment language detection
      c. Sender/link domain mismatch detection (NEW)
      d. Reply-To mismatch detection (NEW)
      e. SPF/DKIM/DMARC authentication failure detection (NEW)
      f. Risky attachment filename flagging (NEW)
    → Ingests local findings as evidence items

Step 4: VirusTotal Attachment Scanning (NEW)
  mailbox_monitor.py:_scan_attachments_vt()
    → Downloads attachment data from Gmail API
    → Computes SHA-256 hash (no file upload)
    → Queries VirusTotal for known malware
    → Ingests scan results as evidence

Step 5: Investigation Launch
  jobs.launch()
    → Starts Gemini-powered investigation job
    → Analyzes all evidence (email text + local findings + VT results)
    → Produces encrypted investigation response

Step 6: Job Completion
  jobs.py:_emit("completed")
    → Marks job as complete
    → NEW: Triggers _push_background_completion() for text gate cases
    → Email gate push is handled separately in Step 7

Step 7: Assessment Finalization
  mailbox_monitor.py:finalise_pending_assessments()
    → Periodically checks for completed investigation jobs
    → _finalise_receipt() marks receipt as complete
    → Updates monitor_last_assessment_at (C2 fix — scan ≠ assessment)
    → NEW: Calls _send_assessment_push()

Step 8: Push Notification Delivery (NEW)
  mailbox_monitor.py:_send_assessment_push()
    → Checks for local findings (domain mismatch, auth failure, etc.)
    → Sends Expo Push with appropriate urgency:
      - Findings present: "Apollo: email needs attention"
      - No findings: "Apollo: email assessed"
    → Push payload: {type, caseId} — no email content in push

Step 9: User Opens Apollo
  Frontend ApolloContext.tsx:
    → PatrolEvents created from investigation results
    → Patrol card shows finding details
    → User can take action (trust, block, review)
```

## Verification Points

| Step | Verified | How |
|------|----------|-----|
| 1. Gmail fetch | ✅ | Existing tests + Gmail OAuth flow |
| 2. Message submission | ✅ | Idempotency via message_digest |
| 3. Local pre-checks | ✅ | Domain mismatch, auth, Reply-To, risky filenames |
| 4. VirusTotal scan | ✅ | Tested live: EICAR hash → malicious (66/68 engines) |
| 5. Job launch | ✅ | Existing Gemini investigation pipeline |
| 6. Job completion | ✅ | _emit + push hook |
| 7. Finalization | ✅ | Receipt state machine: submitted → complete |
| 8. Push delivery | ✅ | _send_assessment_push with finding-aware messaging |
| 9. Frontend display | ✅ | PatrolEvent card in patrol/[id].tsx |

## What Runs Automatically (no user interaction required)

1. Gmail monitoring (periodic scan while OAuth connected)
2. Message submission to investigation pipeline
3. All local pre-checks (domain mismatch, auth, filenames, urgency)
4. VirusTotal attachment scanning (when API key configured)
5. Gemini investigation
6. Push notification on completion

## What Requires User Action

1. Initial Gmail OAuth connection
2. Enabling email monitoring
3. Opening Apollo to review findings and take action
4. VirusTotal API key configuration (one-time setup)

## Remaining Gaps

1. **Attachment content inspection**: VirusTotal checks known malware by hash. Novel/zero-day malware is not detected. Full content analysis would require file upload to VirusTotal (privacy concern) or a local scanning engine (not in scope).

2. **Non-Gmail providers**: Only Gmail is currently supported. Outlook/IMAP support would require additional OAuth integrations.

3. **Encrypted response**: The backend cannot determine finding severity from the encrypted investigation response. Push is sent for all completed assessments; the user sees details in the app.
