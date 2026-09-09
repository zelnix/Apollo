// PLACEHOLDER — NOT WIRED. Architecture reference only.
// See /app/docs/android-consolidation-plan.md for the full decision record.
//
// This file exists purely to document the target shape of a FUTURE Android enforcement swap:
//
//   SecurityPlatformAdapter -> Android Apollo adapter (this file, eventually) ->
//     GuardDogSecurity SDK -> GuardDogVpnService
//
// It is NOT imported by securityAdapter.ts, NativeSecurityAdapters.ts, index files, or anything
// else in this app — grep for "GuardDogSecurityAdapter" to confirm. AndroidSecurityAdapter (in
// ../NativeSecurityAdapters.ts, backed by ApolloDnsVpnService.kt) remains the ONLY real Android
// adapter until:
//   1. GuardDog passes physical-device acceptance (docs/android-physical-device-acceptance.md
//      tracks the CURRENT legacy stack's acceptance; GuardDog's own acceptance is tracked on
//      m2-native-acceptance), and
//   2. a dedicated consolidation branch/PR lands the real implementation below — never a
//      wholesale merge of m2-native-acceptance into main.
//
// Do NOT flesh this out into a working adapter without both of the above. Do NOT use this file
// as a place to re-implement "M2 Website Gate" logic independently — that functionality belongs
// to the GuardDogSecurity SDK, not to frontend/modules/apollo-security.
//
// When this eventually IS implemented for real, the one property that must hold from day one:
// this layer is a PURE TRANSLATION SHIM. It forwards GuardDog's own EnforcementEvidence upward
// unmodified in meaning — it must never itself decide something is "verified". That decision
// stays server-side, in backend/routers/patrol.py::_derive_verified_block, unchanged, regardless
// of which native engine produced the evidence. See SecurityPlatformAdapter.ts's own doc comments
// on getEnforcementEvidence()/getPlatformCapabilityProfile() for why capability presence must
// never be conflated with enforcement.
import type { SecurityPlatformAdapter } from "../SecurityPlatformAdapter";

/**
 * Type-only placeholder for the future GuardDogSecurity-backed Android adapter. Intentionally NOT
 * a class, NOT instantiated, NOT exported anywhere else. Its only job is to make the target shape
 * ("implements the exact same SecurityPlatformAdapter contract Apollo already relies on")
 * unambiguous for whoever eventually builds the real thing on the consolidation branch.
 */
export type FutureGuardDogSecurityAdapter = SecurityPlatformAdapter;
