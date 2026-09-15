// Gate Guard — DNS/DoH Capability Diagnostic Wizard: aggregated, machine-observed "truth-of-state"
// snapshot. Every field here comes directly from a live native/SDK read taken at the moment of
// capture -- never assumed, cached across steps, or inferred from an earlier snapshot. Attached to
// the Preflight step AND to every individual probe record, so each row of evidence carries its own
// proof of exactly what state the device/app were in when that specific probe ran.
//
// COMPLETELY SEPARATE from the frozen M2.1 Phase 6A acceptance harness -- reads the same public
// GuardDogSecuritySDK / GuardDogNative surface Phase 6 already uses, but never imports from, is
// never imported by, and never affects phase6AutomatedHarness.ts or any acceptance verdict.
import { Platform } from "react-native";

import { readBuildProvenance, type BuildProvenance } from "@/src/harness/buildProvenance";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";
import { GuardDogNative, type NativeDnsCapabilityDeviceSnapshot, type PrivateDnsRuntimeMode } from "@/src/sdk/nativeModule";

export interface DnsDiagnosticTruthSnapshot {
  capturedAt: string;
  nativeAvailable: boolean;
  vpnConsentGranted: boolean | null;
  protectionState: string | null;
  tunOpen: boolean | null;
  selectiveRouteActive: boolean | null;
  notificationsEnabled: boolean | null;
  websiteGateConfigured: boolean | null;
  dnsGatewayActive: boolean | null;
  acceptedRulesetId: string | null;
  acceptedBundleVersion: number | null;
  acceptedKeyId: string | null;
  /** Carried through from the Preflight activation result (null before Preflight has run). Not
   * re-derived per snapshot -- re-verifying the whole signed bundle on every row would be redundant;
   * the bundle cannot change mid-session without a fresh activation. */
  probeRuleConfirmedInBundle: boolean | null;
  activeNativeStackId: string | null;
  supportedAbis: string[];
  primaryAbi: string | null;
  privateDnsActive: boolean | null;
  privateDnsServerName: string | null;
  privateDnsRuntimeMode: PrivateDnsRuntimeMode | "UNAVAILABLE";
  networkTransport: string | null;
  buildProvenance: BuildProvenance;
  /** Cross-checks invariants that should never diverge if this app's own state machine is honest.
   * A violation is surfaced, never hidden or silently corrected -- evidence captured under a
   * flagged snapshot is shown as flagged, not discarded and not trusted blindly either. */
  truthViolation: { violated: boolean; reasons: string[] };
}

function computeTruthViolation(args: {
  protectionState: string | null;
  isVpnConsentRequired: boolean;
  dnsGatewayActive: boolean;
  tunOpen: boolean;
  probeRuleConfirmedInBundle: boolean | null;
}): { violated: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (args.protectionState === "ACTIVE" && args.isVpnConsentRequired) {
    reasons.push("Protection state reports ACTIVE but the OS reports VPN consent is currently required -- contradictory.");
  }
  if (args.dnsGatewayActive && !args.tunOpen) {
    reasons.push("Website Gate DNS gateway reports active but the native TUN is reportedly not open -- contradictory.");
  }
  if (args.probeRuleConfirmedInBundle === false) {
    reasons.push("The dedicated probe rule is NOT confirmed present in the accepted signed bundle -- any capture below would be unattributable.");
  }
  return { violated: reasons.length > 0, reasons };
}

/**
 * Captures one fresh, fully machine-observed snapshot. `probeRuleConfirmedInBundle` must be passed
 * through from the Preflight activation result (or null before Preflight has run).
 */
export async function captureDnsDiagnosticTruthSnapshot(probeRuleConfirmedInBundle: boolean | null): Promise<DnsDiagnosticTruthSnapshot> {
  const buildProvenance = await readBuildProvenance();
  const nativeAvailable = Platform.OS === "android" && !!GuardDogNative;

  if (!nativeAvailable) {
    return {
      capturedAt: new Date().toISOString(),
      nativeAvailable: false,
      vpnConsentGranted: null,
      protectionState: null,
      tunOpen: null,
      selectiveRouteActive: null,
      notificationsEnabled: null,
      websiteGateConfigured: null,
      dnsGatewayActive: null,
      acceptedRulesetId: null,
      acceptedBundleVersion: null,
      acceptedKeyId: null,
      probeRuleConfirmedInBundle,
      activeNativeStackId: null,
      supportedAbis: [],
      primaryAbi: null,
      privateDnsActive: null,
      privateDnsServerName: null,
      privateDnsRuntimeMode: "UNAVAILABLE",
      networkTransport: null,
      buildProvenance,
      truthViolation: { violated: false, reasons: [] },
    };
  }

  const protection = GuardDogSecuritySDK.getProtectionState();
  const gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
  const dnsSnapshot: NativeDnsCapabilityDeviceSnapshot = GuardDogNative!.getDnsCapabilityDeviceSnapshot();
  const recovery = GuardDogNative!.getRecoveryStatus();
  const isVpnConsentRequired = GuardDogNative!.isVpnConsentRequired();

  const truthViolation = computeTruthViolation({
    protectionState: protection.state,
    isVpnConsentRequired,
    dnsGatewayActive: gateStatus.dnsGatewayActive,
    tunOpen: recovery.tunOpen,
    probeRuleConfirmedInBundle,
  });

  return {
    capturedAt: new Date().toISOString(),
    nativeAvailable: true,
    vpnConsentGranted: protection.consentGranted,
    protectionState: protection.state,
    tunOpen: recovery.tunOpen,
    selectiveRouteActive: recovery.selectiveRouteActive,
    notificationsEnabled: dnsSnapshot.notificationsEnabled,
    websiteGateConfigured: gateStatus.configured,
    dnsGatewayActive: gateStatus.dnsGatewayActive,
    acceptedRulesetId: gateStatus.acceptedRulesetId,
    acceptedBundleVersion: gateStatus.acceptedBundleVersion,
    acceptedKeyId: gateStatus.acceptedKeyId,
    probeRuleConfirmedInBundle,
    activeNativeStackId: dnsSnapshot.activeNativeStackId,
    supportedAbis: dnsSnapshot.supportedAbis,
    primaryAbi: dnsSnapshot.primaryAbi,
    privateDnsActive: dnsSnapshot.privateDnsActive,
    privateDnsServerName: dnsSnapshot.privateDnsServerName,
    privateDnsRuntimeMode: dnsSnapshot.privateDnsRuntimeMode,
    networkTransport: dnsSnapshot.networkTransport,
    buildProvenance,
    truthViolation,
  };
}

/** Human-readable, honest description of a privateDnsRuntimeMode -- NEVER claims "Off" for
 * INACTIVE_OR_OFF, since Android's public API cannot prove that distinction. */
export function describePrivateDnsRuntimeMode(mode: PrivateDnsRuntimeMode | "UNAVAILABLE", serverName: string | null): string {
  switch (mode) {
    case "STRICT":
      return `Private DNS active — Strict hostname: ${serverName ?? "unknown"}`;
    case "ACTIVE_NO_HOSTNAME":
      return "Private DNS active — Automatic (opportunistic DoT succeeded, no strict hostname)";
    case "INACTIVE_OR_OFF":
      return 'Private DNS currently inactive — Android cannot distinguish "Off" from "Automatic" with an inactive opportunistic DoT probe';
    case "UNSUPPORTED_OS_VERSION":
      return "Private DNS state unavailable — device OS predates Android 9 (API 28)";
    case "UNAVAILABLE":
    default:
      return "Private DNS state unavailable — no native module (Expo Go / web)";
  }
}
