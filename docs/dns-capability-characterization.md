# Apollo — Out-of-band Private DNS (DoT) / App-embedded DoH Capability Characterization

**Status of this document:** FILLABLE TEMPLATE — methodology and evidence schema are final; the
**Results** section (§4) is filled in from the exported JSON/PDF produced by the diagnostic tool
described below, after a physical-device characterization run. Copy this file to
`dns-capability-characterization-<yyyy-mm-dd>.md` before filling it in; keep this template untouched.

---

## 0. Scope and relationship to M2.1

**M2.1 is FROZEN PASS** (see `memory/PRD.md`, commit `140de1c340f127046591a0e15a262e05a25ce5ce`, CI
run `34680021418`, APK SHA-256 `5faaf3a77b8b0a250ed73f83f98bfbb4b63fe5c1245aca757ceb7dab82315ee5`).
**This characterization does not touch, re-run, or affect that freeze in any way.** It is a separate,
later, purely observational milestone that documents — with fresh, controlled, evidence-backed proof
— the known visibility boundary already disclosed in code at
`packages/guarddog-contracts/src/capabilities.ts` (`ANDROID_M2_DNS_VISIBILITY_SCOPE`,
`ANDROID_M2_DNS_COVERAGE_TAG = "dns:udp-53"`):

> Apollo's Website Gate observes DNS queries and determines destination domains only for traffic that
> reaches its own plaintext UDP/53 DNS interception point. Android Private DNS (DoT) and
> app-embedded DoH resolvers bypass this entirely and are invisible to Apollo.

**No mitigation, enforcement, or routing change is implemented or tested here.** Specifically, none
of the following are in scope for this milestone: blocking DoT port 853 at the VPN layer, heuristic
detection of encrypted-DNS-shaped traffic, intercepting/MITM-ing DoH, or app-specific DoH-provider
blocklists. Any of those would be new security-enforcement behavior requiring its own design +
acceptance milestone (see §6, "Future mitigation candidates").

## 1. Tooling

- **Diagnostic tool**: `frontend/app/dns-capability-diagnostic.tsx` +
  `frontend/src/diagnostics/dnsCapabilityDiagnostic.ts` +
  `frontend/src/diagnostics/dnsCapabilityDiagnosticReport.ts`. Reachable from the app home screen
  ("Out-of-band · DNS / DoH Capability Diagnostic"). Requires a native Android build (not testable in
  Expo Go / web).
- **Probe target**: the dedicated, already-signed M2.1 rule `m2-block-dns-capability-001` →
  `dnsprobe.blocktest.btciq.app`, live in the frozen `gd-m2-website-gate` bundle (v4). Reused
  **read-only** — this tool never signs or republishes a bundle.
- **Evidence source**:
  - **DoT (Private DNS)**: Apollo's own validated `THREAT_BLOCKED` security-event stream (strictly
    attributed by `host`+`ruleId`) plus the app's own `fetch()` result — both fully machine-observed,
    no manual judgment involved.
  - **App-embedded DoH**: the SAME attributed event stream, plus an **independently server-verified
    nonce receipt** (see §1a) — deliberately NOT a manually-reported "it looked like it loaded"
    judgment, since that would reintroduce exactly the human interpretation the M2.1 freeze worked to
    remove.

### 1a. Required infra dependency: the nonce-receipt probe page + DNS/TLS

Before running the DoH matrix, two things must exist on the operator's side (outside this codebase —
this repo cannot provision external DNS/TLS/hosting):

1. **A real DNS record + valid TLS certificate for `dnsprobe.blocktest.btciq.app`.** Without this, a
   genuine DoH bypass will fail at DNS resolution or the TLS handshake before ever reaching the
   receipt endpoint, and will incorrectly collapse into `UNOBSERVABLE` instead of a clean `BYPASSED`.
   Point it at any reachable HTTPS host (does not need to be the same server as `blocktest.btciq.app`,
   though reusing that existing controlled endpoint's server is the simplest option since it is
   already provisioned for a sibling subdomain).
   **Verified 2026-09** (externally, via the M1 controlled-endpoint content already appearing at the
   root): `https://dnsprobe.blocktest.btciq.app/` already resolves and serves over HTTPS with no
   certificate/interstitial error — DNS + TLS coverage for this hostname is confirmed in place. Only
   the `/dnsdiag/` static file below (step 2) still needs to be deployed there; nothing exists at
   that path yet.
