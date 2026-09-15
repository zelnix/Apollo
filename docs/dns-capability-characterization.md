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

- **Diagnostic tool**: a guided, evidence-automated 7-step wizard —
  `frontend/app/dns-capability-diagnostic.tsx` + `frontend/src/diagnostics/dnsCapabilityDiagnostic.ts`
  + `frontend/src/diagnostics/dnsCapabilityTruthSnapshot.ts` +
  `frontend/src/diagnostics/dnsCapabilityDiagnosticReport.ts`. Reachable from the app home screen
  ("Out-of-band · DNS / DoH Capability Diagnostic"). Requires a native Android build (not testable in
  Expo Go / web). Steps: Preflight → Private DNS Off → Automatic → Strict → Browser DoH Off → Browser
  DoH On → Final report. Human involvement is strictly limited to changing an Android/browser setting
  and tapping Continue once a step's own evidence has already been machine-captured — there is no
  "Continue anyway": if a step's configuration can't be automatically confirmed, the wizard only
  offers Check again / Open Settings again / Record as not testable.
- **Probe targets — its OWN dedicated ruleset, deliberately separate from M2.1**: a
  physical-device review found that reusing ONE shared probe hostname
  (`dnsprobe.blocktest.btciq.app`, the frozen M2.1 row-4.1 host) across all 5 wizard rows risked the
  OS/DNS resolver caching an earlier row's genuine bypass resolution and silently reusing it for a
  LATER row — making that later row look like a bypass with no fresh DNS query actually happening.
  Fixed by giving each row its OWN never-reused hostname, signed into a brand-new, independent
  ruleset (`gd-m2-dns-diagnostic-wizard`, see `backend/scripts/create_dns_diagnostic_wizard_ruleset.py`)
  that never touches or version-bumps the frozen M2.1 `gd-m2-website-gate` v4 bundle:

  | Row | Host | Rule ID |
  |---|---|---|
  | Private DNS Off | `dnsprobe.blocktest.btciq.app` (pre-existing, reused by explicit domain-operator choice) | `m2-dns-wizard-dot-off-001` |
  | Private DNS Automatic | `dnsprobe2.blocktest.btciq.app` | `m2-dns-wizard-dot-automatic-001` |
  | Private DNS Strict | `dnsprobe3.blocktest.btciq.app` | `m2-dns-wizard-dot-strict-001` |
  | Browser DoH Off | `dnsprobe4.blocktest.btciq.app` | `m2-dns-wizard-doh-off-001` |
  | Browser DoH On | `dnsprobe5.blocktest.btciq.app` | `m2-dns-wizard-doh-on-001` |

  All 5 hostnames confirmed real/provisioned by the domain operator 2026-09 and signed into
  `gd-m2-dns-diagnostic-wizard` bundle v2. "Private DNS Off" is the one accepted exception to the
  never-reused-hostname rule above (the operator chose to reuse the pre-existing
  `dnsprobe.blocktest.btciq.app` instead of provisioning a 5th net-new host) — that row alone
  carries a residual risk of observing a stale cache entry left over from a prior M2.1 Phase 6A run,
  since that host is shared with the frozen `gd-m2-website-gate` ruleset.

  **This tool never signs or republishes the M2.1 bundle** — only its own separate, additive-only
  ruleset above.
