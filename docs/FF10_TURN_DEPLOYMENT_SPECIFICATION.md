# FF10 Cloudflare TURN Activation Specification

## Current state

FF10 now supports **Cloudflare Realtime TURN only**. Generic coturn realm/shared-secret credentials are not read and cannot be used as a fallback. Family Help remains fail-closed as `configuration_missing` until the server secret manager contains the associated Cloudflare TURN API token. Existing Apollo and Family functions remain available.

The TURN Key ID and token are server configuration. Neither value belongs in Git, mobile configuration, Android/iOS source, logs, analytics, MongoDB or API responses. The token must be entered directly by an authorised infrastructure operator; it must never be pasted into chat.

## Server-only configuration

The backend runtime secret/configuration store requires:

```text
FAMILY_ASSIST_ENABLED=true
FAMILY_ASSIST_TURN_PROVIDER=cloudflare
CLOUDFLARE_TURN_KEY_ID=<32-character Cloudflare TURN Key ID>
CLOUDFLARE_TURN_API_TOKEN=<associated account API token; secret manager only>
FAMILY_ASSIST_RELAY_TTL_SECONDS=3600
```

The API token should be restricted to the relevant Cloudflare account with **Calls Write** permission only. Do not use a Global API Key.

When `provider=cloudflare`, `FAMILY_ASSIST_TURN_URLS`, `FAMILY_ASSIST_TURN_REALM` and `FAMILY_ASSIST_TURN_SHARED_SECRET` are ignored even if present.

## Credential request

Apollo's backend calls only:

```http
POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers
Authorization: Bearer {TURN_API_TOKEN}
Content-Type: application/json

{"ttl":3600}
```

Expected success is HTTP 201 with `iceServers`. Apollo strictly permits only:

- `stun:stun.cloudflare.com:*`
- `turn:turn.cloudflare.com:*`
- `turns:turn.cloudflare.com:*`
- Fields `urls`, `username`, and `credential` only
- No embedded URL credentials and no port 53
- At least one authenticated TURN entry

Unexpected fields, hosts, schemes, credentials, malformed JSON, missing TURN routes, authentication rejection, timeout or provider error fail closed. Apollo never falls back to generic coturn credentials.

## Session binding and retention

- Issuance happens only after device authentication, current Family pairing, session role and generation checks.
- The mobile app receives only validated temporary `iceServers`, `provider=cloudflare`, TTL and expiry.
- Apollo stores only session ID, generation, device ID, role, issue/expiry timestamps and a SHA-256 digest of the temporary username.
- API token, Key ID, temporary credential, username and raw ICE configuration are not persisted.
- HTTP credential responses use `Cache-Control: no-store`.
- Credential lifetime is initially 3,600 seconds and cannot outlive the FF10 hard session expiry.

## Refresh and ICE restart

The Android/iOS WebRTC peers schedule refresh before expiry entirely inside native code:

1. Helper requests fresh credentials approximately six minutes before expiry and applies `setConfiguration`.
2. Sharer requests fresh credentials approximately five minutes before expiry.
3. Sharer applies `setConfiguration`, calls `restartIce`, creates an ICE-restart offer and sends SDP/ICE only through the existing native WSS transport.
4. Backend rate-limits refresh to one request per role every five minutes.
5. React Native JavaScript never receives TURN credentials, SDP or ICE candidates.

Cloudflare authentication errors stop immediately. Rate limits and transient network/5xx failures use bounded retries; failure remains scoped to Family Help.

## Activation preflight

After the API token is installed directly in backend secrets:

```bash
cd backend
PYTHONPATH=. python scripts/family_assist_turn_preflight.py
```

Required result:

```text
FF10_TURN_PREFLIGHT=pass provider=cloudflare ... ttl=3600 credentials=redacted
```

The preflight makes one real Cloudflare credential request, validates every returned ICE server, and prints no secret or temporary credential. Missing token exits 2 as `configuration_missing`; provider/network/schema failure exits 3.

## External real-device acceptance

After preflight passes, an operator must validate on two paired physical devices:

1. Force relay with `iceTransportPolicy: "relay"` in the operator test build.
2. Verify TURN/UDP and TURN/TCP/TLS across separate mobile/Wi-Fi networks.
3. Keep one session connected beyond the refresh boundary and confirm `setConfiguration` plus ICE restart preserves the session.
4. Interrupt network transport and confirm bounded recovery or honest session failure.
5. Confirm pairing revocation, Stop, expiry and app/OS termination close native capture and signaling.
6. Confirm no microphone/system-audio track, data channel, recording, provider token, Key ID, SDP or ICE appears in the mobile bridge, logs, analytics or durable storage.

Real-device Cloudflare relay connectivity is not claimed until this acceptance is completed.