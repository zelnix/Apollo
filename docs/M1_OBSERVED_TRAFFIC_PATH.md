# M1 — Observed traffic path, scope limits, and what leaves the device

## Exactly what Part 4.1 observes and prevents

```
app socket -> kernel routing -> route 203.0.113.10/32 (dedicated controlled IPv4 only)
  -> TUN (GuardDogVpnService, ParcelFileDescriptor)
  -> TunPacketReader.read()            [packet OBSERVED]
  -> Ipv4PacketParser (dst, proto, ports)
  -> PacketDropReporter: dst == authorized IPv4 ?
       yes -> packet not written anywhere [packet DROPPED] -> BlockedFlowDeduper -> BlockedThreatEvidence(enforcementEvidenceId)
              -> GuardDogSDKEngine.reportBlockedPacket (gated: state ACTIVE, dst == rule-authorized IPv4)
              -> SecurityEvent THREAT_BLOCKED -> GuardDogExpoAdapters.toRecord (gate) -> RN validateSecurityEvent (gate) -> harness
       no  -> discarded + counted as unexpectedPackets (no event; nothing is forwarded in M1)
```

Rule authority chain that must complete *before* the route exists:
`signed bundle → strict schema → payloadHash → keyId → Ed25519 → issued/expiry → rollback → exact canonical host match → action=block → DNS/IP binding == configured dedicated IPv4 → /32 route`.

## What M1 does NOT prove (do not overclaim)
- universal Android traffic inspection (only one `/32` is routed)
- hostname visibility (we know the host only because the rule + verified resolution bound it to the IP)
- DNS interception (no DNS servers are set on the TUN; resolution stays on the normal path)
- DoH/DoT, QUIC/HTTP3 coverage (any protocol to the controlled IP is dropped; nothing is inspected)
- per-app traffic attribution
- universal device protection; iOS enforcement (iOS is analysis + warning only)

## Truthfulness gates (three independent refusals)
1. Core: `GuardDogSDKEngine.reportBlockedPacket` is the only `THREAT_BLOCKED` producer; needs `BlockedThreatEvidence`, `ACTIVE`, authorized IPv4.
2. Bridge: `GuardDogExpoAdapters.toRecord` returns null for a `THREAT_BLOCKED` without evidence/source/IP/rule. iOS adapter always refuses it.
3. App: `validateSecurityEvent` rejects the same, and the harness cannot construct events.

Rule match, analysis verdict, hostname resolution, VPN start, failed HTTP request, placeholder endpoint or any test helper produce at most `THREAT_DETECTED` / `PROTECTION_STATE_CHANGED`.

## Privacy — what leaves the device
| Data | Leaves device? | Where |
|---|---|---|
| Raw browsing URL (query, fragment, userinfo, port) | **No** | analyzed locally only |
| `sanitizedUrl` = `scheme://canonicalHost/path` | Only when local rules + cache are unresolved | `POST /api/intelligence/lookup` → provider (`uri` param) |
| Threat Scent records, browsing history, security-event history | **No** | local-only; backend has no endpoint or collection for them |
| Rule bundles, key metadata | Downloaded (public, signed) | `GET /api/rules/...`, `GET /api/keys` |

Backend never logs URLs (`RawUrlRedactionFilter` on app + uvicorn loggers; lookups log only a hashed key prefix), never stores them (`provider_cache` keyed by `sha256(sanitizedUrl)`), and the lookup body is the only ingress.

## Failure behavior
Provider unavailable/unconfigured → verdict `unknown`/`unavailable`, `degraded: true`; local signed rules stay active until expiry; cached verdicts continue by TTL; unresolved traffic is never auto-classified malicious; Android fails open for everything outside the routed `/32`.

## Environment note
Kotlin/Swift sources and tests in this repository are code-review ready but were not compiled or executed here (no Android/iOS toolchain). Python (74 tests) and TypeScript (14 tests) suites run and pass; cross-language fixtures were generated here. Operational acceptance (AC-01…AC-05 in `docs/M1_TASK_BOARD.md`) remains open until the native build and physical-device run.
