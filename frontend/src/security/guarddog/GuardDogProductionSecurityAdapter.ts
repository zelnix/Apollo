import type { Capability } from "@/src/domain/types";
import type { DnsThreatObservation, PrivateDnsStatus } from "@/src/domain/types";
import type { EnforcementEvidence, PlatformCapabilityProfile } from "@/src/security/PlatformCapabilityProfile";
import type { BlockResult, NetworkStatus, NativeUrlAnalysis, ProtectionPermission, ProtectionStatus, RuleBundleStatus, SecurityPlatformAdapter } from "@/src/security/SecurityPlatformAdapter";
import { getNativeModule, NativeModuleUnavailable } from "@/src/security/nativeBridge";
import { getDeviceToken } from "@/src/auth/deviceIdentity";
import { notAcceptedSentence, threatDomainListStatus } from "@/src/domain/threatDomainList";
import { parseGuardDogEvidence } from "./GuardDogEvidenceBoundary";
import { getGuardDogProductionConfig } from "./GuardDogProductionConfig";

type ProductionStatus = ProtectionStatus & { ruleExpiresAt?: string | null; productionAuthority?: boolean; bundleVersion?: number | null; threatDomainEntryCount?: number | null };

/** Thrown when this phone's native validator doesn't accept the Threat Domain List. `reason` is the native code. */
class RuleBundleRejectedError extends Error {
  constructor(readonly reason: string) {
    super(notAcceptedSentence(reason));
    this.name = "RuleBundleRejectedError";
  }
}

export class GuardDogProductionSecurityAdapter implements SecurityPlatformAdapter {
  readonly kind = "android" as const;
  readonly label = "GuardDog production website protection";
  private configured: Promise<void> | null = null;
  private refreshedAt = 0;
  /** Last rejection reason from a failed refresh, preserved for diagnostic surfaces. */
  private lastRefreshRejection: string | null = null;
  private mod() { const module = getNativeModule(); if (!module) throw new NativeModuleUnavailable("Android GuardDog production runtime"); return module; }
  private async json<T>(value: Promise<string> | string): Promise<T> { return JSON.parse(await value) as T; }

  /**
   * Call refreshGuardDogProductionRules and CHECK the native result.
   *
   * The native method returns JSON: `{"accepted":true,...,"entryCount":n}` or `{"accepted":false,"reason":"..."}`.
   * A Threat Domain List with zero entries comes back accepted — it is a valid list, never a failure.
   */
  private async refreshAndVerify(): Promise<void> {
    const resultStr = await this.mod().refreshGuardDogProductionRules();
    let result: { accepted?: boolean; reason?: string };
    try { result = JSON.parse(resultStr); } catch { result = {}; }
    if (result.accepted === false) {
      const reason = result.reason || "unknown";
      this.lastRefreshRejection = reason;
      throw new RuleBundleRejectedError(reason);
    }
    // Bundle accepted — clear any previous rejection state.
    this.lastRefreshRejection = null;
    this.refreshedAt = Date.now();
  }

