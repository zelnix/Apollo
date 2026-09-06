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
