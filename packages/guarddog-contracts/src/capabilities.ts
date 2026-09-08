// Honest platform capability statement. Nothing here may claim more than the
// observed selective-IP proof path (see docs/M1_OBSERVED_TRAFFIC_PATH.md).

export type HostnameVisibility = "none" | "selective-ip-only";

export interface ProtectionCapabilities {
  platform: "android" | "ios" | "web" | "unknown";
  /** Android M1: VPN route for a single injected /32 with packet drop. */
  selectiveIpBlocking: boolean;
  hostnameVisibility: HostnameVisibility;
  dnsInterception: false;
  dohDotCoverage: false;
  quicHttp3Coverage: false;
  perAppAttribution: false;
  universalDeviceProtection: false;
  /** iOS M1: analysis + warning only, no enforcement. */
  analysisAndWarningOnly: boolean;
  vpnConsentRequired: boolean;
}

export const ANDROID_M1_CAPABILITIES: ProtectionCapabilities = {
  platform: "android",
  selectiveIpBlocking: true,
  hostnameVisibility: "selective-ip-only",
  dnsInterception: false,
  dohDotCoverage: false,
  quicHttp3Coverage: false,
  perAppAttribution: false,
  universalDeviceProtection: false,
  analysisAndWarningOnly: false,
  vpnConsentRequired: true,
};

export const IOS_M1_CAPABILITIES: ProtectionCapabilities = {
  platform: "ios",
  selectiveIpBlocking: false,
  hostnameVisibility: "none",
  dnsInterception: false,
  dohDotCoverage: false,
  quicHttp3Coverage: false,
  perAppAttribution: false,
  universalDeviceProtection: false,
  analysisAndWarningOnly: true,
  vpnConsentRequired: false,
};

export const NO_ENFORCEMENT_CAPABILITIES: ProtectionCapabilities = {
  ...IOS_M1_CAPABILITIES,
  platform: "web",
};

export function validateCapabilities(input: unknown): ProtectionCapabilities | null {
  if (typeof input !== "object" || input === null) return null;
  const c = input as Record<string, unknown>;
  const bool = (k: string) => typeof c[k] === "boolean";
  if (!["android", "ios", "web", "unknown"].includes(c.platform as string)) return null;
  if (!bool("selectiveIpBlocking") || !bool("analysisAndWarningOnly") || !bool("vpnConsentRequired")) return null;
  if (!["none", "selective-ip-only"].includes(c.hostnameVisibility as string)) return null;
  // The unsupported surfaces must be reported as false; a bridge claiming otherwise is rejected.
  for (const k of ["dnsInterception", "dohDotCoverage", "quicHttp3Coverage", "perAppAttribution", "universalDeviceProtection"]) {
    if (c[k] !== false) return null;
  }
  return c as unknown as ProtectionCapabilities;
}

// --- Gate Guard M2: PlatformCapabilityProfile -----------------------------------------------------------
// Additive, cross-platform capability surface (Apollo's four-platform architecture directive). This does
// NOT replace ProtectionCapabilities above: ANDROID_M1_CAPABILITIES / IOS_M1_CAPABILITIES / NO_ENFORCEMENT_
// CAPABILITIES and validateCapabilities() are frozen, unchanged, and still the shape the M1 bridge reports.
// PlatformCapabilityProfile is the richer, platform-neutral shape new work (Website Gate, and eventually
// Windows/macOS adapters) reports instead — named capability axes rather than M1-era boolean flags, so a
// platform can honestly say what it can and cannot see without contorting M1's vocabulary.

export type ApolloPlatform = "android" | "ios" | "windows" | "macos" | "web" | "unknown";

export interface PlatformCapabilityProfile {
  platform: ApolloPlatform;
  /** Can enforce (block/allow) network traffic at all, by any mechanism. */
  networkFiltering: boolean;
  /** Can observe raw IP packets (e.g. a TUN read loop). */
  packetVisibility: boolean;
  /** Can observe DNS queries (e.g. Gate Guard M2's DNS-triggered sinkhole). Never true for M1's frozen profile. */
  dnsVisibility: boolean;
  /** Can attribute traffic to a specific OS process. */
  processAttribution: boolean;
  /** Can attribute traffic to a specific installed application. */
  appAttribution: boolean;
  /** Can determine the destination domain/hostname a flow was intended for. */
  domainVisibility: boolean;
  /** Can block using locally-held (signed rule / cache) intelligence, without a network round-trip. */
  localBlocking: boolean;
  /** Enforcement continues while the app is backgrounded. */
  backgroundProtection: boolean;
  /** Enforcement continues (for known-bad locally cached indicators) with no network connectivity. */
  offlineProtection: boolean;
  /** Security events are delivered to the app in near-real-time, not only on a poll/batch cycle. */
  realTimeEvents: boolean;
}

/** M1's frozen capability profile, expressed in the new named-axis shape. Never edit to add dnsVisibility
 * or any other capability M1 did not actually prove — this must stay a faithful restatement of
 * ANDROID_M1_CAPABILITIES, not a new claim. */
export const ANDROID_M1_CAPABILITY_PROFILE: PlatformCapabilityProfile = {
  platform: "android",
  networkFiltering: true,
  packetVisibility: true,
  dnsVisibility: false,
  processAttribution: false,
  appAttribution: false,
  domainVisibility: false,
  localBlocking: true,
  backgroundProtection: true,
  offlineProtection: true,
  realTimeEvents: true,
};

/** Gate Guard M2 Website Gate: the one honest capability gain is dnsVisibility (DNS-triggered sinkhole).
 * Reported only when the website-gate adapter is actually active and validated on-device — never assumed
 * merely because the app version supports it. */
export const ANDROID_M2_CAPABILITIES: PlatformCapabilityProfile = {
  ...ANDROID_M1_CAPABILITY_PROFILE,
  dnsVisibility: true,
  domainVisibility: true,
};

const APOLLO_PLATFORMS: readonly ApolloPlatform[] = ["android", "ios", "windows", "macos", "web", "unknown"];
const CAPABILITY_PROFILE_BOOLEAN_KEYS: readonly (keyof PlatformCapabilityProfile)[] = [
  "networkFiltering",
  "packetVisibility",
  "dnsVisibility",
  "processAttribution",
  "appAttribution",
  "domainVisibility",
  "localBlocking",
  "backgroundProtection",
  "offlineProtection",
  "realTimeEvents",
];

/** Shape validation only (not a per-platform overclaim matrix like validateCapabilities(): which axes a
 * platform may honestly claim is enforced by which constant its native bridge actually reports, not by a
 * hardcoded denial list here). Rejects anything with a missing/mistyped field. */
export function validatePlatformCapabilityProfile(input: unknown): PlatformCapabilityProfile | null {
  if (typeof input !== "object" || input === null) return null;
  const c = input as Record<string, unknown>;
  if (!APOLLO_PLATFORMS.includes(c.platform as ApolloPlatform)) return null;
  for (const k of CAPABILITY_PROFILE_BOOLEAN_KEYS) {
    if (typeof c[k] !== "boolean") return null;
  }
  return c as unknown as PlatformCapabilityProfile;
}
