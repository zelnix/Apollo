# Apollo — source and product review
20 September 2026 · Reviewed main at `da60c0372650dead26caeb25c458f8ca7cebd6a2`

**Assessment:** Apollo has substantial consumer functionality and a disciplined native-engine transfer process. The strongest foundations are provenance, the separation between requested and operational protection, deterministic analysis, and explicit device authentication. The highest-value next work is to repair the connections between those parts: live status, evidence delivery, privacy, and the advice users actually see.

This is a targeted source review with isolated local checks, not physical-device acceptance, a deployed-service penetration test, or a complete accessibility audit. No production source, configuration, dependencies, or frozen GuardDog files were changed. No external targets were probed. Stage 1D remains paused until the freshly rebuilt APK passes the Pixel 10 launch smoke test.

**Objectives used:** honest, evidence-backed protection; “Apollo acts. Higgins interprets”; calm, plain-English guidance for vulnerable and less technical users; privacy minimisation; free protection supported voluntarily. Earlier privacy decisions were considered alongside the current implementation: where they differ, this report identifies the conflict rather than assuming that later code silently replaced the policy.

**Priority and severity:** P0 = recommended blocker before an external pilot or release of the affected feature. P1 = address before public V1. P2 = subsequent refinement. These are review recommendations, not new stage numbers or permission to start Stage 1D. High severity means a material security, privacy, or false-assurance risk. Medium means a meaningful reliability or usability weakness. Rankings reflect importance to Apollo’s mission, not a CVSS score.

| Rank | Finding | Severity | Priority | Evidence |
|---|---|---|---|---|
| 1 | Backend outbound requests lack consistent internal-address protection | High | P0 | Source + offline redirect simulation |
| 2 | Live protection state and recovery can become misleading | High | P0 | Source + two direct state probes |
| 3 | Call rejection can produce the packet-block-only biting state | High | P0 | Native → UI → backend source trace |
| 4 | Privacy disclosure conflicts with real data flows | High | P0 | UI, outbound policy, and server source |
| 5 | Block evidence cannot pass the Patrol upload policy | High | P0 | Direct egress-policy reproduction |
| 6 | Unread or lightly inspected files can receive “Fine to open” | High | P0 | Direct file-analysis reproduction |
| 7 | Higgins-generated advice can replace deterministic safety advice | High | P1 | Source; contradictory model output not exercised |
| 8 | Remembered trust suppresses fresh uncertainty or network warnings | Medium | P1 | Two direct decision probes |
| 9 | Clear/delete behavior does not provide durable deletion in all cases | Medium | P1 | Source; offline recovery not device-tested |
| 10 | User-facing state names and guidance paths have drifted | Medium | P1 | Source comparison |

**What is already worth preserving**

