# Stage 1A — Production Engine Source Transfer Planning

**Status: PLANNING ONLY. No code imported, no GuardDog code written or recreated, nothing in
this repo changed as a result of this document.** This does not touch `ApolloDnsVpnService.kt`,
`DnsPacket.kt`, consumer UI, Higgins, or `SecurityPlatformAdapter.ts`. It answers one question:
*how* the approved production-relevant GuardDog source can be moved intact from the isolated
m2-native-acceptance project into this isolated Apollo-main workspace, with provenance provable
before any integration — not whether/how it gets wired up (that is later, Stage 1B/2, per
`docs/APOLLO_PROTECTION_STAGE0.md` §6).

## 0. Preconditions (status as reported)

- Stage 0 is closed on the m2-native-acceptance side: the trust/revocation correction has been
  applied there (commit `df26765`). No further action is needed from this document on that
  correction — it is settled.
- Two manual actions remain with the user, not with either agent session (per confirmed platform
  behaviour: no cross-project relay, no agent-invocable GitHub push):
  1. Click **Save to GitHub** in the m2-native-acceptance project so `df26765` and the Stage 0
     docs become durable there.
  2. Click **Save to GitHub** in this Apollo-main project for `docs/APOLLO_PROTECTION_STAGE0.md`
     when comfortable with it.
- Neither of those blocks the planning in this document — they only block Stage 1B's *execution*
  (§4) if GitHub-based transfer (§2, Method A) ends up being the chosen method.

## 1. Frozen source under transfer (record, not fetched yet)

| Field | Value |
|---|---|
| Commit | `e5d11be912c76775c5a8b27b53218211484ca8bd` |
| CI run | `35171369548` |
| Validated APK SHA-256 | `905d66a9ab5d9f70c22c4a2fce897cdf668d975908546e583b404db01f774335` |
| Approved (production-relevant) scope | `packages/guarddog-android-sdk`, `packages/guarddog-expo-module`, production `com.guarddog.*` native code |
| Explicitly excluded | Certification-only code — m2's own acceptance harnesses/fixtures, CI workflow config, test-only tooling, anything outside the approved paths |

## 2. What is actually available in *this* environment (tested empirically, not assumed)

**Update (2026-06): the repo is now known and confirmed public — `https://github.com/zelnix/Apollo`.**
Live inspection (read-only, scratch `/tmp` clone, nothing copied into this workspace) confirmed:

- Branches present: `main`, `m1-native-acceptance`, `m2-native-acceptance`.
- This repo is genuinely the **other** (m2) project — its own `frontend/app.json` identifies it
  as `"Apollo Native Gates"` / `com.emergent.guarddogm.k6cugf`, confirming it is not this
  workspace's repo.
- The pinned commit `e5d11be912c76775c5a8b27b53218211484ca8bd` is real, is the **exact tip of
  `main`**, and **is an ancestor of `m2-native-acceptance`** (which sits 3 commits ahead of it:
  `e5d11be` → `f0aecd5` "Apollo Production Protection Integration Assessment + Stage 0
  decisions" → `df26765` "Correct Stage 0 item 1: build-time pinned root + runtime-updatable
  signed Trusted Key Manifest trust model; fix offline fail-open/fail-closed wording" → `df7a4fd`
  current tip). `df26765` and `docs/APOLLO_INTEGRATION_STAGE0_DECISIONS.md` both genuinely exist
  there, matching what was reported.
- At the pinned commit, `packages/` contains exactly: `guarddog-android-sdk`,
  `guarddog-expo-module`, **and two not previously named**: `guarddog-contracts` and
  `guarddog-ios-sdk` — see §5 open question.
- Native `com/guarddog/*` source is real and present (e.g.
  `guarddog-core/.../rules/TrustedKeyRegistry.kt`, `RuleBundleVerifier.kt`,
  `BundleVersionStore.kt` — direct implementations of the trust-manifest architecture recorded in
  `docs/APOLLO_PROTECTION_STAGE0.md` §9, an independent confirmation the two documents agree).
- `docs/` at the pinned commit also contains clearly certification-only material — `M1_*.md`,
  `M2_PHASE6_ACCEPTANCE_TEMPLATE.md`, `M2_WEBSITE_GATE_DESIGN.md`,
  `dns-capability-characterization.md`, and a `docs/evidence/` tree of test XML/binary result
  files — concrete confirmation that the deny-list in §5 is necessary, not theoretical.

This materially changes the method ranking below: Method A no longer has an unknown-repo/token
blocker — the repo is already known and public, so it is now the simplest option, not the
secondary one.

| Method | Mechanically available here? | Notes |
|---|---|---|
| **A. Live fetch from GitHub** (clone/fetch a pinned commit) | **Yes — confirmed, right now, no token needed.** Verified: `git ls-remote`/clone of `https://github.com/zelnix/Apollo` succeeds; the pinned commit is directly reachable and its full tree was inspected read-only. | **Now the recommended primary method** — the repo is public, so nothing further is needed from the user to *read* it. Still must checkout the **exact pinned SHA** (not a branch tip) when actually importing, since both `main` and `m2-native-acceptance` have moved/branch further. |
| **B. Git bundle of the single pinned commit**, exported from m2 and attached in chat | **Yes** — verified locally (see original test below). | No longer necessary now that (A) is directly available, but remains a valid fallback if GitHub access is ever revoked/repo goes private. |
| **C. Plain exported archive** (zip/tar of just the approved paths) + a manifest | **Yes**, same attachment path as B. | Weakest of the three: loses git's native content-addressing, so integrity rests entirely on a manifest (e.g. a SHA-256 per file) that the m2 side must generate and that this side must trust was made honestly from the pinned commit — there is no independent, automatic check equivalent to a commit hash. |
| **D. Any other mechanically verifiable method** | **None found.** Fork Chat (checked with platform support) is same-project only and doesn't bridge isolated projects. No other cross-project primitive exists today. |

