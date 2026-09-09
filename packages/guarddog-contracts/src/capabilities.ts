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
  /** Can observe DNS queries. Never true for M1's frozen profile. NOTE: like every field in this
   * interface, this is scoped to what the platform adapter's own interception mechanism actually
   * sees, never a claim of universal/system-wide coverage of all DNS traffic on the device — see
   * each per-platform constant's own doc comment for what its mechanism does and does not cover
   * (e.g. Android's Gate Guard M2 sinkhole: real for its own plaintext-UDP/53 DNS gateway, silent
   * for Private DNS/DoT and app-embedded DoH, which never reach that gateway at all). */
  dnsVisibility: boolean;
  /** Can attribute traffic to a specific OS process. */
  processAttribution: boolean;
  /** Can attribute traffic to a specific installed application. */
  appAttribution: boolean;
  /** Can determine the destination domain/hostname a flow was intended for. Same scoping note as
   * `dnsVisibility` above: true means the adapter's own mechanism genuinely determines the domain
   * for traffic that mechanism actually sees, not that it can do so for every flow on the device. */
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

/**
 * Gate Guard M2 Website Gate: the one honest capability gain is dnsVisibility/domainVisibility (the
 * DNS-triggered sinkhole). Reported only when the website-gate adapter is actually active and
 * validated on-device (see `GuardDogSecuritySDK.getPlatformCapabilityProfile()`) — never assumed
 * merely because the app version supports it.
 *
 * **Scope correction (Gate Guard M2.1, Android capability-truth pass): this is NOT system-wide DNS
 * visibility.** The mechanism only ever sees DNS queries that transit Apollo's own intercepted
 * plaintext UDP/53 path (see `WebsiteGateAddressing`/`DnsPacketClassifier` in `guarddog-vpn`) — the
 * scope tag `"dns:udp-53"` (see `ANDROID_M2_DNS_COVERAGE_TAG` below). Two real, common traffic
 * shapes bypass it completely and are silently invisible to Apollo, not merely degraded:
 *   - **Android Private DNS (DoT)**: a device-level setting that sends DNS over TLS to a resolver of
 *     the user's/network's choosing, entirely outside the plaintext UDP/53 flow the VPN intercepts.
 *   - **App-embedded DoH**: an app resolving names over HTTPS to a resolver it hardcodes itself —
 *     indistinguishable from any other HTTPS/443 traffic to Apollo's DNS-only interception point.
 * `true` here means "genuinely true for the traffic that actually reaches this adapter's own
 * interception point" — the same convention every other field in `PlatformCapabilityProfile` already
 * uses (e.g. `packetVisibility: true` for M1 never meant "sees every packet on the device," only
 * packets on the selectively-routed /32). It is deliberately NOT flipped to `false`: that would erase
 * the one real, on-device, DNS-triggered enforcement capability this milestone built and verified
 * (native-gates CI, 111/111 unit tests) — an equally dishonest opposite error.
 *
 * **Deliberately no contract redesign here.** A separate, independent Apollo product/UI stream
 * (GitHub `main`, package `com.hucentai.apollosecurity`) has its own `PlatformCapabilityProfile` using
 * a tri-state `CapabilityLevel` ("full"|"partial"|"none") plus a `ProtectionStatus.coverageScope:
 * string[]` field — which could express this limitation as a literal `"partial"` + `["dns:udp-53"]`.
 * Gate Guard's `com.guarddog.*` native module is a SEPARATE, independent native Android
 * implementation from that one (flagged as an architectural duplication for the product owner to
 * resolve in a future Android Native Consolidation milestone — see
 * `docs/M2_WEBSITE_GATE_DESIGN.md` §"Phase 5.2"). Deliberately NOT copying/wiring `main`'s contract
 * types into this module now — that would risk making Gate Guard look integrated with Apollo's
 * product layer when it isn't, and would create a second, drifting copy of that contract. If/when
 * the two native stacks are unified, this constant is replaced by the real, shared
 * `CapabilityLevel`/`coverageScope` types, not by a competing Gate Guard-only reinvention of them.
 * See `ANDROID_M2_DNS_VISIBILITY_SCOPE`/`ANDROID_M2_DNS_COVERAGE_TAG` below for the exported,
 * testable, user/analyst-facing statement of this exact limitation in the meantime.
 */
export const ANDROID_M2_CAPABILITIES: PlatformCapabilityProfile = {
  ...ANDROID_M1_CAPABILITY_PROFILE,
  dnsVisibility: true,
  domainVisibility: true,
};

/**
 * Exported (not just a comment) so this exact disclosure is testable and quotable verbatim by any
 * consumer surfacing `ANDROID_M2_CAPABILITIES` to a user or analyst, instead of re-deriving or
 * understating/overstating the limitation themselves. Deliberately NOT a new field on
 * `PlatformCapabilityProfile` (that shape is frozen for this Android-only correction — no contract
 * redesign, per product decision; see `ANDROID_M2_CAPABILITIES` doc comment above for why).
 * Kept intentionally narrow and Android/DNS-specific — this is not a general-purpose disclosure
 * mechanism for other platforms/capabilities.
 */
export const ANDROID_M2_DNS_VISIBILITY_SCOPE =
  "Apollo's Website Gate observes DNS queries and determines destination domains only for traffic " +
  "that reaches its own plaintext UDP/53 DNS interception point (scope tag \"dns:udp-53\"). Android " +
  "Private DNS (DoT) and app-embedded DoH resolvers bypass this entirely and are invisible to " +
  "Apollo. dnsVisibility and domainVisibility above mean visibility into what this adapter's own " +
  "mechanism actually observes -- never system-wide or universal DNS/domain coverage of the device.";

/**
 * Machine-readable scope tag for exactly what Gate Guard M2's DNS-triggered sinkhole covers, in the
 * same tag vocabulary Apollo main's `ProtectionStatus.coverageScope` uses on its own, separate
 * `com.hucentai.apollosecurity` stack (`frontend/src/security/SecurityPlatformAdapter.ts` on GitHub
 * `main`) -- deliberately NOT that type, NOT imported from it, and NOT wired into any shared
 * interface: see `ANDROID_M2_CAPABILITIES`'s doc comment for why this stays a plain, standalone
 * constant until the two native stacks are deliberately unified.
 */
export const ANDROID_M2_DNS_COVERAGE_TAG = "dns:udp-53";



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
