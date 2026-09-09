# M2.1 Phase 6 — Gate Guard Android Physical-Device Acceptance Report

**Status of this document:** FILLABLE TEMPLATE. Prepared *before* the device run so evidence is
captured contemporaneously, field-by-field, as the test actually happens — never reconstructed
afterward from memory or logs after the fact. Copy this file to
`M2_PHASE6_ACCEPTANCE_REPORT_<yyyy-mm-dd>.md` before filling it in; keep this template untouched.

---

## 🔒 FROZEN ACCEPTANCE INVARIANT — read before filling anything in

> **`THREAT_BLOCKED` is evidence-backed only.** It requires an authorized destination, a real packet
> observed by the enforcement layer, an intentional drop, an enforcement evidence record, and event
> emission from that evidence path. **No rule match or UI action alone may satisfy Phase 6
> acceptance.**

This applies to every row of the PASS/FAIL matrix below, not just the "positive enforcement" group.
If any evidence field in §3 cannot be filled in with a real, observed, timestamped fact for a given
test, that test **cannot** be marked PASS for enforcement purposes — record it honestly as FAIL or as
a documented capability gap (§5), never as an inferred/assumed PASS.

---

## 0. Provenance baseline (fill in before starting any test)

**Preferred provenance**: the CI-verified Phase 5/5.1/5.2 commit + its `android-dev-build`/`gate-guard`
CI artifacts. A fresh Publish → Generate Android build is acceptable **only if** its commit SHA and
generated APK provenance are captured below **and** it contains no code changes beyond the verified
commit state (confirm with `git diff <verified-sha> <build-sha> --stat` — must be empty).

| Field | Value |
|---|---|
| Branch | `<FILL: e.g. m2-native-acceptance>` |
| Exact commit SHA tested | `<FILL: full 40-char SHA>` |
| Commit SHA matches CI-green commit? | `<FILL: yes/no — if no, paste the `git diff --stat` output showing zero drift>` |
| GitHub Actions run ID | `<FILL: e.g. 34295478834>` |
| GitHub Actions run URL | `<FILL>` |
| Relevant job name(s) | `<FILL: e.g. "Gate Guard", "android-dev-build", "android-startup-smoke">` |
| Relevant artifact name(s) | `<FILL: e.g. "android-dev-build", "gate-guard", "android-native-gate">` |
| Artifact SHA-256 digest(s) used | `<FILL — copy from the Actions run's Artifacts table>` |
| Build source | `<FILL: "CI artifact" \| "fresh Publish build" — if fresh, justify no-drift above>` |
| APK filename | `<FILL>` |
| APK SHA-256 (of the installed file, computed on-device or via `sha256sum`) | `<FILL>` |
| App version / build number | `<FILL>` |
| Target architecture(s) (arm64-v8a / armeabi-v7a / x86_64 / universal) | `<FILL>` |
| **Active Android native stack — explicit confirmation** | `<FILL: MUST read "com.guarddog.*" — record the exact package name observed (e.g. via `adb shell pm dump <package> \| grep -i guarddog` or logcat tag) and confirm com.hucentai.apollosecurity is NOT the module under test>` |
| Backend branch | `<FILL>` |
| Backend commit SHA | `<FILL>` |
| Backend includes main's Biting/Truth-of-State invariant? | `<FILL: yes/no + how verified>` |
| Ruleset / bundle ID | `<FILL: e.g. gd-m2-website-gate>` |
| Bundle version | `<FILL>` |
| Bundle signing key ID | `<FILL>` |
| Bundle payload hash / signature state | `<FILL: verified natively? yes/no>` |
| Session start timestamp (ISO-8601, device clock) | `<FILL>` |

## 1. Device & environment

| Field | Value |
|---|---|
| Device make/model | `<FILL>` |
| Android OS version | `<FILL>` |
| Android security patch level | `<FILL>` |
| Apollo app permissions granted before test (VPN, notifications, etc.) | `<FILL — list each with granted/denied>` |
| VPN state before test (off/on, any other VPN app active) | `<FILL>` |
| Network type (wifi/cellular/other) | `<FILL>` |
| Private DNS setting (Off / Automatic / Private DNS provider hostname) | `<FILL>` |
| Timestamp environment recorded (ISO-8601) | `<FILL>` |

## 2. Test case setup

| Field | Value |
|---|---|
| Authorized test domain/indicator used (must come from the signed ruleset, not ad-hoc) | `<FILL>` |
| Matching rule ID in the accepted bundle | `<FILL>` |
| Timestamp test domain resolved to be used (ISO-8601) | `<FILL>` |

