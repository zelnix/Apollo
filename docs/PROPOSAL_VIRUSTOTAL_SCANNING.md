# Proposal: Attachment Malware Scanning (VirusTotal Integration)

**Date:** 2026-10-04
**Status:** Proposal for approval

---

## Protection Gap

Email Gate currently flags attachment filenames with risky extensions (`.exe`, `.scr`, `.bat`, etc.)
but **never inspects attachment content**. File Gate is manual-only and has no malware detection.

This means: a malicious `.pdf` or `.docx` with embedded macros/exploits passes through Email Gate
with no warning. The user sees "no concerns" for an email with a weaponized attachment because the
filename alone doesn't trigger any rule.

## Proposed Solution

**VirusTotal API** provides file reputation checking via hash lookup (no file upload required for
known malware). When an email has attachments, Apollo computes the file hash from the Gmail API
attachment data and checks it against VirusTotal's database of ~3 billion known malware samples.

### Architecture

```
Gmail inbox scan → attachment detected
  → Download attachment metadata from Gmail API
    → Compute SHA-256 hash of attachment content
      → VirusTotal API: GET /files/{hash} (hash lookup, no upload)
        → If known: return detection results (malware name, detection count)
        → If unknown: return "not in database" (optional: submit for scan)
          → Report results in investigation findings
```

### Two Modes

1. **Hash-only lookup** (recommended default)
   - Sends only the file's SHA-256 hash to VirusTotal
   - No file content leaves the device/backend
   - Catches all previously-seen malware variants
   - Does NOT catch zero-day or novel malware

2. **Full file submission** (optional, requires user consent)
   - Uploads the actual file to VirusTotal for scanning
   - 70+ antivirus engines analyze the file
   - Results in ~60 seconds
   - File becomes part of VirusTotal's public corpus
   - **Significant privacy concern**: file content is shared with VirusTotal and its partners

### Cost

| Tier | Rate Limit | Cost | Suitable For |
|------|-----------|------|-------------|
| **Free (Public API)** | 4 lookups/min, 500/day | $0 | Personal use (1-2 users) |
| **Premium (Private API)** | 30 lookups/min, unlimited | ~$700/month | Commercial/multi-user |
| **Enterprise** | Custom | Custom | High volume |

### Platform Feasibility

| Aspect | Detail |
|--------|--------|
| API availability | VirusTotal v3 API, well-documented, stable |
| Integration effort | ~50 lines of backend code |
| Dependencies | None new (uses existing `httpx` for API calls) |
| Latency | Hash lookup: ~200ms. Full scan: ~60s |
| Gmail scope | Existing `gmail.readonly` scope already allows reading attachments |

### What It Catches

- Known malware (trojans, ransomware, spyware, adware)
- Known exploit documents (weaponized PDFs, Office macros)
- Known phishing kits packaged as attachments
- Potentially unwanted programs (PUPs)

### What It Doesn't Catch

- Zero-day malware (not yet in any AV database)
- Novel polymorphic malware (hash doesn't match known samples)
- Malicious content in password-protected archives
- Social engineering attachments that aren't technically malware (e.g., fake invoices as PDFs)

### Limitations

- **Free tier rate limits**: 4 lookups/minute means processing a mailbox with many attachments is slow
- **Hash-only misses novel malware**: ~15-20% of malware in the wild is unknown at time of first encounter
- **No real-time protection**: this is detection after delivery, not prevention
- **Full submission is permanent**: uploaded files become part of VirusTotal's public dataset
- **False positives**: some AV engines flag legitimate software; use detection-count thresholds

### Data Sharing

| Mode | What's Shared | With Whom |
|------|--------------|-----------|
| Hash lookup | SHA-256 hash only (32 bytes) | VirusTotal (Google) |
| Full submission | Complete file content | VirusTotal + 70+ AV vendors + public corpus |

### Honest Reporting

Apollo should clearly distinguish:
- "**Malware detected**: 45/70 antivirus engines flagged this file as [malware name]"
- "**Risky attachment type**: `.exe` files can execute code. Attachment content was not inspected."
- "**Not in malware database**: this file is unknown to VirusTotal. This does not confirm it is safe."
- "**Attachment not checked**: malware scanning is not configured."

### Recommendation

**Proceed with hash-only mode on the free tier.** This provides meaningful protection for personal
use at zero cost and zero privacy impact (only hashes are shared). The free tier's 500 lookups/day
is sufficient for typical personal email volume.

**Defer full submission mode**: the privacy implications (file content shared publicly) require
careful consent flow and are not appropriate as a default.

**Defer premium tier**: evaluate after usage patterns are established. $700/month is justified only
with multiple active users.

### Implementation Steps (if approved)

1. User provides VirusTotal API key (free registration at virustotal.com)
2. Add `VIRUSTOTAL_API_KEY` to backend `.env`
3. Create `backend/services/virustotal.py` with hash-lookup function
4. In `mailbox_monitor._submit_shared_case`: when attachments exist, download attachment data from Gmail API, compute SHA-256, check VirusTotal
5. Add scan results to investigation findings
6. Update Email Gate status reporting to show "malware scanning: configured/not configured"
