// Public SDK boundary (frozen). The app only ever uses:
//   GuardDogSecuritySDK.requestPermission("vpn"), GuardDogSecuritySDK.startProtection(), ...
// No Android-only APIs are exposed. Platform orchestration lives in the native bridge.
//
// Truthfulness: this class never fabricates events. Every native event is validated with
// validateSecurityEvent(); THREAT_BLOCKED without enforcement evidence is dropped and counted.
import { Platform } from "react-native";

import { type ProtectionCapabilities, IOS_M1_CAPABILITIES, NO_ENFORCEMENT_CAPABILITIES, validateCapabilities } from "@/src/contracts/shared/capabilities.ts";
import { findRuleForHost, type SignedRuleBundle, validateSignedBundleShape } from "@/src/contracts/shared/ruleBundle.ts";
import { type ProtectionState, type SecurityEvent, validateSecurityEvent } from "@/src/contracts/securityEventSchemas";
import { sanitizeUrl } from "@/src/contracts/urlSanitization";
import { GuardDogNative, type NativeProtectionState } from "@/src/sdk/nativeModule";

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