- The SVG incident has a documented cause and fix, and the new guard checks the installed tree, including separate copies of the same version.
- Hosted dependency CI passed on the reviewed commit, including installation, dependency audit, regression tests, combined preflight, and the frozen GuardDog manifest check. [CI run](https://github.com/zelnix/Apollo/actions/runs/35479313463).
- The app distinguishes requested protection from operational protection. Manual block requests are explicitly prevented from claiming a verified packet block.
- The backend issues device credentials and checks supplied device IDs against the authenticated identity. Admin authentication is separated from device authentication.
- Higgins is intended to explain, not operate the enforcement engine.
- The certified engine is present, but production selection still uses the legacy Apollo native adapter. The future GuardDog adapter remains a type-only placeholder. That is consistent with the paused integration stage; it is not evidence of a failed source transfer. [Adapter selector](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/security/securityAdapter.ts); [future adapter](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/security/future/GuardDogSecurityAdapter.ts).

**1. Unify outbound-request protection**

The link redirect expander calls `http.head(cur)`, sometimes falling back to `http.get(cur)`, without rejecting internal, loopback, or link-local destinations before each connection. It also follows a redirect to such a destination. An offline test of the exact function, using a fake HTTP transport, showed it attempting a public example URL followed by `127.0.0.1`. No real network requests were made.

The separate page crawler contains public-address checks but explicitly leaves a second-DNS-resolution window. IMAP accepts a user-supplied host and any port from 1–65535, then opens a backend connection; its input validation does not restrict private destinations. Exploitability depends on deployed network access and feature configuration, which were not tested.

**Change:** use one hardened outbound-connection policy across link expansion, page reads, and mail connections. Reject nonpublic addresses, check every redirect, bind the actual connection to the validated address, and apply strict time/byte/concurrency limits. IMAP needs its own approved-host/port policy or equivalent hardened connection layer. The GET fallback should not download unlimited bodies.

**Acceptance:** local fake-transport tests for initial private destinations, public-to-private redirects, address changes between validation and connection, IPv4/IPv6 variants, excessive response size, and timeouts. Verify deployed egress restrictions separately.

Sources: [redirect expansion](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/backend/services/intel.py#L118-L142); [page crawler](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/backend/services/webcrawl.py); [IMAP input](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/backend/routers/imapmail.py); [IMAP connection](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/backend/services/imapmail.py).

**2. Make live health, historical events, and recovery independent**

Three distinct source-level defects affect the same user promise:

- After the two-minute recovery cooldown, a verification from before an event was resolved can still satisfy the ten-minute freshness rule. The local probe used a check five minutes ago and an event resolved three minutes ago; the resolver returned `resting`.
- A historical unresolved verified block is selected before visibility is checked. A second probe supplied an hour-old block, no current visibility, and stale verification. The resolver returned `biting` with `visibilityLost: false`.
- A periodic timer increments `tick`, but the memoized state resolution does not depend on `tick`. Time alone therefore does not trigger freshness recalculation. Native protection refresh is not called by that timer; the shown foreground listener only reprobes an unreachable backend. `verifyNow` also records the refresh time rather than requiring a successful native protection verification.

**Change:** keep three separate facts: current protection health, recent observed enforcement, and unresolved user action. A prior block must not conceal present loss of protection. Require a qualifying observation after resolution, regardless of cooldown expiry. Recalculate expiry with a clock dependency and refresh native health on appropriate lifecycle signals. Preserve an honest unknown/unavailable state on probe failure; do not continuously generate threat traffic.

**Acceptance:** fake-clock tests for expiry without other state changes; recovery with only pre-resolution checks; old block plus revoked permission; foreground return after service loss; failed native probe. Then physical tests in the authorized runtime stage.

Sources: [state resolver](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/stateMachine.ts#L36-L97); [refresh and verification](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L185-L293); [timer](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L340-L365); [memo dependencies](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L754-L756).

**3. Preserve the strict packet-only biting rule across Call Guard**

Android Call Guard creates `verifiedCallBlock` evidence after submitting a call rejection. `syncEnforcementEvidence` accepts `call_screening` evidence and upgrades it to `state: "biting"`; the backend evidence schema/gate accepts that mechanism too.

A call rejection is not an observed packet intentionally dropped. Even a correctly rejected call does not satisfy the current non-negotiable biting rule. The code also describes the call as OS-confirmed after the rejection API call; this review did not establish a separate completion receipt.

**Change:** give call screening a distinct event/result and appropriately qualified wording. Keep `THREAT_BLOCKED` / biting reserved for the certified packet-enforcement path. Preserve the frozen engine and the strength of the backend invariant; treat any cross-platform contract adjustment as a separate reviewed change.

**Acceptance:** feed call-screening and manual-block evidence through the full consumer pipeline and prove neither creates biting. Positive packet-enforcement evidence must still produce biting through the real native path.

Sources: [native call rejection](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloCallScreeningService.kt#L99-L117); [consumer conversion](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L226-L265); [verification predicate](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/security/PlatformCapabilityProfile.ts); [backend gate](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/backend/routers/patrol.py#L20-L42).

**4. Reconcile privacy promises with actual processing**

The main privacy disclosure says messages, emails, and photos never leave the device. It says the listed flows are exhaustive. Actual implementation permits raw message text, screenshots, IMAP credentials, and other additional fields. Message text and images are sent to backend AI analysis; inbox connectors fetch mail server-side.

This is not just stale introductory wording. Android notification polling calls `checkMessage`, which sends text with `second_opinion: true`; this can happen automatically after notification access is enabled. Some manual screens do disclose sharing, but that does not make the global “never leaves” claim accurate or establish a separate cloud-processing choice for automatic capture.

The egress allow-list checks top-level keys, not whether strings or nested objects contain sensitive content. Removing `local_indicator` alone does not redact phone numbers embedded in event headlines or explanations. The pending evidence-upload repair must not simply allow all nested evidence fields: call numbers currently occupy `destination_domain`.

**Change:** first enforce the established local-first/raw-content restriction. Disable or keep local any conflicting automatic cloud path. If optional cloud analysis is a deliberate later product decision, it needs an explicit policy decision and a separate, clear choice before upload, plus consistent disclosure of recipients, retention, credentials, and revocation. Generate screen summaries from one maintained data-flow inventory. Avoid raw secrets or sensitive URL query data in minimal indicators.

**Acceptance:** intercept outbound payloads for manual checks, shared screenshots, automatic notification capture, call events, inbox scans, voice, and family sharing. Confirm no raw personal content leaves under the local-only choice and that cancellation sends nothing. This is an engineering finding, not a legal-compliance certification.

Sources: [privacy disclosure](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/app/privacy-disclosure.tsx#L18-L25); [egress policy](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/privacy.ts); [message submission and automatic polling](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L436-L504); [AI analysis](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/backend/routers/analysis.py).

**5. Repair evidence upload with an explicit privacy-safe contract**

The consumer adds `enforcement_evidence` to Patrol events, and the backend requires it to validate biting. However, `ALLOWED_KEYS.patrol_sync` does not include that field. Calling the real egress function with a block event throws: “Privacy policy blocked field enforcement_evidence … (patrol_sync).”

`syncEvent` catches every failure as though offline. Consequently an affected event can appear locally but never reach server Patrol, guardian notification, or the owner-push route. Evidence IDs are recorded as seen before successful server delivery, and no durable event-upload outbox is evident in the reviewed path. This does not stop native enforcement itself; it breaks reporting and support.

**Change:** define and validate a narrow, privacy-reviewed evidence payload; carry it consistently through API validation; distinguish policy/schema errors from temporary transport failures; persist pending delivery with idempotent retry. Do not loosen “verified” into a client assertion just to make uploads succeed.

**Acceptance:** test native evidence → mapper → egress → authenticated API → persisted Patrol → eligible notification, including offline retry and duplicate replay. The existing four mapper tests pass but never cross the egress boundary.

Sources: [egress keys](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/privacy.ts#L17-L22); [API upload boundary](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/api/client.ts); [sync error handling](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L410-L414); [mapper tests](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/tests/enforcementEvidenceSync.test.ts).

**6. Remove unsupported file-safety reassurance**

The analyzer can infer PDF type from the filename when no bytes were read. Passing an unread `invoice.pdf` from email returned `resting`, “Real type matches its name,” “No executable content, macros or links detected,” and “Fine to open.”

The UI explicitly falls back to name/MIME after a read failure. Even successful inspection uses signatures and a plain-text sample rather than comprehensive parsing or malware analysis. It first loads the entire file into memory before slicing, so the stated small-sample behavior does not bound the initial read.

**Change:** unread files must say “I couldn't inspect this file.” Successful heuristic checks should describe exactly what was checked without authorizing opening or claiming absent content that was not parsed. Use bounded reads and a size policy.

**Acceptance:** unreadable files, missing bytes, renamed archives, compressed Office documents, links outside the sample, malformed files, and very large inputs. A failed read must never produce a safe-style verdict.

Sources: [file input and fallback](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/app/file.tsx#L65-L76); [file analyzer](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/fileAnalysis.ts#L55-L89).

**7. Keep Higgins' next action grounded in deterministic findings**

The backend prompt says the rule engine is authoritative, which is good. But `checkMessage` writes AI-generated `summary` and `recommendation` directly into the persistent event whenever present. Runtime validation checks their shape, not agreement with the rule decision. The model cannot change the stored state here, but it can change the instruction a vulnerable user follows. A contradictory model response was not generated during this review.

Separately, narration says a verified block is contained and “Nothing further is needed” without checking whether credentials or money were already exposed.

**Change:** keep the deterministic safety action visible and authoritative. Use Higgins for explanation around that action; reject or omit contradictory advice. Limit reassurance to the evidenced action and offer one relevant exposure question when prior harm is possible. Bind any future live-status explanation to structured fresh diagnostics rather than user-supplied prose.

**Acceptance:** stub AI responses that conflict with a barking decision; verify the safe action remains. Test blocked destination plus prior credential disclosure; the narration must not claim the whole incident is contained.

Sources: [message event construction](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L438-L465); [Higgins prompt](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/backend/routers/ask.py); [narration](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/higginsNarration.ts#L12-L27).

**8. Make trust a preference, not evidence of safety**

A trusted exact link with unavailable intelligence produces resting and “You can open it.” Confirmed malicious intelligence still overrides trust correctly, but unavailable intelligence cannot establish current safety.

Trusted Wi-Fi names are returned early before captive-portal or weak-security checks. A local probe with a trusted SSID, an open network, and a newly reported captive portal produced no warning. A network name alone is not a reliable security identity.

**Change:** preserve “You previously trusted this” while showing current verification limits. Never suppress newly observed security changes merely because the name is familiar. Scope any dismissal to the exact condition and require reassessment when evidence changes.

**Acceptance:** offline trusted link, newly malicious trusted link, familiar SSID with new weak security, and familiar SSID with new captive portal.

Sources: [link trust](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/decision.ts#L83-L100); [network trust](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/connection.ts#L17-L30); [trust-network action](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L276-L282).

**9. Make deletion and revocation durable and accurately described**

Server Patrol deletion marks records with `deleted_at`; it does not erase the stored payload. The settings sheet says this more accurately than the broad privacy page. No Patrol purge schedule is visible in the reviewed server startup/routes.

Offline clear/revoke catches and ignores failure, then reports success. The later merge adds server entries missing locally, so still-present remote data can return after refetch/relaunch. Revoking a device token is not a delete-all-data operation.

**Change:** distinguish local hiding, pending remote deletion, and completed erasure. Retain deletion/revocation tombstones until acknowledged so merging cannot resurrect entries. Set a documented retention/purge policy and a user-accessible delete-all workflow covering connections, tokens, history, and relevant family data.

**Acceptance:** clear/revoke offline → restart → reconnect → fetch; data must not reappear. Verify actual removal after the retention window and clear exceptions, including backups, without claiming immediate erasure unless implemented.

Sources: [server deletion](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/backend/routers/patrol.py#L114-L117); [remote merge](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L394-L408); [clear/revoke](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/store/ApolloContext.tsx#L742-L752); [server lifecycle](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/backend/server.py).

**10. Reconcile names and navigation with the approved product model**

The shared types currently label internal `biting` as “Guarding,” while the protection card also uses “Apollo is guarding” for an operational filter. A verified past block and current protection therefore share similar language. The same types present resting as patrolling and add ears-up as another persistent status.

Higgins' instructions say “Home → Check my device,” but the current screen places this behind “All checks.” Several quick-check labels are small, constrained to one line, and some secondary controls have a 32-pixel minimum height.

**Change:** maintain one approved vocabulary across Home, Guard, Higgins, Patrol, notifications, and reports. Keep rest → growl → bark → bite meaning intact and distinguish “protection active” from “a threat was blocked.” Update guidance from the actual route/action definitions. Verify large text, TalkBack, contrast, touch targets, and reduced motion on the Pixel 10; this review did not render the current native UI.

Sources: [state wording](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/types.ts#L1-L30); [protection wording](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/protectionTruth.ts); [guidance locations](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/src/domain/higginsChecks.ts); [Home](https://github.com/zelnix/Apollo/blob/da60c0372650dead26caeb25c458f8ca7cebd6a2/frontend/app/%28tabs%29/home.tsx).

**Recommended product improvements after the safety work**

1. **P1: publish a narrow V1 capability promise.** Separate automatic protection, manual checks, unavailable coverage, and unverified coverage. Explain encrypted-DNS coverage honestly using the characterization evidence when reviewed; do not equate a running VPN with universal protection. Finish the Android integration already underway before widening the platform promise.
2. **P1: protect the free service from runaway cost and abuse.** Keep local checks useful when cloud services are unavailable. Define request, concurrency, upload, and spending budgets for AI, voice, scans, and public registration. No general application-level limiter was visible in the reviewed routes; gateway controls may exist and were not inspected. Limits should preserve useful protection rather than create paid safety tiers.
3. **P2: simplify the default experience.** Lead with one plain-English status, one reason, and one action when needed. Keep less-used checks and technical detail behind clear secondary actions. Retain read-aloud and family support.
4. **P2: add restrained voluntary support.** A Settings/About entry such as “Support Apollo” can implement donation or patronage funding without interrupting warnings, recovery, or core protection. Payment-provider and store-policy choices need a separate current review before implementation.

**Focused verification performed**

- Existing evidence-mapping tests: 4/4 passed.
- Seven isolated behavior probes: evidence egress rejection; pre-resolution-check recovery; historical block hiding lost visibility; public-to-private redirect using fake transport; unread PDF reassurance; trusted link without intelligence; trusted Wi-Fi with a new unsafe condition. Each reproduced the behavior described above.
- Source inspection confirmed the missing clock dependency, call-to-biting path, AI action replacement, inconsistent disclosure, and soft-delete/offline merge design.
- No full dependency installation, native build, live attack, third-party API invocation, message sending, or device acceptance was performed.

**Suggested sequence**

1. Complete the already-planned Pixel 10 launch smoke test on the fresh APK, retaining its source commit/build identifier.
2. Record and triage this backlog. If the backend is already publicly exposed, assess item 1 promptly; do not wait for mobile integration to investigate server reachability.
3. Remedy P0 consumer/backend issues in small, reviewable changes with the listed focused checks. Any newer APK used for acceptance must have traceable source and repeat the launch smoke test.
4. Only after the Pixel 10 gate passes may the planned Stage 1D work begin under its existing scope. Keep GuardDog hashes unchanged and the packet-evidence rule intact.
5. Add CI checks that cross boundaries (evidence → egress → API, health → UI, privacy → real outbound payload). More isolated unit tests alone would not catch several of these failures.
6. Complete P1 assurance and usability work before public V1; leave visual expansion and voluntary funding polish until the core promise is dependable.

