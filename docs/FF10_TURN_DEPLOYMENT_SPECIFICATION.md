# FF10 TURN Deployment and Activation Specification

## Current authority and activation state

This workspace can implement and validate Apollo application source, but it has no supplied cloud account, DNS control, certificate authority access, public static IP allocation or infrastructure deployment credential. It therefore cannot safely provision an Internet-reachable TURN service from this container. **TURN is the sole external FF10 activation requirement.** Family Help remains fail-closed as `configuration_missing`; all existing Family and Apollo functions remain enabled.

No product owner is being asked to invent or transmit a secret through chat. An authorised infrastructure operator must generate and install the secret directly in the server secret manager.

## Required topology

Deploy a current, security-supported coturn release on Linux with:

- One stable public IPv4 address per node; IPv6 if the application region supports it.
- DNS name, recommended `turn.family.<apollo-production-domain>`, resolving only to TURN nodes.
- `turn:` UDP listener on **3478/udp**.
- `turns:` TLS listener on **5349/tcp**, with a publicly trusted certificate matching the DNS name.
- Relay allocation range **49152-65535/udp** open bidirectionally at host firewall, cloud firewall and NAT.
- 3478/tcp may be exposed for diagnostic/fallback TURN-over-TCP, but FF10 activation specifically requires UDP plus TLS routes.
- No HTTP reverse proxy in front of UDP/TURN. A layer-4 load balancer must preserve UDP flows and source affinity.
- Coturn and the Apollo backend use the same realm and shared authentication secret. Clients never receive the shared secret.

## Baseline coturn configuration

Replace angle-bracket values inside the infrastructure secret/configuration system, not source:

```ini
listening-port=3478
tls-listening-port=5349
listening-ip=<private-or-public-listen-ip>
relay-ip=<relay-interface-ip>
external-ip=<public-ip>[/<private-ip-if-natted>]
realm=turn.family.<apollo-production-domain>
server-name=turn.family.<apollo-production-domain>
fingerprint
use-auth-secret
static-auth-secret=<random-32-byte-or-longer-secret>
stale-nonce=600
cert=/run/secrets/turn-fullchain.pem
pkey=/run/secrets/turn-private-key.pem
no-tlsv1
no-tlsv1_1
no-sslv3
no-cli
no-multicast-peers
no-loopback-peers
min-port=49152
max-port=65535
total-quota=1200
user-quota=8
bps-capacity=0
log-file=stdout
simple-log
```

Use a dedicated 256-bit or stronger random secret, for example generated directly in the secret manager or with `openssl rand -base64 48`. Never put it in Docker arguments, images, repository files, mobile environment variables, CI logs or support/chat messages.

## Apollo backend secret configuration

Set only in the backend runtime secret manager:

```text
FAMILY_ASSIST_ENABLED=true
FAMILY_ASSIST_TURN_URLS=turn:turn.family.<domain>:3478?transport=udp,turns:turn.family.<domain>:5349?transport=tcp
FAMILY_ASSIST_TURN_REALM=turn.family.<domain>
FAMILY_ASSIST_TURN_SHARED_SECRET=<same coturn auth secret>
```

All four values are server-only. The backend validates a UDP route, a TLS route, host syntax, realm and minimum secret strength. Any missing/malformed value produces `configuration_missing`; an explicitly false kill switch produces `policy_rejected`. Only Family Help is disabled.

## Credential protocol

For each authenticated, currently paired device and live session generation, Apollo generates:

- Username: `<unix-expiry>:<24-char SHA-256 session+generation+device+role binding>`
- Password: Base64(`HMAC-SHA1(shared-secret, username)`), coturn REST-auth compatible
- TTL: at most **600 seconds**, never beyond the session hard expiry
- URIs and realm: from server-only validated configuration

The shared secret is never returned. Signaling tickets are random, hashed at rest, single-use, role/device/session/generation-bound and expire within 60 seconds. TURN credentials are sent only inside the authenticated native WSS signaling channel.

## Health, capacity and incident controls

- Probe DNS and TLS certificate/handshake continuously from every production region.
- Perform an authenticated TURN allocation plus relayed connectivity test from outside the TURN network at least every five minutes; a STUN-only success is insufficient.
- Alert on allocation failures, TLS expiry under 30 days, authentication error spikes, relay-port exhaustion, packet loss, CPU, memory and egress saturation.
- Keep packet capture and content logging disabled. Retain only aggregate availability/capacity metrics.
- Rotate the shared secret through a dual-node or controlled maintenance procedure; because coturn has one active REST secret per instance, complete old sessions before removing the old pool.
- If abused or compromised, set `FAMILY_ASSIST_ENABLED=false` first. Existing non-FF10 Apollo functions remain operational.
- Size baseline for pilot: 2 vCPU, 4 GiB RAM, 1 Gbps NIC per node. Actual capacity is bandwidth-bound; load-test at the configured 720p/15fps profile before activation.
- Multi-node pools must use the same realm/secret during a deployment generation and session-affine layer-4 routing or DNS selection.

## Operator preflight

1. Install server secrets and restart only the backend runtime.
2. Run from the backend root:
   `python scripts/family_assist_turn_preflight.py`
3. Require `FF10_TURN_PREFLIGHT=pass`; output never includes credentials.
4. Confirm `/api/family/assist/capabilities` reports `enabled: true` for an authenticated device.
5. From external mobile networks, run authenticated device tests that force relay (`iceTransportPolicy=relay` in the operator test build) over:
   - TURN/UDP 3478
   - TURNS/TCP 5349
   - IPv4 and IPv6 where advertised
6. Confirm two paired physical devices can establish a view-only session, pause to a neutral helper view, resume, stop locally, expire, revoke pairing and recover from network loss.
7. Confirm no microphone/system audio track, data channel, recording artifact, SDP/ICE log or reusable credential exists.
8. Record TURN node/version, region, certificate expiry, test timestamp and artifact/device IDs in the external acceptance packet.

Real-device relay connectivity is **not claimed** until steps 5-8 are completed by the infrastructure/build operator.