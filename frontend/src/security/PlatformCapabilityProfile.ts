// PlatformCapabilityProfile & EnforcementEvidence — the cross-platform capability/evidence
// contract for the Apollo Security SDK (Android, iOS, Windows, macOS).
//
// This file exists so the UI, backend and tests never assume Android-only execution, even
// while only the mock and Android adapters are actually wired up (see securityAdapter.ts).
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
export type SdkPlatform = "android" | "ios" | "windows" | "macos" | "mock";

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
  mechanism: EnforcementMethod | "network_extension" | "vpn_service" | "packet_filter";
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
 * actual OS mechanism, not guessed per feature.
 */
export const PLATFORM_CAPABILITY_BASELINES: Record<SdkPlatform, PlatformCapabilityProfile> = {
  android: {
    platform: "android", platformVersion: null, sdkVersion: null, capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // A VpnService TUN interface sees every packet and every DNS query, and can attribute
    // both to a UID (hence an app) via ConnectivityManager/NetworkStatsManager.
    networkFiltering: "full", packetVisibility: "full", dnsVisibility: "full",
    processAttribution: "full", appAttribution: "full", domainVisibility: "full",
    localBlocking: "full", backgroundProtection: "full", offlineProtection: "partial", realTimeEvents: "full",
  },
  ios: {
    platform: "ios", platformVersion: null, sdkVersion: null, capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // NEFilterDataProvider sees per-flow metadata (not raw packets without a rarely-granted
    // entitlement); Safari content blockers see domains only inside Safari. Apple never exposes
    // another app's process identity to a third-party extension on any iOS version.
    networkFiltering: "partial", packetVisibility: "partial", dnsVisibility: "partial",
    processAttribution: "none", appAttribution: "none", domainVisibility: "partial",
    localBlocking: "partial", backgroundProtection: "partial", offlineProtection: "partial", realTimeEvents: "partial",
  },
  windows: {
    platform: "windows", platformVersion: null, sdkVersion: null, capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // Windows Filtering Platform (WFP) callouts run system-wide in kernel space with PID-level
    // attribution available to the calling driver/service.
    networkFiltering: "full", packetVisibility: "full", dnsVisibility: "full",
    processAttribution: "full", appAttribution: "full", domainVisibility: "full",
    localBlocking: "full", backgroundProtection: "full", offlineProtection: "partial", realTimeEvents: "full",
  },
  macos: {
    platform: "macos", platformVersion: null, sdkVersion: null, capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // A signed System Extension (NEFilterPacketProvider / NEDNSProxyProvider) has far more reach
    // than iOS's sandboxed extension, but per-process attribution across sandboxed apps is still
    // only partial without additional entitlements.
    networkFiltering: "full", packetVisibility: "full", dnsVisibility: "full",
    processAttribution: "partial", appAttribution: "partial", domainVisibility: "full",
    localBlocking: "full", backgroundProtection: "full", offlineProtection: "partial", realTimeEvents: "full",
  },
  mock: {
    platform: "mock", platformVersion: "n/a", sdkVersion: "mock", capabilityVersion: CAPABILITY_PROFILE_VERSION,
    // The mock adapter enforces nothing on any device, ever. Every capability is reported "none" —
    // never the host OS's real baseline above — so the preview can never be read as a real
    // capability claim. Truth-of-state applies to reporting, not only to enforcement.
    networkFiltering: "none", packetVisibility: "none", dnsVisibility: "none",
    processAttribution: "none", appAttribution: "none", domainVisibility: "none",
    localBlocking: "none", backgroundProtection: "none", offlineProtection: "none", realTimeEvents: "none",
  },
};
