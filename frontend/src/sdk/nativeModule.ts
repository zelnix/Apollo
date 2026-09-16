// JS side of the native module. Resolves the native module when present (dev/production
// build with the module linked) and degrades honestly otherwise (Expo Go / web):
// capabilities report no enforcement and startProtection() stays INACTIVE.
// NOTE: an identical copy lives in packages/guarddog-expo-module/src/index.ts because Metro
// cannot resolve outside its project root; keep both in sync. (Fixed in Gate Guard M2.1 Phase 5 --
// this comment previously pointed at a stale apps/guarddog-mobile path.)
import { requireOptionalNativeModule } from "expo-modules-core";

export interface NativeProtectionState {
  state: string;
  consentGranted: boolean;
  reason?: string | null;
  updatedAt: string;
}

export interface NativeRuleBundleResult {
  accepted: boolean;
  rejectReason?: string | null;
  rulesetId?: string | null;
  bundleVersion?: number | null;
  keyId?: string | null;
  ruleCount: number;
}

export interface NativeRecoveryStatus {
  lifecycle: string;
  tunOpen: boolean;
  selectiveRouteActive: boolean;
  vpnTransportPresent: boolean;
  routeCidr: string | null;
  dropReporterAttached: boolean;
  recovered: boolean;
}

export interface NativeBuildProvenance {
  apkSha256: string | null;
  apkSizeBytes: number | null;
  splitApks: number;
  packageName: string | null;
  versionName: string | null;
  versionCode: number | string | null;
  debuggable: boolean | null;
}

/**
 * Harness-only: one fresh-socket probe of the configured controlled endpoint (new TCP socket → TLS with the canonical hostname → one GET,
 * `Connection: close`; the socket is never VpnService.protect()ed). `synDropShape` is true ONLY for phase=tcp-connect + outcome=timeout to
 * the configured IPv4 — the sole network-level shape consistent with the SYN being dropped inside the /32 TUN.
 */
export interface NativeFreshProbe {
  freshSocket: true;
  expectedIpv4: string;
  resolvedIpv4: string | null;
  phase: "dns" | "tcp-connect" | "tls-handshake" | "http";
  outcome: "ok" | "timeout" | "refused" | "unreachable" | "dns-failed" | "tls-failed" | "http-error" | "error";
  httpStatus: number | null;
  elapsedMs: number;
  detail: string;
  synDropShape: boolean;
}

// --- Gate Guard M2 Website Gate (Phase 5): additive bridge surface. None of the above M1 types/methods are touched. ---

/** Truthful, live snapshot of the Website Gate's native state -- dnsGatewayActive is set only by a
 * live TUN session that actually built the DNS gateway pipeline, never assumed from configuration alone. */
export interface NativeWebsiteGateStatus {
  configured: boolean;
  dnsGatewayActive: boolean;
  acceptedRulesetId: string | null;
  acceptedBundleVersion: number | null;
  acceptedKeyId: string | null;
  overrideCount: number;
}

// --- Gate Guard M2.1 Phase 6: harness-only device provenance for the physical-device acceptance
// report. Additive; none of the above M1/M2 types or methods are touched. ---

export interface NativePhase6DeviceProvenance {
  manufacturer: string;
  model: string;
  osRelease: string;
  sdkInt: number;
  securityPatch: string;
  /** Native-sourced (not JS-asserted) confirmation of which native stack this response came from --
   * this module IS com.guarddog.* by construction, so its mere presence/response is itself the
   * "active stack" evidence; it can never report the other, independent
   * com.hucentai.apollosecurity stack. Deliberately excludes Android's Private DNS setting (not
   * readable by third-party apps without a privileged permission) -- record that one manually. */
  activeNativeStackId: string;
}

// --- Gate Guard DNS/DoH Capability Diagnostic Wizard: harness-only, additive. Exposes EXACTLY what
// Android's public, non-privileged API can prove about the device's current Private DNS runtime
// state. `privateDnsRuntimeMode === "INACTIVE_OR_OFF"` is NEVER proof of a deliberate "Off" --
// Android cannot distinguish that from "Automatic" whose opportunistic DoT probe is currently
// failing. See src/diagnostics/dnsCapabilityDiagnostic.ts for how this ambiguity is preserved
// (never collapsed into a false "verified Off" claim). ---

export type PrivateDnsRuntimeMode = "STRICT" | "ACTIVE_NO_HOSTNAME" | "INACTIVE_OR_OFF" | "UNSUPPORTED_OS_VERSION";

export interface NativeDnsCapabilityDeviceSnapshot {
  supportedAbis: string[];
  primaryAbi: string;
  activeNativeStackId: string;
  privateDnsActive: boolean;
  privateDnsServerName: string | null;
  privateDnsRuntimeMode: PrivateDnsRuntimeMode;
  networkTransport: string;
  notificationsEnabled: boolean;
  capturedAtMillis: number;
}

