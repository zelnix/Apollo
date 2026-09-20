# Stage 1D candidate record

## Preparation status — 2026-09-20

| Required field | Current value |
|---|---|
| Build profile | `guarddog-acceptance` (internal Android APK, staging, native adapter) |
| Enforcement engine | `guarddog_acceptance` |
| Production engine | `legacy` (unchanged) |
| Frozen GuardDog source | Unchanged against the corrected Stage 1D baseline |
| Acceptance signing key | Present outside the repository/APK with mode `0600`; private material not recorded here |
| Exact build source SHA | **PENDING — record the final saved source commit before starting the build** |
| Android build identifier | **NOT CREATED** |
| APK SHA-256 | **NOT CREATED** |
| Pixel run ID | **NOT RUN** |
| Physical result | **NOT RUN** |

## Verified preparation

- Acceptance-profile security preflight passes with staging + native + `guarddog_acceptance`.
- Resolved Expo configuration identifies the candidate engine and test-only profile.
- Frozen package diff is empty and GuardDog candidate source tests pass.
- Production configuration remains `legacy`; candidate trust is not enabled in production.

## External build input still unavailable

The candidate configuration intentionally remains incomplete until the controlled acceptance endpoint is proven and a host-scoped bundle is signed. `controlledHost`, `controlledIpv4`, `controlledUrl`, `rulesetId`, and `signedBundleB64` are currently empty. The documented AWS endpoint path still returns HTTP 404 and ownership evidence has not been supplied. Do not generate or install an APK from placeholder inputs.

Before installation, record the final source SHA, managed build ID, and APK SHA-256 in this file. During the Pixel run, associate the generated run ID and every result with that exact build.

## Physical truth gate

Physical acceptance remains pending. “Apollo is biting” may be recorded only after the exact candidate observes a packet and intentionally drops it, with matching run/probe/session/evidence provenance. Rule acceptance, VPN activation, browser failure, a mock result, or a configured block is not sufficient.