import type { Capability } from "@/src/domain/types";
import type { EnforcementEvidence, PlatformCapabilityProfile } from "@/src/security/PlatformCapabilityProfile";
import type { BlockResult, NativeUrlAnalysis, ProtectionStatus, SecurityPlatformAdapter } from "@/src/security/SecurityPlatformAdapter";
import { AndroidSecurityAdapter } from "@/src/security/NativeSecurityAdapters";
import { getNativeModule, NativeModuleUnavailable } from "@/src/security/nativeBridge";
import { getGuardDogCandidateConfig } from "./GuardDogCandidateConfig";
import { parseGuardDogCandidateEvidence } from "./GuardDogEvidenceBoundary";

export class GuardDogSecurityAdapter implements SecurityPlatformAdapter {
  readonly kind = "android" as const;
  readonly label = "GuardDog acceptance runtime (test-only)";
  private configured: Promise<void> | null = null;
  private mod() { const value = getNativeModule(); if (!value) throw new NativeModuleUnavailable("Android GuardDog candidate"); return value; }
  private async json<T>(value: Promise<string> | string): Promise<T> { return JSON.parse(await value) as T; }
  private ensureConfigured() {
    if (!this.configured) this.configured = (async () => {
      const config = getGuardDogCandidateConfig();
      await this.mod().configureGuardDogCandidate(JSON.stringify({ ...config, signedBundle: undefined }));
      const result = await this.json<{ accepted: boolean; reason?: string }>(this.mod().acceptGuardDogCandidateBundle(config.signedBundle));
      if (!result.accepted) throw new Error(`GuardDog signed bundle rejected: ${result.reason ?? "unknown"}`);
    })();
    return this.configured;
  }
  getCapabilities() { return this.json<Capability[]>(this.mod().getGuardDogCandidateCapabilities()); }
  getProtectionStatus() { return this.json<ProtectionStatus>(this.mod().getGuardDogCandidateStatus()); }
  async analyseURL(url: string) { await this.ensureConfigured(); return this.json<NativeUrlAnalysis>(this.mod().analyzeGuardDogCandidateUrl(url)); }
  analyseDomain(domain: string) { return this.analyseURL(`https://${domain}/`); }
  blockDestination(): Promise<BlockResult> { return Promise.resolve({ verified: false, method: "none", detail: "Candidate rules are signed; manual blocking is unavailable.", adapterLabel: this.label, blockedAt: null, evidence: null }); }
  unblockDestination(): Promise<BlockResult> { return Promise.resolve({ verified: false, method: "none", detail: "Candidate rules are signed; manual unblocking is unavailable.", adapterLabel: this.label, blockedAt: null, evidence: null }); }
  getNetworkStatus() { return AndroidSecurityAdapter.getNetworkStatus(); }
  getSecuritySignals() { return Promise.resolve([]); }
  async startProtection() { await this.ensureConfigured(); return this.json<ProtectionStatus>(this.mod().startGuardDogCandidate()); }
  stopProtection() { return this.json<ProtectionStatus>(this.mod().stopGuardDogCandidate()); }
  getProtectionPermissions() { return AndroidSecurityAdapter.getProtectionPermissions(); }
  requestProtectionPermission(id: Parameters<SecurityPlatformAdapter["requestProtectionPermission"]>[0]) { return AndroidSecurityAdapter.requestProtectionPermission(id); }
  getPlatformCapabilityProfile(): Promise<PlatformCapabilityProfile> { return Promise.resolve({ platform: "android", platformVersion: null,
    sdkVersion: "guarddog-stage1d-candidate", capabilityVersion: "1", networkFiltering: "partial", packetVisibility: "partial",
    dnsVisibility: "none", processAttribution: "none", appAttribution: "none", domainVisibility: "partial", localBlocking: "partial",
    backgroundProtection: "full", offlineProtection: "partial", realTimeEvents: "partial", scope: ["ip:controlled-/32"] }); }
  async getEnforcementEvidence(): Promise<EnforcementEvidence[]> { return parseGuardDogCandidateEvidence(await this.mod().getGuardDogCandidateEvidence()); }
  async acknowledgeEnforcementEvidence(evidenceIds: string[]) {
    const result = await this.json<{ persistenceError?: string | null }>(this.mod().acknowledgeGuardDogCandidateEvidence(JSON.stringify(evidenceIds)));
    if (result.persistenceError) throw new Error(result.persistenceError);
  }
}