/** DNS/DoH wizard 2026-06 fix round: which Android settings screen `openPrivateDnsSettings()`
 * actually managed to open, verified resolvable via PackageManager before launch (never assumed) --
 * see the fallback chain in GuardDogExpoModule.kt. "FAILED" means none of the 3 candidates resolved
 * on this device/OEM. */
export type NativeOpenSettingsScreen = "PRIVATE_DNS_SETTINGS" | "NETWORK_SETTINGS" | "GENERIC_SETTINGS" | "FAILED";

export interface NativeOpenSettingsResult {
  openedScreen: NativeOpenSettingsScreen;
}

// --- DNS/DoH wizard, tenth fix round: "automate everything the OS can tell us; ask the tester
// only for information Android cannot expose." Replaces the free-text browser name/version field
// with a machine-enumerated list of installed HTTPS-capable apps (the standard technique for
// listing installed browsers on Android, since there is no dedicated "list browsers" API), and
// launches the probe explicitly into the tester-selected package rather than a generic
// ACTION_VIEW that could silently open a different app than the one recorded. ---

export interface NativeInstalledBrowser {
  packageName: string;
  appLabel: string;
  versionName: string;
  versionCode: number | string;
  /** Compares against `PackageManager.resolveActivity()`'s own answer for the SAME https:// probe
   * intent -- Android's own current default-app choice, never guessed or hardcoded. */
  isDefaultBrowser: boolean;
}

export interface NativeOpenUrlInBrowserResult {
  opened: boolean;
  reason: string | null;
}

export interface GuardDogNativeModule {
  getCapabilities(): Record<string, unknown>;
  getProtectionState(): NativeProtectionState;
  configure(config: { controlledHost: string; controlledIpv4: string; controlledUrl: string; rulesetId: string; dedupeWindowMs: number }): void;
  acceptRuleBundle(rawJson: string): NativeRuleBundleResult;
  analyzeUrl(url: string): { sanitizedUrl: string; host: string; verdict: string; ruleId: string | null } | null;
  requestPermission(kind: string): Promise<"granted" | "denied" | "unsupported">;
  startProtection(): Promise<NativeProtectionState>;
  stopProtection(): Promise<NativeProtectionState>;
  getEnforcementStats(): Record<string, number> | null;
  getRecoveryStatus(): NativeRecoveryStatus;
  /** Harness-only, read-only: true when the OS holds no VPN consent for this app (VpnService.prepare() would return an intent). No dialog. */
  isVpnConsentRequired(): boolean;
  getBuildProvenance(): Promise<NativeBuildProvenance>;
  probeControlledEndpointFresh(timeoutMs: number): Promise<NativeFreshProbe>;
  // Gate Guard M2 Website Gate: the sinkhole pool / virtual DNS endpoint are never passed here --
  // they are always the fixed native WebsiteGateAddressing constants.
  configureWebsiteGate(config: { upstreamDnsResolverIpv4: string | null; bindingLifetimeMs: number }): void;
  acceptWebsiteGateRuleBundle(rawJson: string): NativeRuleBundleResult;
  getWebsiteGateStatus(): NativeWebsiteGateStatus;
  /** Local, reversible, auditable ALLOW-only override. Can only ever prevent a sinkhole arming the
   * signed rule bundle would otherwise trigger for `host` -- never arms a binding itself, never
   * produces a THREAT_BLOCKED. Returns false if `host` fails native canonicalization. */
  setWebsiteGateAllowOverride(config: { host: string; allowed: boolean }): boolean;
  getWebsiteGateOverrides(): string[];
  clearWebsiteGateOverrides(): void;
  /** Gate Guard M2.1 Phase 6 harness-only device provenance. See NativePhase6DeviceProvenance. */
  getPhase6DeviceProvenance(): NativePhase6DeviceProvenance;
  /** Gate Guard DNS/DoH Capability Diagnostic Wizard: harness-only. See NativeDnsCapabilityDeviceSnapshot. */
  getDnsCapabilityDeviceSnapshot(): NativeDnsCapabilityDeviceSnapshot;
  /** DNS/DoH wizard 2026-06 fix round: opens the best available Android Settings screen for
   * changing Private DNS (Private DNS settings -> Network & internet -> generic Settings
   * fallback chain, each verified resolvable before launch). Returns exactly which screen opened. */
  openPrivateDnsSettings(): NativeOpenSettingsResult;
  /** Enumerates installed apps that can handle a generic https:// intent, deduplicated by
   * package, sorted with the current OS default browser first. */
  listHttpsCapableBrowsers(): NativeInstalledBrowser[];
  /** Launches `url` explicitly into `packageName` (never a generic ACTION_VIEW chooser) so the
   * machine-recorded browser identity is provably the app that actually opened the probe. */
  openUrlInBrowserPackage(url: string, packageName: string): NativeOpenUrlInBrowserResult;
  addListener(eventName: string, listener: (payload: unknown) => void): { remove(): void };
}

export const GuardDogNative: GuardDogNativeModule | null = requireOptionalNativeModule<GuardDogNativeModule>("GuardDogSecurity");
