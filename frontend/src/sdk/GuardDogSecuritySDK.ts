// Public SDK boundary (frozen). The app only ever uses:
//   GuardDogSecuritySDK.requestPermission("vpn"), GuardDogSecuritySDK.startProtection(), ...
// No Android-only APIs are exposed. Platform orchestration lives in the native bridge.
//
// Truthfulness: this class never fabricates events. Every native event is validated with
// validateSecurityEvent(); THREAT_BLOCKED without enforcement evidence is dropped and counted.
import { Platform } from "react-native";

import {
  ANDROID_M1_CAPABILITY_PROFILE,
  ANDROID_M2_CAPABILITIES,
  type PlatformCapabilityProfile,
  type ProtectionCapabilities,
  IOS_M1_CAPABILITIES,
  NO_ENFORCEMENT_CAPABILITIES,
  validateCapabilities,
} from "@/src/contracts/shared/capabilities.ts";
import { findRuleForHost, type SignedRuleBundle, validateSignedBundleShape } from "@/src/contracts/shared/ruleBundle.ts";
import type { WebsiteGateOverrideRecord } from "@/src/contracts/shared/websiteGateOverrides.ts";
import { type ProtectionState, type SecurityEvent, validateSecurityEvent } from "@/src/contracts/securityEventSchemas";
import { sanitizeUrl } from "@/src/contracts/urlSanitization";
import { GuardDogNative, type NativeProtectionState, type NativeWebsiteGateStatus } from "@/src/sdk/nativeModule";
import {
  addWebsiteGateOverride,
  clearWebsiteGateOverrides as clearPersistedWebsiteGateOverrides,
  getWebsiteGateOverrides as getPersistedWebsiteGateOverrides,
  removeWebsiteGateOverride as removePersistedWebsiteGateOverride,
} from "@/src/sdk/websiteGateOverrides";

export type PermissionKind = "vpn";
export type PermissionOutcome = "granted" | "denied" | "unsupported";

export interface ProtectionStatus {
  state: ProtectionState;
  consentGranted: boolean;
  reason?: string | null;
  updatedAt: string;
  /** false when running without the native module (Expo Go / web): nothing is enforced. */
  nativeAvailable: boolean;
}

export interface ProtectionConfig {
  controlledHost: string;
  controlledIpv4: string;
  controlledUrl: string;
  rulesetId: string;
  dedupeWindowMs: number;
}

export interface BundleAcceptance {
  accepted: boolean;
  rejectReason?: string | null;
  bundleVersion?: number | null;
  rulesetId?: string | null;
  keyId?: string | null;
  /** true only when the native verifier (Ed25519/JCS/rollback) ran. */
  verifiedNatively: boolean;
}

export interface LocalAnalysis {
  sanitizedUrl: string;
  host: string;
  verdict: "block" | "allow" | "unknown";
  ruleId: string | null;
}

// --- Gate Guard M2.1 Phase 5: Website Gate types. Additive only. ---

export interface WebsiteGateConfig {
  /** Real upstream DNS resolver Apollo forwards non-block queries to. Omit/null to fail open by
   * silence (no forwarding) rather than fabricate an allow answer. */
  upstreamDnsResolverIpv4?: string | null;
  bindingLifetimeMs?: number;
}

export interface WebsiteGateStatus extends NativeWebsiteGateStatus {
  /** false when running without the native module (Expo Go / web): nothing is enforced, this is a
   * truthful "not configured / not active" snapshot, never fabricated as active. */
  nativeAvailable: boolean;
}

const WEBSITE_GATE_INACTIVE_STATUS: NativeWebsiteGateStatus = {
  configured: false,
  dnsGatewayActive: false,
  acceptedRulesetId: null,
  acceptedBundleVersion: null,
  acceptedKeyId: null,
  overrideCount: 0,
};

type Listener = (event: SecurityEvent) => void;

class GuardDogSecuritySDKImpl {
  private listeners = new Set<Listener>();
  private nativeSubscription: { remove(): void } | null = null;
  private shapeOnlyBundle: SignedRuleBundle | null = null;
  private fallbackState: ProtectionStatus = {
    state: "INACTIVE",
    consentGranted: false,
    reason: GuardDogNative ? null : "native module unavailable (Expo Go / web): no enforcement possible",
    updatedAt: new Date().toISOString(),
    nativeAvailable: !!GuardDogNative,
  };
  /** Count of native payloads refused by validation (visible in the harness). */
  rejectedEventCount = 0;