  private ensureConfigured(): Promise<void> {
    if (!this.configured) this.configured = (async () => {
      this.mod().configureGuardDogProduction(JSON.stringify(getGuardDogProductionConfig()));
      // Pass the device bearer token to the native runtime for authenticated live reputation requests.
      try { const token = await getDeviceToken(); if (token) this.mod().setGuardDogDeviceToken(token); } catch { /* non-fatal */ }
      try { await this.refreshAndVerify(); }
      catch (refreshError) {
        // Offline fallback: if rules are still locally valid, don't throw.
        const status = await this.json<ProductionStatus>(this.mod().getGuardDogProductionStatus());
        const now = Date.now();
        const rulesLive = !!status.ruleExpiresAt && Date.parse(status.ruleExpiresAt) > now;
        if (!rulesLive || status.productionAuthority !== true) throw refreshError;
      }
    })().catch((error) => { this.configured = null; throw error; });
    return this.configured;
  }
  private async refreshIfDue(force = false) { await this.ensureConfigured(); if (!force && Date.now() - this.refreshedAt < 15 * 60 * 1000) return;
    try { await this.refreshAndVerify(); }
    catch (error) {
      // Offline fallback: if locally-persisted rules are still valid, swallow the refresh failure.
      const status = await this.json<ProductionStatus>(this.mod().getGuardDogProductionStatus()); const now = Date.now();
      if (!status.ruleExpiresAt || Date.parse(status.ruleExpiresAt) <= now) throw error;
    }
  }
  async getCapabilities(): Promise<Capability[]> { try { await this.refreshIfDue(); return this.json<Capability[]>(this.mod().getGuardDogProductionCapabilities()); }
    catch (error) {
      // A Threat Domain List problem says what it is — it is never reported as a missing permission.
      const rejection = this.lastRefreshRejection;
      const reason = rejection ? notAcceptedSentence(rejection)
        : error instanceof Error && error.message ? error.message : "ApolloSG couldn't tell why.";
      return [{ id: "site_guard", title: "Website protection", status: "inactive",
        detail: `Website protection isn't on yet. ${reason}` }];
    } }
  async getProtectionStatus(): Promise<ProtectionStatus> { try { await this.refreshIfDue(); return this.json<ProtectionStatus>(this.mod().getGuardDogProductionStatus()); }
    catch (error) {
      const degradedReason = error instanceof Error ? error.message : "ApolloSG couldn't get its Threat Domain List.";
      // The runtime's own state is still readable without a current list: report what it actually says
      // (requested or not, running or not) rather than assuming protection had been turned on.
      try { return { ...await this.json<ProtectionStatus>(this.mod().getGuardDogProductionStatus()), degradedReason }; }
      catch { const checkedAt = new Date().toISOString(); return { running: false, requested: true, operational: false, enforcementMethod: "none", coverage: "Production protection is inactive. ApolloSG did not fall back to a legacy or test engine.", coverageScope: [], lastVerified: null, degradedReason, visibility: "none", since: null, adapterLabel: this.label, checkedAt }; } } }
  async analyseURL(url: string) { await this.ensureConfigured(); return this.json<NativeUrlAnalysis>(this.mod().analyzeGuardDogProductionUrl(url)); }
  analyseDomain(domain: string) { return this.analyseURL(`https://${domain}/`); }
  blockDestination(): Promise<BlockResult> { return Promise.resolve({ verified: false, method: "none", detail: "Production rules are server-managed; manual blocking is unavailable.", adapterLabel: this.label, blockedAt: null, evidence: null }); }
  unblockDestination(): Promise<BlockResult> { return Promise.resolve({ verified: false, method: "none", detail: "Production rules are server-managed; manual unblocking is unavailable.", adapterLabel: this.label, blockedAt: null, evidence: null }); }
  async getNetworkStatus(): Promise<NetworkStatus> {
    // Dedicated production native method — reads OS ConnectivityManager and derives
    // vpnActive from GuardDog production VPN state, never from the legacy DNS service.
    return this.json<NetworkStatus>(this.mod().getGuardDogProductionNetworkStatus());
  }
  getSecuritySignals() { return Promise.resolve([]); }
  async startProtection() {
    await this.refreshIfDue(true);
    // Pre-flight: confirm the native runtime actually has a current bundle before
    // calling startGuardDogProduction(). Previously, a silently-rejected refresh
    // would pass here and then the native start() would throw the generic
    // "Production rule bundle is unavailable or expired" — hiding the real cause.
    const preCheck = await this.json<ProductionStatus>(this.mod().getGuardDogProductionStatus());
    if (!preCheck.ruleExpiresAt || Date.parse(preCheck.ruleExpiresAt) <= Date.now()) {
      const rejection = this.lastRefreshRejection;
      const detail = rejection
        ? `${notAcceptedSentence(rejection)} Website protection can't start until it has a list it can trust.`
        : "ApolloSG couldn't get its Threat Domain List, so website protection can't start yet. Check this phone is online, then try again.";
      throw new Error(detail);
    }
    return this.json<ProtectionStatus>(this.mod().startGuardDogProduction());
  }
  stopProtection() { return this.json<ProtectionStatus>(this.mod().stopGuardDogProduction()); }
  async getProtectionPermissions(): Promise<ProtectionPermission[]> {
    // Dedicated production native method — same OS permission observations with
    // production-accurate descriptions (selective packet filter, not DNS filter).
    return this.json<ProtectionPermission[]>(this.mod().getGuardDogProductionProtectionPermissions());
  }
  async requestProtectionPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission> {
    // Dedicated production native method — same OS permission requests with
    // production-accurate descriptions.
    return this.json<ProtectionPermission>(this.mod().requestGuardDogProductionProtectionPermission(id));
  }
  getPlatformCapabilityProfile(): Promise<PlatformCapabilityProfile> { return Promise.resolve({ platform: "android", platformVersion: null,
    sdkVersion: "guarddog-production-authority", capabilityVersion: "1", networkFiltering: "partial", packetVisibility: "partial", dnsVisibility: "partial",
    processAttribution: "none", appAttribution: "none", domainVisibility: "partial", localBlocking: "partial", backgroundProtection: "full",
    offlineProtection: "partial", realTimeEvents: "partial", scope: ["dns:ipv4-udp-53", "ip:controlled-/32", "ip:website-gate-sinkhole-/32"] }); }
  // Evidence and DNS threat observations are read from the runtime's own inboxes. Neither depends on the
  // Threat Domain List, so a list problem never stops them being read.
  async getEnforcementEvidence(): Promise<EnforcementEvidence[]> { return parseGuardDogEvidence(this.mod().getGuardDogProductionEvidence()); }
  async acknowledgeEnforcementEvidence(evidenceIds: string[]) {
    const result = await this.json<{ persistenceError?: string | null }>(this.mod().acknowledgeGuardDogProductionEvidence(JSON.stringify(evidenceIds)));
    if (result.persistenceError) throw new Error(result.persistenceError);
  }

