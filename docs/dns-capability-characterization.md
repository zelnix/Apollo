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
- **Evidence source**: Apollo's own validated `THREAT_BLOCKED` security-event stream, strictly
  attributed by `host` + `ruleId` match to the dedicated probe rule (same principle the M2.1 freeze
  required for row 4.1 — never inferred from a shared/global counter).

## 2. Evidence schema (per probe, exported verbatim in the JSON/PDF)

| Field | Meaning |
|---|---|
| `category` | `private-dns` (DoT) or `app-embedded-doh` |
| `configurationLabel` | Manual tester label — Android does not expose Private DNS mode or another app's DoH setting to this app |
| `probeHostname` | Always `dnsprobe.blocktest.btciq.app` |
| `transportNetworkType` | wifi / cellular / other, auto-captured via `expo-network` |
| `sawPlaintextUdp53` / `websiteGateEventProduced` | true iff a genuine `THREAT_BLOCKED` arrived, attributed to this exact probe's `host`+`ruleId` |
| `independentSuccess` | For DoT: did the app's own `fetch()` get a real HTTP response? For DoH: tester's manual report of whether the browser's page load succeeded (this app cannot observe another app's network result) |
| `independentSuccessSource` | `in-app-fetch` / `manual-tester-report` / `not-applicable` |
| `classification` | `CAPTURED` (Apollo saw+blocked it) / `BYPASSED` (independently proven success with no Apollo visibility) / `UNOBSERVABLE` (no evidence either way — never guessed) / `NOT_TESTABLE` (explicit precondition failure) |
| `notes` | e.g. an unrelated genuine block event correctly excluded from this probe's evidence |

**Rule, same as the frozen M2.1 row 4.1**: `BYPASSED` is only ever concluded from independent proof
of success — absence of capture alone is always `UNOBSERVABLE`, never assumed to be a bypass.

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