  get nativeAvailable(): boolean {
    return !!GuardDogNative;
  }

  getCapabilities(): ProtectionCapabilities {
    if (GuardDogNative) {
      const caps = validateCapabilities(GuardDogNative.getCapabilities());
      if (caps) return caps;
    }
    return Platform.OS === "ios" ? IOS_M1_CAPABILITIES : { ...NO_ENFORCEMENT_CAPABILITIES, platform: Platform.OS === "android" ? "android" : "web" };
  }

  configure(config: ProtectionConfig): void {
    GuardDogNative?.configure(config);
  }

  acceptRuleBundle(bundle: unknown): BundleAcceptance {
    const shaped = validateSignedBundleShape(bundle);
    if (!shaped) return { accepted: false, rejectReason: "SCHEMA_INVALID", verifiedNatively: false };
    if (GuardDogNative) {
      const r = GuardDogNative.acceptRuleBundle(JSON.stringify(shaped));
      return { ...r, verifiedNatively: true };
    }
    // Without the native verifier we can only check shape; never treat this as trust.
    this.shapeOnlyBundle = shaped;
    return { accepted: false, rejectReason: "NATIVE_VERIFIER_UNAVAILABLE", bundleVersion: shaped.bundleVersion, rulesetId: shaped.rulesetId, keyId: shaped.keyId, verifiedNatively: false };
  }

  analyzeUrl(url: string): LocalAnalysis | null {
    if (GuardDogNative) {
      const r = GuardDogNative.analyzeUrl(url);
      return r ? { sanitizedUrl: r.sanitizedUrl, host: r.host, verdict: r.verdict as LocalAnalysis["verdict"], ruleId: r.ruleId } : null;
    }
    const parsed = sanitizeUrl(url);
    if (!parsed) return null;
    const rule = this.shapeOnlyBundle ? findRuleForHost(this.shapeOnlyBundle, parsed.host) : null;
    return { sanitizedUrl: parsed.sanitizedUrl, host: parsed.host, verdict: rule?.action ?? "unknown", ruleId: rule?.ruleId ?? null };
  }

  async requestPermission(kind: PermissionKind): Promise<PermissionOutcome> {
    if (!GuardDogNative) return "unsupported";
    return GuardDogNative.requestPermission(kind);
  }

  async startProtection(): Promise<ProtectionStatus> {
    if (!GuardDogNative) return this.fallbackState;
    return this.toStatus(await GuardDogNative.startProtection());
  }

  async stopProtection(): Promise<ProtectionStatus> {
    if (!GuardDogNative) return this.fallbackState;
    return this.toStatus(await GuardDogNative.stopProtection());
  }

  getProtectionState(): ProtectionStatus {
    return GuardDogNative ? this.toStatus(GuardDogNative.getProtectionState()) : this.fallbackState;
  }

  getEnforcementStats(): Record<string, number> | null {
    return GuardDogNative?.getEnforcementStats() ?? null;
  }

  // --- Gate Guard M2.1 Phase 5: Website Gate bridge surface + local override store. Additive only;
  // none of the M1 methods above are touched. See docs/M2_WEBSITE_GATE_DESIGN.md. ---

  configureWebsiteGate(config: WebsiteGateConfig = {}): void {
    GuardDogNative?.configureWebsiteGate({
      upstreamDnsResolverIpv4: config.upstreamDnsResolverIpv4 ?? null,
      bindingLifetimeMs: config.bindingLifetimeMs ?? 30_000,
    });
  }

  acceptWebsiteGateRuleBundle(bundle: unknown): BundleAcceptance {
    const shaped = validateSignedBundleShape(bundle);
    if (!shaped) return { accepted: false, rejectReason: "SCHEMA_INVALID", verifiedNatively: false };
    if (GuardDogNative) {
      const r = GuardDogNative.acceptWebsiteGateRuleBundle(JSON.stringify(shaped));
      return { ...r, verifiedNatively: true };
    }
    return {
      accepted: false,
      rejectReason: "NATIVE_VERIFIER_UNAVAILABLE",
      bundleVersion: shaped.bundleVersion,
      rulesetId: shaped.rulesetId,
      keyId: shaped.keyId,
      verifiedNatively: false,
    };
  }