  // ── DNS Threat Observations (separate from enforcement evidence) ──────────
  async getDnsThreatObservations(): Promise<DnsThreatObservation[]> {
    // A failed read is NOT "no threats observed" — it propagates so the caller can report the gap.
    return JSON.parse(this.mod().getGuardDogDnsThreatObservations());
  }
  async acknowledgeDnsThreatObservations(ids: string[]): Promise<void> {
    this.mod().acknowledgeGuardDogDnsThreatObservations(JSON.stringify(ids));
  }

  // ── Private DNS / DoH gap detection ──────────────────────────────────────
  // Android's own setting, read directly. It has nothing to do with the Threat Domain List, so a list
  // problem never turns this into "couldn't read".
  async getPrivateDnsStatus(): Promise<PrivateDnsStatus> {
    try { return JSON.parse(this.mod().getGuardDogPrivateDnsStatus()); }
    catch (error) {
      // Unobservable, not "off" and not "not in use": Apollo states that it could not read the setting and why.
      const reason = error instanceof Error && error.message ? error.message : "the reason could not be determined";
      return { privateDnsActive: false, privateDnsServer: null, mode: "unknown", modeSource: null, bypassLevel: "unobservable", chromeDoH: "unobservable",
        explanation: `Apollo couldn't read this device's Private DNS setting (${reason}). This is not a confirmation that Private DNS is off.` };
    }
  }

  // ── Threat Domain List state ──────────────────────────────────────────────
  // Read from the production runtime's own status. A failed read is reported as unknown — never as
  // "current" — and the expiry the runtime reports is the only thing that decides currency. A list with
  // zero entries is current like any other.
  async getRuleBundleStatus(): Promise<RuleBundleStatus> {
    try {
      await this.ensureConfigured();
      const status = await this.json<ProductionStatus>(this.mod().getGuardDogProductionStatus());
      return threatDomainListStatus(status, this.lastRefreshRejection);
    } catch (error) {
      const rejection = this.lastRefreshRejection;
      const reason = rejection ? notAcceptedSentence(rejection)
        : `ApolloSG couldn't check its Threat Domain List just now${error instanceof Error && error.message ? ` (${error.message})` : ""}.`;
      return { observable: true, current: null, expiresAt: null, entryCount: null,
        detail: `${reason} This isn't a confirmation that it's current.` };
    }
  }

  // ── Urgent rule refresh trigger (from Link Gate intelligence) ─────────────
  async triggerUrgentRuleRefresh(): Promise<void> {
    // The caller decides what to do when an urgent refresh cannot be triggered; it isn't hidden here.
    this.mod().triggerGuardDogUrgentRefresh();
  }
}