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

| Method | Mechanically available here? | Notes |
|---|---|---|
| **A. Live fetch from GitHub** (clone/fetch a pinned commit after m2's Save to GitHub) | **Yes, network-wise** — verified: outbound HTTPS to `github.com` returns 200, and `git ls-remote`/clone of a public repo succeeds from this sandbox right now. | Blocked on two unknowns only I can't resolve myself: (1) the actual repo URL/org that m2's Save to GitHub pushes to, (2) if that repo is private, a credential to read it. Neither is guessable — needs the user. |
| **B. Git bundle of the single pinned commit**, exported from m2 and attached in chat | **Yes** — verified locally in this session: `git bundle create` → `git clone` from the bundle reproduces the **exact same commit hash** (tested with a throwaway repo, hash matched bit-for-bit). Bundles are received here via the existing `get_assets_tool` (already confirmed working — retrieved 14 unrelated pre-existing attachments this session; no GuardDog-related file has been attached yet). | Needs no shared repo, no token, no live network dependency at fetch time, and — because a bundle can be scoped to one ref — cannot accidentally carry in anything the m2 developer didn't explicitly include. |
| **C. Plain exported archive** (zip/tar of just the approved paths) + a manifest | **Yes**, same attachment path as B. | Weakest of the three: loses git's native content-addressing, so integrity rests entirely on a manifest (e.g. a SHA-256 per file) that the m2 side must generate and that this side must trust was made honestly from the pinned commit — there is no independent, automatic check equivalent to a commit hash. |
| **D. Any other mechanically verifiable method** | **None found.** Fork Chat (checked with platform support) is same-project only and doesn't bridge isolated projects. No other cross-project primitive exists today. |

## 3. Recommendation

1. **Primary: Method B — single-commit git bundle.** Strongest available integrity guarantee
   with the fewest moving parts: no shared repo, no credential to mint/rotate/leak, and the
   commit hash itself (a Merkle hash over the whole tree + history) is the proof — nothing extra
   needs to be computed or trusted separately.
2. **Secondary: Method A — pinned-SHA GitHub fetch**, only if bundling isn't convenient on the
   m2 side. Requires the user to supply the repo URL and, if private, a **minimally-scoped,
   read-only, single-repo, short-lived** personal access token — treated as a secret for the
   duration of the one-time fetch only, then rotated/revoked, never hardcoded into this repo.
   Must fetch/checkout the **exact pinned SHA**, never a branch tip, to avoid silently pulling in
   anything committed after the freeze point.
3. **Fallback only: Method C — archive + manifest.** Acceptable only if neither git-native method
   is practical, and only with the manifest cross-referenced against something independently
   attributable to CI run `35171369548` (its own build log listing the files it built), not just
   asserted.

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

The exact tree under the pinned commit has not been seen from this workspace yet, so this list
cannot be finalized blind — it is confirmed once §4 succeeds, before any copy happens:

- **Allow:** `packages/guarddog-android-sdk/**`, `packages/guarddog-expo-module/**`, native
  source rooted under `com/guarddog/` (or platform-equivalent) that is production code.
- **Deny (explicit):** anything under a test/acceptance/certification directory, CI workflow
  config (e.g. `.github/workflows`), m2's own physical-device-acceptance docs/fixtures, any
  m2-only tooling/scripts, anything outside the three approved paths above.
- Process: after §4 passes, a manual, human-reviewed listing of what the pinned commit actually
  contains under the allowed roots happens first — this is never a blind whole-repo copy.
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
