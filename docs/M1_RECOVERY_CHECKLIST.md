# M1 Recovery Checklist (AC-06) — approved acceptance criterion

Recovery is part of the physical-device proof. It is executed automatically by the RN harness ("Run proof")
right after the block proof, and by `AndroidBlockingProofE2ETest` step 6. Nothing in this chain is simulated:
every value comes from the native runtime (`RecoveryInspector`), the OS (`ConnectivityManager`) or a real HTTPS response.

| # | Step | Evidence source | Pass criterion |
|---|---|---|---|
| 1 | Guard Dog active, controlled endpoint blocked | block proof (AC-05) | `THREAT_BLOCKED` with `enforcementEvidenceId`, request to `https://blocktest.btciq.app/` fails |
| 2 | `stopProtection()` | public SDK surface → `ACTION_STOP` → service `cleanup()` | promise resolves; lifecycle polled until it leaves `ACTIVE` |
| 3 | TUN descriptor closed | `GuardDogVpnRuntime.activeSession == null` / `TunSession.closed == true`; drop reporter detached | `tunOpen=false`, `dropReporterAttached=false` |
| 4 | State `INACTIVE` / `STOPPED` | `VpnStateRepository` (sole writer: the service) | `getProtectionState().state ∈ {INACTIVE, STOPPED}` |
| 5 | No Guard Dog selective VPN route active | lifecycle not `Running` **and** OS reports no `TRANSPORT_VPN` network | `selectiveRouteActive=false`, `vpnTransportPresent=false` |
| 6 | Same endpoint reachable again | real `GET https://blocktest.btciq.app/` from the device (DNS + TCP + TLS + HTTP) | HTTP status **exactly 200** (redirects not followed); retried up to 20 s while routing settles |
| 7 | No fake events | SDK event stream | stopping produces no `THREAT_BLOCKED`; blocked-event count unchanged |

Harness step ids: `stop`, `tun-closed`, `route-cleared`, `recovered`. `HarnessResult.recoveryComplete` is true only when the
block proof **and** all four recovery steps are `PASS`. The exported JSON/PDF report carries the `auditChain.recovery` block
(`stopRequestedAt`, `stateAfterStop`, `tunOpen`, `selectiveRouteActive`, `vpnTransportPresent`, `httpsStatusAfterStop`, `recoveredAt`).

Revocation path (also covered by `TunSessionRecoveryTest`): system/user revoke → `onRevoke()` → cleanup → `REVOKED`, consent cleared.

Unit coverage (Kotlin, runs in `scripts/ci/android-native-gate.sh`): `TunSessionRecoveryTest`
(`stopClosesDescriptorOnceAndStopsReader`, `lifecycleReportsInactiveAfterStopAndRevocation`,
`recoverySnapshotIsCleanOnlyAfterSessionClosedAndStateLeftRunning`).

Status: tooling complete; **OPEN** until executed on a physical Android device with a development build.
