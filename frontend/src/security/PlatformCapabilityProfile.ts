// PlatformCapabilityProfile & EnforcementEvidence — the cross-platform capability/evidence
// contract for the Apollo Security SDK (Android, iOS, Windows, macOS).
//
// This file exists so the UI, backend and tests never assume Android-only execution, even
// while each host reports only the mechanism actually present at runtime.
// It answers two separate questions, and the two must never be confused:
//
//   1. PlatformCapabilityProfile — "what CAN this class of device technically do?"
//      A ceiling, reported per platform/SDK build — not a claim about right now.
//   2. EnforcementEvidence      — "what DID the OS actually enforce, just now, with proof?"
//      A fact about one concrete action. THREAT_BLOCKED-equivalent states must derive from
//      this alone — never from capability, never from a rule/threat match by itself.
//
// Truth-of-state chain: Requested → Operational → Verified (see SecurityPlatformAdapter.ts,
// ProtectionStatus, and src/domain/stateMachine.ts canTransition()). A capability being "full"
// only means the platform COULD enforce; it says nothing about whether it DID.

import type { EnforcementMethod } from "./SecurityPlatformAdapter";

/** The four platforms the Apollo Security SDK is designed for, plus the dev-time mock. */
export type SdkPlatform = "android" | "ios" | "windows" | "macos" | "web";

/**
 * Tri-state, never boolean: many OS-level capabilities are only PARTIALLY available
 * (e.g. iOS Network Extension sees per-flow metadata but never another app's identity).
 * Collapsing this to a boolean would either overclaim or hide a real, useful partial
 * capability — both are Truth-of-state violations.
 */
export type CapabilityLevel = "full" | "partial" | "none";

/** Schema version for PlatformCapabilityProfile. Bump when fields are added/removed/redefined. */
export const CAPABILITY_PROFILE_VERSION = "1";

export interface PlatformCapabilityProfile {
  platform: SdkPlatform;
  /** OS version string, e.g. "Android 15", "iOS 18.4". Null when unknown or not applicable (mock). */
  platformVersion: string | null;
  /** Apollo Security SDK / native-module version actually running on this device. Null when absent. */
  sdkVersion: string | null;
  /** Schema version of this profile's shape — lets old and new clients disagree safely instead of crashing. */
  capabilityVersion: string;

  /** Can the platform intercept and act on network traffic at all (VPN/NE/WFP style)? */
  networkFiltering: CapabilityLevel;
  /** Can the platform see individual packets, or only flow-level metadata? */
  packetVisibility: CapabilityLevel;
  /** Can the platform observe DNS queries specifically? */
  dnsVisibility: CapabilityLevel;
  /** Can a network event be attributed to an OS process/PID? */
  processAttribution: CapabilityLevel;
  /** Can a network event be attributed to an installed app identity (package/bundle id)? */
  appAttribution: CapabilityLevel;
  /** Can the platform see which domain a connection is destined for? */
  domainVisibility: CapabilityLevel;
  /** Can the platform actually refuse/drop a connection locally, not just report it? */
  localBlocking: CapabilityLevel;
  /** Does enforcement keep running when the app is backgrounded or killed? */
  backgroundProtection: CapabilityLevel;
  /** Does local enforcement keep working with no network/cloud intel reachable? */
  offlineProtection: CapabilityLevel;
  /** Can the platform push security events to the app in near real time? */
  realTimeEvents: CapabilityLevel;
  /**
   * Concrete scope tags describing exactly what this profile's capabilities cover — e.g.
   * ["dns:udp-53"] for a DNS-only tunnel, ["browser:safari"] for a Safari content blocker.
   * Optional (older/simpler adapters may omit it), but whenever present it must describe the
   * DEPLOYED implementation's real reach, never a theoretical maximum. A CapabilityLevel of
   * "partial"/"full" without a scope tag still means "ask the adapter", not "everything".
   * Presence of a scope tag — like any capability field — never by itself implies enforcement;
   * only EnforcementEvidence with result:"verified" may authorise that (see isVerifiedEnforcement).
   */
  scope?: string[];
}

// ---------------------------------------------------------------------------
// Enforcement evidence — the ONLY thing allowed to authorise a verified block.
// ---------------------------------------------------------------------------

