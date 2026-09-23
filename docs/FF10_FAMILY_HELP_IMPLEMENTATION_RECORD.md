# FF10 Family Help — Configuration-Gated Implementation Record

Generated: 2026-09-23

## Outcome

**`configuration_gated_source_complete`**

Apollo now contains the full owner/helper session coordinator, closed signaling relay, short-lived TURN REST credentials, view-only native Android/iOS capture paths, helper renderer, user flows, kill switch, invitation outbox, revocation hooks and privacy-preserving terminal projection. Family Help currently reports **`configuration_missing`** and cannot create sessions because no external TURN service is configured. All existing Family functions remain enabled.

The sole FF10 activation dependency is the operator-managed TURN service defined in [`FF10_TURN_DEPLOYMENT_SPECIFICATION.md`](./FF10_TURN_DEPLOYMENT_SPECIFICATION.md).

## Source inventory

| Layer | Main source | Result |
|---|---|---|
| Contracts/state | `backend/models/family_assist.py`, `services/family_assist/sessions.py` | Authoritative revision/generation-fenced state machine, one live sharer session, idempotent create/respond/end, bounded invitations/consent/active duration/extensions |
| Authority | `authorization.py`, device-auth middleware | Device identity comes from authenticated context; every operation rechecks active pairing generation and role |
| Signaling | `signaling.py`, `/api/family/assist/.../signal` | Single-use hashed tickets; max two role-bound sockets; closed message schema; size/rate/sequence/candidate bounds; no persistence/logging |
| Relay | `config.py`, `relay_credentials.py` | Server-only strict TURN configuration; session+generation+device+role-bound HMAC credentials, max 10-minute TTL |
| Side effects | `outbox.py`, server maintenance | Durable idempotent invitation effect; provider submission never means helper acceptance |
| Revocation | `routers/family.py`, `routers/devices.py` | Pair unlink and device revocation terminate matching live sessions immediately |
| Android native | `modules/apollo-family-assist/android` | MediaProjection consent, foreground media-projection service, native WebRTC track, persistent notification controls, native renderer, no audio/data channel |
| iOS native | `modules/apollo-family-assist/ios` | ReplayKit Broadcast Upload extension, one-time protected App Group handoff, native WebRTC source/viewer, 15fps adaptation, video-only sample admission |
| Expo generation | `withApolloFamilyAssist.js`, `app.json` | Idempotent Broadcast target, bundle/App Group/Pod integration, host dependency/embed, iOS 16.4, Android media-projection permission |
| Mobile UX | `app/family/help/*`, `src/family-help/*` | Overview, helper/scope selection, wait, accept/decline, native consent handoff, owner controls, helper view, paused neutral surface and exact fail-closed copy |
| Durable summary | `projector.py` | Minimal terminal metadata only; no SDP, ICE, credentials, frames, audio, screenshots, recording or content |

## API surface

- `GET /api/family/assist/capabilities`
- `GET /api/family/assist/invitations`
- `POST /api/family/assist/sessions`
- `GET /api/family/assist/sessions/{sessionId}`
- `POST /api/family/assist/sessions/{sessionId}/respond`
- `POST /api/family/assist/sessions/{sessionId}/signaling-ticket`
- `POST /api/family/assist/sessions/{sessionId}/relay-credentials` (native-authorised compatibility route)
- `POST /api/family/assist/sessions/{sessionId}/pause|resume|extend|native-state`
- `DELETE /api/family/assist/sessions/{sessionId}`
- `WSS /api/family/assist/sessions/{sessionId}/signal?ticket=<single-use>`

## Privacy/security invariants

- View-only: microphone, system audio, recording and remote control are not implemented or requested.
- Raw frames remain in ReplayKit/MediaProjection/WebRTC native pipelines; no media crosses the React Native bridge.
- SDP/ICE remain bounded WSS memory only and are never persisted or logged.
- Static TURN credentials never enter source, mobile config or responses.
- Backend returns only ephemeral role/device/session-bound credentials after authentication and pairing checks.
- Android foreground notification and iOS system broadcast affordance expose sharing state; local Stop precedes server reconciliation.
- Pause disables the owner video track and helper UI replaces video with a neutral paused surface.

## Verification

| Gate | Result |
|---|---|
| FF10 backend unit/contract tests | 9 passed |
| Frontend Node contract regression | passed |
| TypeScript | passed |
| JavaScript/Python lint | passed |
| Android `:apollo-family-assist:compileDebugKotlin` | passed (68 tasks) |
| Native singleton dependency guard | passed, 53 names |
| Security preflight | passed |
| Package 6 preflight | passed, five iOS extensions |
| iOS clean + repeated prebuild | passed; six products, five host dependencies, one JitsiWebRTC Broadcast Pod target |
| Frozen GuardDog hashes | 91/91 passed |
| Missing-config HTTP capability | passed; exact `configuration_missing` response and user copy |
| Missing-config operator preflight | expected fail-closed exit 2 |
| Full backend repository pytest | 364 passed, 23 unrelated legacy/environment-dependent failures (email transport, voice/provider fixtures and older investigation contract expectations); no FF10 test failed |
| Apple Xcode/Swift compile | `not_run_external_toolchain` |
| Real-device TURN relay | `not_run_external_dependency` |

No Playwright, scenario automation, testing agent, live Gemini call or Emergent-managed LLM key was used.