- **Evidence source**:
  - **DoT (Private DNS)**: Apollo's own validated `THREAT_BLOCKED` security-event stream (strictly
    attributed by `host`+`ruleId`, per row) plus the app's own `fetch()` result — both fully
    machine-observed, no manual judgment involved. The native module also reads
    `ConnectivityManager`/`LinkProperties` on the VALIDATED, non-VPN underlying physical network
    (`NET_CAPABILITY_NOT_VPN`) — not `activeNetwork`, which while Apollo's own VpnService is running
    would be Apollo's own virtual tunnel, not the real Wi-Fi/cellular network being characterized
    (a physical-device review caught this).
  - **App-embedded DoH**: the SAME attributed event stream, plus an **independently server-verified
    nonce receipt** (see §1a) — deliberately NOT a manually-reported "it looked like it loaded"
    judgment, since that would reintroduce exactly the human interpretation the M2.1 freeze worked to
    remove. If BOTH an attributed block AND a server receipt are ever present for the same row, that
    is a logical contradiction (a genuinely blocked request could never reach the page to fire its
    receipt) — the row is recorded as `NOT_TESTABLE`, never displayed as `CAPTURED`.
  - **The "Off" row is honest about what Android can and cannot prove**: Android's public API can
    never distinguish a deliberate "Off" from "Automatic" whose opportunistic DoT probe happens to be
    inactive — both read as `INACTIVE_OR_OFF`. So this one row is NOT auto-polled-to-match like
    Automatic/Strict; the tester explicitly confirms THEIR OWN selection, and Apollo records the
    machine-observed state honestly alongside it. The report never states "Private DNS Off verified".
    If the machine ever observes a state that is definitely inconsistent with Off (genuinely active
    encrypted DNS), that row is recorded as `NOT_TESTABLE` with the contradiction spelled out, not
    silently reported under the tester's claim.
  - **Truth-of-state is a hard classification gate, not just a note**: every row now carries a full
    machine-observed snapshot (VPN consent, protection/TUN state, notifications, Website Gate
    configured/DNS-gateway-active, accepted ruleset+bundle+key, probe-rule-confirmed-in-bundle,
    ABIs, active native stack, network transport, build provenance) taken at the moment that row's
    probe ran. If protection wasn't `ACTIVE`, TUN was closed, the DNS gateway was inactive, the
    dedicated probe rule wasn't confirmed in the accepted bundle, or the Private DNS runtime state
    drifted after detection — the row is forced to `NOT_TESTABLE`, regardless of what the raw
    attribution/receipt signals would otherwise suggest.

### 1a. Required infra dependency: 5 nonce-receipt probe pages + DNS/TLS

**Status: RESOLVED 2026-09** — the domain operator confirmed all hostnames below are real/live and
signed into `gd-m2-dns-diagnostic-wizard` bundle v2. Kept here as the reference spec for what must
stay reachable through the physical-device run.

1. **A real DNS record + valid TLS certificate for EACH of the 5 hostnames in the table above**
   (`dnsprobe` reused for "Off"; `dnsprobe2`, `dnsprobe3`, `dnsprobe4`, `dnsprobe5` net-new, all
   `.blocktest.btciq.app`). Point all 5 at the same reachable HTTPS host that already serves
   `blocktest.btciq.app`/`dnsprobe.blocktest.btciq.app` (simplest: if that domain already has
   wildcard DNS/TLS coverage for one-level subdomains, as `dnsprobe.` suggests, these 5 should be
   covered automatically once the A-records exist — confirm before the physical-device run). Without
   this, a genuine DoT/DoH bypass will fail at DNS resolution or the TLS handshake before ever
   reaching the destination, and will incorrectly collapse into `UNOBSERVABLE`/`NOT_TESTABLE` instead
   of a clean `BYPASSED`.
2. **The same static probe file** (unchanged from the original single-host version below) served at
   `https://<each-of-the-5-hosts>/dnsdiag/` (only the 2 `doh-*` hosts are actually opened in a
   browser by the wizard; the 3 `dot-*` hosts only need to answer the app's own plain HTTPS `fetch()`,
   so serving the SAME static content — or even just any 2xx response — at all 5 is the simplest
   approach and keeps the deployment identical to before, just repeated at 5 hostnames instead of 1).
   Serve it with `Cache-Control: no-store` (as an HTTP response header if the server allows it; the
   `<meta>` tag below is a same-effect fallback for static hosts that don't let you set custom
   headers) so browser caching can never replay a stale receipt call or skip the request on a
   repeated run. Minimal reference implementation:

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
   **Verified 2026-09** (prior to this per-row hostname change): `GET
   https://guard-dog-m1.preview.emergentagent.com/api/dns-diagnostics/receipts/<nonce>` is externally
   HTTPS-reachable and returns the expected JSON shape right now — the receiving end is ready and
   unaffected by this change. Before the physical-device run, still re-confirm the static probe page
   itself is actually deployed and reachable at the 4 net-new hosts (`dnsprobe2-5`) — DNS/TLS being
   confirmed by the domain operator does not by itself guarantee the `/dnsdiag/` page is deployed.

   The diagnostic tool constructs the exact URL to open per-row as
   `https://<row's dedicated host>/dnsdiag/?n=<random-nonce>` (see `buildDohProbeUrl` in
   `dnsCapabilityDiagnostic.ts`) and polls `GET /api/dns-diagnostics/receipts/<nonce>` (see
   `backend/app/api/routes/dns_diagnostics.py` — completely separate namespace, in-memory only, never
   touches any M1/M2 rule data) to confirm receipt independently of anything the tester reports.

   **On the in-memory receipt store**: acceptable as-is for this characterization. A backend restart
   mid-session can at worst turn a real bypass into `UNOBSERVABLE` (the receipt is lost) — it can
   never fabricate a `BYPASSED` verdict. No persistence is planned unless physical testing shows an
   actual need for it.