export type EnforcementDirection = "outbound" | "inbound" | "unknown";
export type EnforcementProtocol = "tcp" | "udp" | "dns" | "http" | "https" | "unknown";
export type RequestedAction = "block" | "allow" | "monitor";
export type EnforcedAction = "blocked" | "allowed" | "monitored" | "none";
/** The single field allowed to gate a THREAT_BLOCKED / "biting" transition. */
export type EnforcementResult = "verified" | "unverified" | "failed";
export type RuleSource = "local_blocklist" | "cloud_intel" | "heuristic" | "user_override" | "unknown";
export type EvidenceConfidence = "high" | "medium" | "low";
export type AttributionConfidence = "high" | "medium" | "low" | "unavailable";

export interface EnforcementDestination {
  ip: string | null;
  /** For mechanism="call_screening" this doubles as the caller's E.164 number — no separate `phone`
   * field was added purely to avoid schema churn across the Kotlin/Swift/Python/TS layers for a v1. */
  domain: string | null;
  port: number | null;
}

export interface EnforcementAttribution {
  appId: string | null;
  processName: string | null;
  confidence: AttributionConfidence;
}

export interface EnforcementEvidence {
  evidenceId: string;
  /** Correlates to a PatrolEvent.event_id when one exists. */
  eventId: string | null;
  deviceId: string | null;
  platform: SdkPlatform;
  osVersion: string | null;
  sdkVersion: string | null;
  /** ISO-8601 timestamp of when the OS observed/enforced this, not when the app read it. */
  observedAt: string;
  /** How this was actually enforced. "simulated"/"none" can never carry result:"verified". */
  mechanism: EnforcementMethod | "network_extension" | "wfp_ale_authorization" | "vpn_service" | "packet_filter" | "call_screening";
  direction: EnforcementDirection;
  protocol: EnforcementProtocol;
  destination: EnforcementDestination;
  attribution: EnforcementAttribution;
  matchedRuleId: string | null;
  threatId: string | null;
  requestedAction: RequestedAction;
  enforcedAction: EnforcedAction;
  result: EnforcementResult;
  ruleSource: RuleSource;
  /** Confidence of the match/evidence itself — separate from attribution.confidence. */
  confidence: EvidenceConfidence;
  sourceMetadata: Record<string, string | number | boolean | null>;
  /** Ties related evidence/events together (e.g. Threat Scent flows: message → link → login). */
  correlationId: string | null;
}

/**
 * THE gate. A destination being on a blocklist, or a capability being "full", is never
 * enough on its own. Only real, OS-confirmed enforcement evidence may authorise a
 * THREAT_BLOCKED / "biting" transition (see stateMachine.canTransition, PatrolEvent.verified_block).
 */
export function isVerifiedEnforcement(evidence: EnforcementEvidence | null | undefined): boolean {
  if (!evidence) return false;
  return (
    evidence.result === "verified" &&
    evidence.enforcedAction === "blocked" &&
    evidence.mechanism !== "simulated" &&
    evidence.mechanism !== "none"
  );
}

/** True only when at least one record in the list verifies a block. Empty/absent input → false, never assumed. */
export function anyVerifiedBlock(evidence: readonly EnforcementEvidence[] | null | undefined): boolean {
  return Array.isArray(evidence) && evidence.some(isVerifiedEnforcement);
}

// ---------------------------------------------------------------------------
// Reference capability ceilings — grounded in real OS mechanisms per platform.
// ---------------------------------------------------------------------------

/**
 * Reference ceilings for each real platform. These are NOT reported as "this device's live
 * capability" — only a native adapter backed by a real SDK probe may claim them for its own
 * platform. They exist so (a) the types/UI/tests can represent all four platforms before any
 * native code for Windows/macOS exists, and (b) capability decisions are grounded in the
 * actual OS mechanism, not guessed per feature. A live adapter must still narrow these ceilings
 * to the mechanism it actually observes; the Package 6 Windows service uses ALE flow metadata,
 * not a packet-inspection callout, and the macOS extension uses NEFilterDataProvider flow metadata.
 */