## 3. Evidence chain — filled in live, per test run, with timestamps at every step

Repeat this table per test attempt (positive case; repeat for each negative/recovery case as relevant,
noting explicitly where a step is expected to NOT occur).

| Step | Observed fact | Timestamp (ISO-8601) |
|---|---|---|
| DNS query observed (raw query as seen by the DNS gateway packet handler) | `<FILL>` | `<FILL>` |
| Website Gate decision + reason (e.g. "block: matched rule X", "allow: override present", "allow: no rule match") | `<FILL>` | `<FILL>` |
| Sinkhole IP / binding created (TEST-NET-1 address, binding key, lifetime) | `<FILL, or "none — explain why">` | `<FILL>` |
| Actual application packet observed at the TUN enforcement layer (source, dest IP:port, protocol) | `<FILL, or "none observed">` | `<FILL>` |
| Intentional packet drop performed (explicit, not merely a timeout/no-route) | `<FILL: yes/no + mechanism>` | `<FILL>` |
| EnforcementEvidence record created — full record dump | `<FILL: paste JSON>` | `<FILL>` |
| `enforcementEvidenceId` | `<FILL>` | — |
| `THREAT_BLOCKED` event emitted, `enforcementEvidenceId` on the event matches the evidence record above | `<FILL: yes/no — MUST match exactly>` | `<FILL>` |
| Frontend Patrol/event correlation (event visible in app, correlated to same evidence/event id) | `<FILL>` | `<FILL>` |
| "Apollo is biting" UI consequence shown to user | `<FILL: yes/no + screenshot ref>` | `<FILL>` |
| Stop/revoke/recovery result (if exercised in this run) | `<FILL>` | `<FILL>` |

---

## 4. PASS/FAIL matrix