  /** Truthful, live snapshot -- `dnsGatewayActive` is exactly the native runtime flag, never assumed
   * from configuration alone (see GuardDogExpoAdapters.toWebsiteGateStatus). */
  getWebsiteGateStatus(): WebsiteGateStatus {
    if (!GuardDogNative) return { ...WEBSITE_GATE_INACTIVE_STATUS, nativeAvailable: false };
    return { ...GuardDogNative.getWebsiteGateStatus(), nativeAvailable: true };
  }

  /**
   * Truthful capability reporting for the Website Gate: `ANDROID_M2_CAPABILITIES` (dnsVisibility/
   * domainVisibility) is only ever returned while a live TUN session has actually built the DNS
   * gateway pipeline (`dnsGatewayActive === true`) -- never merely because this app version supports
   * it. Returns `null` on any platform/runtime where the Website Gate does not apply (iOS, web, Expo
   * Go) -- an honest "not applicable" rather than a fabricated M1 or M2 claim.
   */
  getPlatformCapabilityProfile(): PlatformCapabilityProfile | null {
    if (Platform.OS !== "android" || !GuardDogNative) return null;
    return GuardDogNative.getWebsiteGateStatus().dnsGatewayActive ? ANDROID_M2_CAPABILITIES : ANDROID_M1_CAPABILITY_PROFILE;
  }

  /**
   * Local, reversible, auditable ALLOW-only override (see contracts/shared/websiteGateOverrides.ts).
   * Persists the durable JS record FIRST, then mirrors it into the native runtime cache; can only
   * ever prevent a sinkhole the signed rule bundle would otherwise arm for `host` -- it never itself
   * arms a binding or produces a THREAT_BLOCKED. Returns false if `host` fails canonicalization
   * (nothing is persisted or pushed natively).
   */
  async setWebsiteGateAllowOverride(host: string): Promise<boolean> {
    const persisted = await addWebsiteGateOverride(host);
    if (!persisted) return false;
    return GuardDogNative?.setWebsiteGateAllowOverride({ host, allowed: true }) ?? true;
  }

  /** Fully reversible: removes the override for `host` from both the durable record and the native
   * runtime cache. Restores whatever the signed rule bundle already says for that host. */
  async removeWebsiteGateAllowOverride(host: string): Promise<void> {
    await removePersistedWebsiteGateOverride(host);
    GuardDogNative?.setWebsiteGateAllowOverride({ host, allowed: false });
  }

  /** The durable, audited list (host, type, source, decidedAt) -- the source of truth across app
   * restarts. The native module's own `getWebsiteGateOverrides()` only returns bare hostnames from
   * its ephemeral session cache; this is the richer, persisted record. */
  async getWebsiteGateOverrides(): Promise<WebsiteGateOverrideRecord[]> {
    return getPersistedWebsiteGateOverrides();
  }

  /** Clears every persisted override AND the native runtime cache. */
  async clearWebsiteGateOverrides(): Promise<void> {
    await clearPersistedWebsiteGateOverrides();
    GuardDogNative?.clearWebsiteGateOverrides();
  }

  /**
   * Re-hydrates the native, in-memory override cache from the durable JS record store. The native
   * cache never persists across process death (see `MutableWebsiteGateOverrideStore` doc comment) --
   * call this once per bridge session, e.g. right after `configureWebsiteGate()`. A no-op without the
   * native module.
   */
  async hydrateWebsiteGateOverrides(): Promise<void> {
    if (!GuardDogNative) return;
    const records = await getPersistedWebsiteGateOverrides();
    for (const record of records) GuardDogNative.setWebsiteGateAllowOverride({ host: record.host, allowed: true });
  }

  onSecurityEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    this.ensureNativeSubscription();
    return () => this.listeners.delete(listener);
  }

  private ensureNativeSubscription() {
    if (this.nativeSubscription || !GuardDogNative) return;
    this.nativeSubscription = GuardDogNative.addListener("onSecurityEvent", (payload) => {
      const result = validateSecurityEvent(payload);
      if (!result.ok) {
        this.rejectedEventCount++;
        return;
      }
      this.listeners.forEach((l) => l(result.event));
    });
  }

  private toStatus(s: NativeProtectionState): ProtectionStatus {
    return { state: s.state as ProtectionState, consentGranted: s.consentGranted, reason: s.reason, updatedAt: s.updatedAt, nativeAvailable: true };
  }
}

export const GuardDogSecuritySDK = new GuardDogSecuritySDKImpl();