export const PLATFORM_CAPABILITY_BASELINES: Record<SdkPlatform, PlatformCapabilityProfile> = {
  android: {
    platform: "android", platformVersion: null, sdkVersion: null, capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // A VpnService TUN interface sees every packet and every DNS query, and can attribute
    // both to a UID (hence an app) via ConnectivityManager/NetworkStatsManager.
    networkFiltering: "full", packetVisibility: "full", dnsVisibility: "full",
    processAttribution: "full", appAttribution: "full", domainVisibility: "full",
    localBlocking: "full", backgroundProtection: "full", offlineProtection: "partial", realTimeEvents: "full",
    // Ceiling scope only — the DEPLOYED AndroidSecurityAdapter (ApolloDnsVpnService) is DNS-only
    // ("dns:udp-53", reported by the native module itself), narrower than this general ceiling.
    scope: ["packet:all", "dns:all"],
  },
  ios: {
    platform: "ios", platformVersion: null, sdkVersion: null, capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // NEFilterDataProvider sees per-flow metadata (not raw packets without a rarely-granted
    // entitlement); Safari content blockers see domains only inside Safari. Apple never exposes
    // another app's process identity to a third-party extension on any iOS version.
    networkFiltering: "partial", packetVisibility: "partial", dnsVisibility: "partial",
    processAttribution: "none", appAttribution: "none", domainVisibility: "partial",
    localBlocking: "partial", backgroundProtection: "partial", offlineProtection: "partial", realTimeEvents: "partial",
    // Ceiling scope for a hypothetical NEFilterDataProvider build. The DEPLOYED IOSSecurityAdapter
    // uses Safari Content Blocker instead (scope ["browser:safari"], reported by the native module
    // itself) — a much narrower, purely declarative mechanism. Never conflate the two.
    scope: ["network_extension:flow-metadata"],
  },
  windows: {
    platform: "windows", platformVersion: null, sdkVersion: null, capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // Windows Filtering Platform (WFP) callouts run system-wide in kernel space with PID-level
    // attribution available to the calling driver/service.
    networkFiltering: "full", packetVisibility: "full", dnsVisibility: "full",
    processAttribution: "full", appAttribution: "full", domainVisibility: "full",
    localBlocking: "full", backgroundProtection: "full", offlineProtection: "partial", realTimeEvents: "full",
    scope: ["wfp:kernel-callout"],
  },
  macos: {
    platform: "macos", platformVersion: null, sdkVersion: null, capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // A signed System Extension (NEFilterPacketProvider / NEDNSProxyProvider) has far more reach
    // than iOS's sandboxed extension, but per-process attribution across sandboxed apps is still
    // only partial without additional entitlements.
    networkFiltering: "full", packetVisibility: "full", dnsVisibility: "full",
    processAttribution: "partial", appAttribution: "partial", domainVisibility: "full",
    localBlocking: "full", backgroundProtection: "full", offlineProtection: "partial", realTimeEvents: "full",
    scope: ["system_extension:packet-filter", "system_extension:dns-proxy"],
  },
  web: {
    platform: "web", platformVersion: "n/a", sdkVersion: "browser", capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // A browser (and the development preview harness) enforces nothing on any device, ever. Every capability is
    // reported "none" — never the host OS's real baseline above — so web can never be read as a real capability claim. Truth-of-state applies to reporting, not only to enforcement.
    networkFiltering: "none", packetVisibility: "none", dnsVisibility: "none",
    processAttribution: "none", appAttribution: "none", domainVisibility: "none",
    localBlocking: "none", backgroundProtection: "none", offlineProtection: "none", realTimeEvents: "none",
    scope: [],
  },
};

/**
 * Machine-checkable companion to PLATFORM_CAPABILITY_BASELINES: which platforms have a REAL
 * adapter wired up in this codebase right now. Android/iOS use Expo native modules, Windows/macOS
 * use the explicit Tauri DesktopSecurityAdapter, and web uses the real browser boundary. A true
 * value means a concrete adapter exists; it does not imply that every theoretical capability is
 * available on that platform.
 */
export const PLATFORM_ADAPTER_IMPLEMENTED: Record<SdkPlatform, boolean> = {
  android: true,
  ios: true,
  windows: true,
  macos: true,
  web: true, // real browser adapter: genuine browser capabilities, native capabilities unavailable
};