Every row must be justified by the evidence chain in §3 (or an explicit negative — "no such record
exists," which is the CORRECT and expected fact for negative-group tests). A row cannot be marked PASS
on the basis of a rule match, UI action, or log message alone — only on the full evidence chain the
frozen invariant requires.

### Group 1 — Positive enforcement
Known authorized blocked destination produces the full DNS → sinkhole → TUN packet → intentional drop
→ evidence → event → "Apollo is biting" chain, end to end, with every step of §3 filled in with a real
observed fact.

| # | Test | Result (PASS/FAIL) | Evidence ref (§3 row / evidence ID) | Notes |
|---|---|---|---|---|
| 1.1 | Authorized blocked domain → full chain observed | `<FILL>` | `<FILL>` | `<FILL>` |
| 1.2 | Repeat resolution of same domain within binding lifetime → consistent evidence | `<FILL>` | `<FILL>` | `<FILL>` |
| 1.3 | (add rows as needed) | | | |

### Group 2 — Negative false-Biting
Rule match, hostname match, analysis verdict, manual block/override, failed request, VPN start, or
other non-enforcement conditions must **never** produce verified `THREAT_BLOCKED` or "Apollo is
biting." PASS means the fabrication did **not** happen — confirm by checking no `THREAT_BLOCKED`
event/evidence exists for that action.

| # | Test | Result (PASS/FAIL) | Evidence ref (confirm absence) | Notes |
|---|---|---|---|---|
| 2.1 | Rule match alone (no packet ever transits TUN) does not emit `THREAT_BLOCKED` | `<FILL>` | `<FILL>` | `<FILL>` |
| 2.2 | Manual local override / manual "block" UI tap does not emit `THREAT_BLOCKED` (local override is `ALLOW`-only per design — confirm no block path exists at all) | `<FILL>` | `<FILL>` | `<FILL>` |
| 2.3 | Local URL/domain analysis verdict ("malicious"/"suspicious") alone, with no VPN/enforcement active, does not emit `THREAT_BLOCKED` | `<FILL>` | `<FILL>` | `<FILL>` |
| 2.4 | VPN/Website Gate starting (configure + accept bundle) alone, with no matching traffic, does not emit `THREAT_BLOCKED` | `<FILL>` | `<FILL>` | `<FILL>` |
| 2.5 | A failed/errored DNS forward (fail-open path) does not emit `THREAT_BLOCKED` | `<FILL>` | `<FILL>` | `<FILL>` |
| 2.6 | (add rows as needed) | | | |

### Group 3 — Recovery / stop / revoke
VPN stop, permission revoke, app restart, network transition and restoration behave safely and
truthfully (no stale "biting" state persists after enforcement actually stops; no state silently
fabricated as active when it isn't).

| # | Test | Result (PASS/FAIL) | Evidence ref | Notes |
|---|---|---|---|---|
| 3.1 | Stop protection → status truthfully reports inactive, no further evidence/events generated | `<FILL>` | `<FILL>` | `<FILL>` |
| 3.2 | Revoke VPN permission mid-session → app detects and reports truthfully, no silent fabricated "active" state | `<FILL>` | `<FILL>` | `<FILL>` |
| 3.3 | App restart (kill + relaunch) → overrides rehydrate correctly from durable store, no orphaned "biting" UI state | `<FILL>` | `<FILL>` | `<FILL>` |
| 3.4 | Network transition (wifi ↔ cellular) → protection status/degradedReason reported truthfully through the transition | `<FILL>` | `<FILL>` | `<FILL>` |
| 3.5 | (add rows as needed) | | | |

### Group 4 — Private DNS / DoT / DoH
Explicitly record whether traffic is captured, bypasses Apollo, or is otherwise unobservable. **A
bypass is a documented capability result, not something to disguise as a successful block.**

| # | Test | Result (captured / bypassed / unobservable) | Evidence ref | Notes |
|---|---|---|---|---|
| 4.1 | Android Private DNS OFF, authorized domain query → captured, full chain as Group 1 | `<FILL>` | `<FILL>` | `<FILL>` |
| 4.2 | Android Private DNS set to "Automatic" → record actual observed behavior (captured or bypassed) | `<FILL>` | `<FILL>` | `<FILL>` |
| 4.3 | Android Private DNS set to explicit provider (e.g. `dns.google`) → confirm query bypasses Apollo's plaintext UDP/53 interception entirely; confirm no `THREAT_BLOCKED` is fabricated for this bypassed traffic | `<FILL>` | `<FILL>` | `<FILL>` |
| 4.4 | App using embedded DoH (e.g. a browser with DoH forced on) → confirm query is invisible to Apollo's DNS gateway; confirm no `THREAT_BLOCKED` fabricated | `<FILL>` | `<FILL>` | `<FILL>` |
| 4.5 | (add rows as needed) | | | |

---

## 5. Known capability gaps (record explicitly, do not omit)

| Gap | Observed impact | Disclosed in capability reporting? (`ANDROID_M2_DNS_VISIBILITY_SCOPE` / `ANDROID_M2_DNS_COVERAGE_TAG`) |
|---|---|---|
| Private DNS (DoT) bypass | `<FILL>` | Yes — see `packages/guarddog-contracts/src/capabilities.ts` |
| App-embedded DoH bypass | `<FILL>` | Yes — see `packages/guarddog-contracts/src/capabilities.ts` |
| `<FILL: any other gap found during this run>` | `<FILL>` | `<FILL>` |

---

## 6. Overall acceptance verdict

Select exactly one. Justify with references to the specific matrix rows above — never a bare verdict
without evidence references.

- [ ] **PASS** — every Group 1/2/3 row passed; Group 4 behaviors are fully consistent with the
      documented capability gaps (no undisclosed bypass, no fabricated evidence).
- [ ] **FAIL** — one or more Group 1/2/3 rows failed (specify which, and whether it was a missing
      enforcement capability or, more seriously, a Truth-of-State violation — i.e. any case where
      `THREAT_BLOCKED`/"Apollo is biting" was produced without the full evidence chain).
- [ ] **PASS WITH DOCUMENTED CAPABILITY GAP** — Group 1/2/3 rows all passed; Group 4 revealed a real,
      now-documented visibility limitation (e.g. Private DNS/DoH bypass) that does not violate
      Truth-of-State (no fabricated evidence for the bypassed traffic) but does mean coverage is
      narrower than "full."

**Verdict**: `<FILL>`

**Justification**: `<FILL — cite specific matrix row numbers>`

**Tested commit SHA (repeat from §0 for a self-contained record)**: `<FILL>`

**Report completed by / timestamp**: `<FILL>`

---

## 7. Next step on this verdict

- If **PASS** or **PASS WITH DOCUMENTED CAPABILITY GAP**: this commit becomes the candidate native
  baseline for Apollo integration (per the Android Native Consolidation direction) — freeze it (tag or
  record the SHA in `memory/PRD.md`), do not continue routine M2 development on top of it without a
  new decision to do so.
- If **FAIL**: do not freeze. Record the specific failing row(s), return to development to fix, re-run
  `native-gates` CI, then repeat this Phase 6 report on the new corrected commit.