## 2. Evidence schema (per probe, exported verbatim in the JSON/PDF)

| Field | Meaning |
|---|---|
| `category` | `private-dns` (DoT) or `app-embedded-doh` |
| `configurationLabel` | Machine-derived for DoT rows (from the native Private DNS snapshot; "Off" is explicitly labelled tester-selected + machine-observed separately, never "Off verified"); browser name/version is still tester-supplied metadata for DoH rows (Android exposes neither the browser identity nor its DoH setting to a third-party app) but is NOT evidence |
| `probeHostname` | The exact, row-dedicated host (DoT) or full probe URL with nonce (DoH) queried — see the table in §1 |
| `transportNetworkType` | wifi / cellular / other, auto-captured via `expo-network` |
| `sawPlaintextUdp53` / `websiteGateEventProduced` | true iff a genuine `THREAT_BLOCKED` arrived, attributed to this exact row's own `host`+`ruleId` |
| `independentSuccess` | For DoT: did the app's own `fetch()` get a real HTTP response? For DoH: did the backend's nonce-receipt endpoint independently confirm the probe page loaded? Both are machine-observed, never a manual report |
| `independentSuccessSource` | `in-app-fetch` / `controlled-server-receipt` / `not-applicable` |
| `classification` | `CAPTURED` (Apollo saw+blocked it) / `BYPASSED` (independently proven success with no Apollo visibility) / `UNOBSERVABLE` (no evidence either way — never guessed) / `NOT_TESTABLE` (explicit precondition failure, truth-of-state gate violation, or an unresolved contradiction) |
| `notes` | e.g. an unrelated genuine block event correctly excluded, a truth-gate reason, or an Off-claim/drift contradiction |
| `truthSnapshot` | Full machine-observed environment state at probe time (see §1) — attached to every row and to the Preflight step, embedded verbatim in the export |

**Rule, same as the frozen M2.1 row 4.1**: `BYPASSED` is only ever concluded from independent proof
of success — absence of capture alone is always `UNOBSERVABLE`, never assumed to be a bypass. For
DoH specifically, that independent proof is now the server receipt, never a tester's subjective
judgment of whether a page "looked like it loaded". A row is downgraded to `NOT_TESTABLE` — never
silently upgraded to `CAPTURED`/`BYPASSED` — whenever its own truth snapshot shows the environment
it ran under cannot itself be trusted (see §1's "truth-of-state is a hard classification gate").

## 3. Configurations characterized

### Private DNS / DoT (Android Settings → Network & internet → Private DNS)
| # | Mode | Expected (per public Android DoT design) |
|---|---|---|
| DoT-1 | Off (tester-confirmed; machine records the honestly-ambiguous state separately, never "Off verified") | Plaintext UDP/53 — should be `CAPTURED` |
| DoT-2 | Automatic (machine-verified via polling) | Opportunistic DoT if the network's resolver supports it — behavior may vary by network |
| DoT-3 | Strict hostname (e.g. `dns.google`) (machine-verified via polling) | Forces DoT — should be `BYPASSED` |

### App-embedded DoH (at least one representative browser)
| # | Configuration |
|---|---|
| DoH-1 | Representative browser, built-in DoH **disabled** |
| DoH-2 | Same browser, built-in DoH **enabled** |

Not an exhaustive browser survey — enough controlled evidence to establish the capability boundary.
Each row above now queries its OWN dedicated hostname (§1) — no two rows ever share a hostname,
eliminating cross-row DNS-cache contamination as a possible confound.

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
