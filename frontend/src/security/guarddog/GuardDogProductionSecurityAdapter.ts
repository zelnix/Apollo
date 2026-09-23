import type { Capability } from "@/src/domain/types";
import type { EnforcementEvidence, PlatformCapabilityProfile } from "@/src/security/PlatformCapabilityProfile";
import type { BlockResult, NativeUrlAnalysis, ProtectionStatus, SecurityPlatformAdapter } from "@/src/security/SecurityPlatformAdapter";
import { AndroidSecurityAdapter } from "@/src/security/NativeSecurityAdapters";
import { getNativeModule, NativeModuleUnavailable } from "@/src/security/nativeBridge";
import { parseGuardDogCandidateEvidence } from "./GuardDogEvidenceBoundary";
import { getGuardDogProductionConfig } from "./GuardDogProductionConfig";

type ProductionStatus = ProtectionStatus & { trustExpiresAt?: string | null; ruleExpiresAt?: string | null; productionAuthority?: boolean };

export class GuardDogProductionSecurityAdapter implements SecurityPlatformAdapter {
  readonly kind = "android" as const;
  readonly label = "GuardDog production Website Gate";
  private configured: Promise<void> | null = null;
  private refreshedAt = 0;
  private mod() { const module = getNativeModule(); if (!module) throw new NativeModuleUnavailable("Android GuardDog production authority"); return module; }
  private async json<T>(value: Promise<string> | string): Promise<T> { return JSON.parse(await value) as T; }
  private ensureConfigured(): Promise<void> {
    if (!this.configured) this.configured = (async () => {
      this.mod().configureGuardDogProduction(JSON.stringify(getGuardDogProductionConfig()));
      try { await this.mod().refreshGuardDogProductionAuthority(); this.refreshedAt = Date.now(); }
      catch (refreshError) {
        const status = await this.json<ProductionStatus>(this.mod().getGuardDogProductionStatus());
        const now = Date.now(); const trustLive = !!status.trustExpiresAt && Date.parse(status.trustExpiresAt) > now;
        const rulesLive = !!status.ruleExpiresAt && Date.parse(status.ruleExpiresAt) > now;
        if (!trustLive || !rulesLive || status.productionAuthority !== true) throw refreshError;
      }
    })().catch((error) => { this.configured = null; throw error; });
    return this.configured;
  }
  private async refreshIfDue(force = false) { await this.ensureConfigured(); if (!force && Date.now() - this.refreshedAt < 15 * 60 * 1000) return;
    try { await this.mod().refreshGuardDogProductionAuthority(); this.refreshedAt = Date.now(); }
    catch (error) { const status = await this.json<ProductionStatus>(this.mod().getGuardDogProductionStatus()); const now = Date.now();
      if (!status.trustExpiresAt || !status.ruleExpiresAt || Date.parse(status.trustExpiresAt) <= now || Date.parse(status.ruleExpiresAt) <= now) throw error; }
  }
  async getCapabilities(): Promise<Capability[]> { try { await this.refreshIfDue(); return this.json<Capability[]>(this.mod().getGuardDogProductionCapabilities()); }
    catch { return [{ id: "site_guard", title: "Site Gate", status: "permission_required", detail: "Production protection is inactive because its signed authority is missing, invalid or expired." }]; } }
  async getProtectionStatus(): Promise<ProtectionStatus> { try { await this.refreshIfDue(); return this.json<ProtectionStatus>(this.mod().getGuardDogProductionStatus()); }
    catch (error) { const checkedAt = new Date().toISOString(); return { running: false, requested: true, operational: false, enforcementMethod: "none", coverage: "Production protection is inactive. Apollo did not fall back to a legacy or test engine.", coverageScope: [], lastVerified: null, degradedReason: error instanceof Error ? error.message : "Signed production authority is unavailable.", visibility: "none", since: null, adapterLabel: this.label, checkedAt }; } }
  async analyseURL(url: string) { await this.ensureConfigured(); return this.json<NativeUrlAnalysis>(this.mod().analyzeGuardDogProductionUrl(url)); }
  analyseDomain(domain: string) { return this.analyseURL(`https://${domain}/`); }
  blockDestination(): Promise<BlockResult> { return Promise.resolve({ verified: false, method: "none", detail: "Production rules are signed; manual blocking is unavailable.", adapterLabel: this.label, blockedAt: null, evidence: null }); }
  unblockDestination(): Promise<BlockResult> { return Promise.resolve({ verified: false, method: "none", detail: "Production rules are signed; manual unblocking is unavailable.", adapterLabel: this.label, blockedAt: null, evidence: null }); }
  getNetworkStatus() { return AndroidSecurityAdapter.getNetworkStatus(); }
  getSecuritySignals() { return Promise.resolve([]); }
  async startProtection() { await this.refreshIfDue(true); return this.json<ProtectionStatus>(this.mod().startGuardDogProduction()); }
  stopProtection() { return this.json<ProtectionStatus>(this.mod().stopGuardDogProduction()); }
  getProtectionPermissions() { return AndroidSecurityAdapter.getProtectionPermissions(); }
  requestProtectionPermission(id: Parameters<SecurityPlatformAdapter["requestProtectionPermission"]>[0]) { return AndroidSecurityAdapter.requestProtectionPermission(id); }
  getPlatformCapabilityProfile(): Promise<PlatformCapabilityProfile> { return Promise.resolve({ platform: "android", platformVersion: null,
    sdkVersion: "guarddog-production-authority", capabilityVersion: "1", networkFiltering: "partial", packetVisibility: "partial", dnsVisibility: "partial",
    processAttribution: "none", appAttribution: "none", domainVisibility: "partial", localBlocking: "partial", backgroundProtection: "full",
    offlineProtection: "partial", realTimeEvents: "partial", scope: ["dns:ipv4-udp-53", "ip:controlled-/32", "ip:website-gate-sinkhole-/32"] }); }
  async getEnforcementEvidence(): Promise<EnforcementEvidence[]> { await this.ensureConfigured(); return parseGuardDogCandidateEvidence(this.mod().getGuardDogProductionEvidence()); }
  async acknowledgeEnforcementEvidence(evidenceIds: string[]) {
    const result = await this.json<{ persistenceError?: string | null }>(this.mod().acknowledgeGuardDogProductionEvidence(JSON.stringify(evidenceIds)));
    if (result.persistenceError) throw new Error(result.persistenceError);
  }
}