2. **One static file** served at `https://dnsprobe.blocktest.btciq.app/dnsdiag/` (any static web
   server — no custom backend logic required on that host). It must read the `n` query parameter
   from its own URL and call the Apollo backend's receipt endpoint. Serve it with
   `Cache-Control: no-store` (as an HTTP response header if the server allows it; the `<meta>` tag
   below is a same-effect fallback for static hosts that don't let you set custom headers) so browser
   caching can never replay a stale receipt call or skip the request on a repeated run. Minimal
   reference implementation:

   ```html
   <!DOCTYPE html>
   <html><head><meta http-equiv="Cache-Control" content="no-store" /></head><body>
   <p>Apollo DNS/DoH diagnostic probe. You can close this page.</p>
   <script>
     var n = new URLSearchParams(location.search).get("n");
     if (n) {
       fetch("<GD_BACKEND_URL>/api/dns-diagnostics/receipts/" + encodeURIComponent(n), { method: "POST", keepalive: true, cache: "no-store" }).catch(function () {});
     }
   </script>
   </body></html>
   ```

   Replace `<GD_BACKEND_URL>` with the same public backend base URL already used for
   `GD_BACKEND_URL` in the `native-gates` CI variable (see `docs/M1_CI_RUNBOOK.md`) — currently
   `https://guard-dog-m1.preview.emergentagent.com`. The backend's CORS policy already allows all
   origins, so no server-side changes are needed to accept this cross-origin call.
   **Verified 2026-09**: `GET https://guard-dog-m1.preview.emergentagent.com/api/dns-diagnostics/receipts/<nonce>`
   is externally HTTPS-reachable and returns the expected JSON shape right now — the receiving end is
   ready; only the sending static page (step 2 above) is still pending.

   The diagnostic tool constructs the exact URL to open as
   `https://dnsprobe.blocktest.btciq.app/dnsdiag/?n=<random-nonce>` (see
   `buildDohProbeUrl` in `dnsCapabilityDiagnostic.ts`) and polls
   `GET /api/dns-diagnostics/receipts/<nonce>` (see `backend/app/api/routes/dns_diagnostics.py` —
   completely separate namespace, in-memory only, never touches any M1/M2 rule data) to confirm
   receipt independently of anything the tester reports.

   **On the in-memory receipt store**: acceptable as-is for this characterization. A backend restart
   mid-session can at worst turn a real bypass into `UNOBSERVABLE` (the receipt is lost) — it can
   never fabricate a `BYPASSED` verdict. No persistence is planned unless physical testing shows an
   actual need for it.

## 2. Evidence schema (per probe, exported verbatim in the JSON/PDF)

| Field | Meaning |
|---|---|
| `category` | `private-dns` (DoT) or `app-embedded-doh` |
| `configurationLabel` | Manual tester label — Android does not expose Private DNS mode or another app's DoH setting to this app |
| `probeHostname` | The exact host (DoT) or full probe URL with nonce (DoH) queried |
| `transportNetworkType` | wifi / cellular / other, auto-captured via `expo-network` |
| `sawPlaintextUdp53` / `websiteGateEventProduced` | true iff a genuine `THREAT_BLOCKED` arrived, attributed to this exact probe's `host`+`ruleId` |
| `independentSuccess` | For DoT: did the app's own `fetch()` get a real HTTP response? For DoH: did the backend's nonce-receipt endpoint independently confirm the probe page loaded? Both are machine-observed, never a manual report |
| `independentSuccessSource` | `in-app-fetch` / `controlled-server-receipt` / `not-applicable` |
| `classification` | `CAPTURED` (Apollo saw+blocked it) / `BYPASSED` (independently proven success with no Apollo visibility) / `UNOBSERVABLE` (no evidence either way — never guessed) / `NOT_TESTABLE` (explicit precondition failure) |
| `notes` | e.g. an unrelated genuine block event correctly excluded from this probe's evidence |

**Rule, same as the frozen M2.1 row 4.1**: `BYPASSED` is only ever concluded from independent proof
of success — absence of capture alone is always `UNOBSERVABLE`, never assumed to be a bypass. For
DoH specifically, that independent proof is now the server receipt, never a tester's subjective
judgment of whether a page "looked like it loaded."

## 3. Configurations characterized

### Private DNS / DoT (Android Settings → Network & internet → Private DNS)
| # | Mode | Expected (per public Android DoT design) |
|---|---|---|
| DoT-1 | Off | Plaintext UDP/53 — should be `CAPTURED` |
| DoT-2 | Automatic | Opportunistic DoT if the network's resolver supports it — behavior may vary by network |
| DoT-3 | Strict hostname (e.g. `dns.google`) | Forces DoT — should be `BYPASSED` |

### App-embedded DoH (at least one representative browser)
| # | Configuration |
|---|---|
| DoH-1 | Representative browser, built-in DoH **disabled** |
| DoH-2 | Same browser, built-in DoH **enabled** |

Not an exhaustive browser survey — enough controlled evidence to establish the capability boundary.

## 4. Results (fill in from the exported JSON/PDF after the physical-device run)

**Provenance**: device `<FILL>`, Android `<FILL>`, APK SHA-256 `<FILL>`, commit `<FILL>`, session ID `<FILL>`.

| # | Configuration label | Network | Saw plaintext UDP/53 | Independent success | Classification | Notes |
|---|---|---|---|---|---|---|
| `<FILL>` | `<FILL>` | `<FILL>` | `<FILL>` | `<FILL>` | `<FILL>` | `<FILL>` |

## 5. Product implications (fill in after §4 is complete)

`<FILL: e.g. "DoT Strict mode and DoH both confirmed BYPASSED with independently-proven success —
matches the disclosed capability scope exactly, no surprises found.">`

## 6. Future mitigation candidates (NOT implemented, NOT in scope this milestone)

Recorded here for future planning only — none of the following exist in the codebase today and none
should be inferred as planned or committed work from this document alone:

- Blocking DoT port 853 at the VPN layer (would break any legitimate DoT traffic too — needs its own
  false-positive analysis).
- Heuristic detection of encrypted-DNS-shaped traffic (QUIC/DoH port 443 heuristics — high false-positive
  risk, needs dedicated design).
- Intercepting/MITM-ing DoH (certificate-pinning and trust implications — significant scope).
- App-specific DoH-provider blocklist (partial mitigation only, easily bypassed by provider rotation).

Each of the above is a new security-enforcement behavior and would require its own design + physical
acceptance milestone, following the same rigor as M2.1 — not a follow-on to this characterization.

## 7. Next step on this document

Once §4/§5 are filled in from a real physical-device run, this becomes the frozen characterization
record for Apollo's Private DNS/DoH visibility boundary. Per current planning
(`memory/PRD.md`), the next formal milestone after this is the **Android Native Consolidation
Assessment** (com.guarddog.* vs com.hucentai.apollosecurity — a decision milestone, not an immediate
merge), followed by the **iOS capability-profile milestone**. Email Guard / Call Guard / SMS Guard
stay queued behind those platform-foundation decisions.