*(Original Method B integrity test, kept for the record: a locally-run `git bundle create` →
`git clone` round-trip reproduced the exact same commit hash bit-for-bit.)*

## 3. Recommendation

1. **Primary (updated): Method A — direct fetch of the pinned commit from
   `https://github.com/zelnix/Apollo`**, since it is now confirmed public and already readable
   with no credentials. Checkout must pin the **exact SHA**
   `e5d11be912c76775c5a8b27b53218211484ca8bd` — never the `main` or `m2-native-acceptance` branch
   tip, both of which have moved past it.
2. **Fallback: Method B — single-commit git bundle**, if GitHub access to that repo is ever
   revoked or made private. Still the strongest method if a live repo isn't available: no shared
   repo, no credential, and the commit hash itself is the proof.
3. **Last resort: Method C — archive + manifest.** Only if neither git-native method is usable.

## 4. Provenance verification procedure (must pass before ANY integration, regardless of method)

1. Whichever method is used, the end state in this workspace must be a real git object (a clone,
   a fetched bundle, or an applied patch) whose `git rev-parse` for the imported ref equals
   `e5d11be912c76775c5a8b27b53218211484ca8bd` **exactly**. This is the primary proof.
2. Record the CI run (`35171369548`) and APK SHA-256
   (`905d66a9ab5d9f70c22c4a2fce897cdf668d975908546e583b404db01f774335`) alongside the import as
   the certification pointer *for that commit* — documentation/audit linkage only.
3. **Important nuance, already recorded in `docs/APOLLO_PROTECTION_STAGE0.md` §1.2:** the APK
   SHA-256 is expected to **not** be reproducible once this source is later rebuilt inside Apollo
   main's own app shell/signing identity (`app.hwg.apollo`). That is correct, not a failure —
   the APK hash is never used as a rebuild-equality gate, only as evidence tying the *source
   commit* to a result already certified elsewhere.
4. Generate a file-level SHA-256 manifest of every file under the three approved paths at the
   verified commit, and store it alongside the import. This is a durable, diffable audit record
   protecting against later silent drift of the vendored copy — independent of, and in addition
   to, the git commit-hash proof in step 1.
5. Only after steps 1–4 pass does any file get copied into a landing location in this repo — see
   §5.

## 5. Scope discipline (allow-list / deny-list)

The pinned commit's tree has now been inspected read-only (see §2) — this can be finalized more
precisely than before, but one scope question needs the user's confirmation first:

- **Allow (as originally approved):** `packages/guarddog-android-sdk/**`,
  `packages/guarddog-expo-module/**`, native source under `com/guarddog/*`.
- **Open scope question — not yet approved, needs explicit confirmation:** the pinned commit's
  `packages/` also contains `guarddog-contracts` (likely shared type/interface definitions used
  by both SDKs) and `guarddog-ios-sdk` (the iOS counterpart to the Android SDK). Neither was
  named in the original approved-scope list (§1), even though both look production-relevant on
  inspection. **Do not assume they're included — ask the user explicitly before Stage 1B copies
  anything.**
- **Deny (confirmed real, not hypothetical):** `docs/M1_*.md`, `docs/M2_PHASE6_ACCEPTANCE_TEMPLATE.md`,
  `docs/M2_WEBSITE_GATE_DESIGN.md`, `docs/dns-capability-characterization.md`, and the entire
  `docs/evidence/` tree (test result XML/binary files, manifest audits, resigned-bundle
  verification output) — all confirmed present at the pinned commit and all certification-only.
  None of this is imported.
- Process: even with the tree now visible, nothing is copied without the scope question above
  being answered and a final explicit go-ahead for Stage 1B.
- Landing location (forward-looking only, not executed in Stage 1A): a new, clearly separated
  path (e.g. `packages/` or `vendor/guarddog/`) — never mixed into
  `frontend/modules/apollo-security`, keeping today's Apollo-facing adapter
  (`com.hucentai.apollosecurity`) cleanly separate from the vendored upstream engine, per
  `docs/APOLLO_PROTECTION_STAGE0.md` §2–§3.

## 6. Explicit non-actions in Stage 1A

- No GuardDog code written, recreated, or reconstructed from documentation/description.
- `ApolloDnsVpnService.kt`, `DnsPacket.kt` — untouched.
- Consumer UI — untouched.
- Higgins (`backend/routers/ask.py` and related) — untouched.
- `SecurityPlatformAdapter.ts` and the rest of the frozen contract — untouched.
- Nothing has actually been imported yet. This document plans the *how*; it does not execute it.

## 7. Inputs needed from the user before Stage 1B (execution) can start

1. Which transfer method: **git bundle** (recommended), **pinned-SHA GitHub fetch** (needs repo
   URL + read-only token if private), or **archive + manifest** (fallback)?
2. If bundle/archive: the file itself, produced on the m2 side and attached in chat there (or
   here, whichever project the user is in when exporting it).
3. If GitHub fetch: the exact repo URL/org, and — if private — a minimally-scoped, short-lived,
   read-only token.
4. Confirmation of the final allow-list (§5) once the pinned commit's tree is actually visible
   from this side.

Stopping here per instruction — reporting back for review before any transfer is executed.
