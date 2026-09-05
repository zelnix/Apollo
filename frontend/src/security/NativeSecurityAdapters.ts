// Platform adapters backed by the ApolloSecurity Expo Module.
// Both are thin JSON bridges; all behaviour lives in Swift / Kotlin.
// They fail closed when the module is missing.

import type { Capability } from "@/src/domain/types";
import { getNativeModule, NativeModuleUnavailable } from "./nativeBridge";
import type {
  AdapterKind, BlockResult, NativeUrlAnalysis, NetworkStatus, ProtectionPermission, ProtectionStatus, SecurityPlatformAdapter, SecuritySignal,
} from "./SecurityPlatformAdapter";

class NativeAdapterBase implements SecurityPlatformAdapter {
  constructor(readonly kind: AdapterKind, readonly label: string, private platformName: string) {}

  private mod() {
    const m = getNativeModule();
    if (!m) throw new NativeModuleUnavailable(this.platformName);
    return m;
  }
  private async call<T>(fn: () => Promise<string>): Promise<T> {
    return JSON.parse(await fn()) as T;
  }

  getCapabilities() { return this.call<Capability[]>(() => this.mod().getCapabilities()); }
  getProtectionStatus() { return this.call<ProtectionStatus>(() => this.mod().getProtectionStatus()); }
  analyseURL(url: string) { return this.call<NativeUrlAnalysis>(() => this.mod().analyseURL(url)); }
  analyseDomain(domain: string) { return this.call<NativeUrlAnalysis>(() => this.mod().analyseDomain(domain)); }
  blockDestination(host: string) { return this.call<BlockResult>(() => this.mod().blockDestination(host)); }
  unblockDestination(host: string) { return this.call<BlockResult>(() => this.mod().unblockDestination(host)); }
  getNetworkStatus() { return this.call<NetworkStatus>(() => this.mod().getNetworkStatus()); }
  getSecuritySignals() { return this.call<SecuritySignal[]>(() => this.mod().getSecuritySignals()); }
  startProtection() { return this.call<ProtectionStatus>(() => this.mod().startProtection()); }
  stopProtection() { return this.call<ProtectionStatus>(() => this.mod().stopProtection()); }
  getProtectionPermissions() { return this.call<ProtectionPermission[]>(() => this.mod().getProtectionPermissions()); }
  requestProtectionPermission(id: ProtectionPermission["id"]) { return this.call<ProtectionPermission>(() => this.mod().requestProtectionPermission(id)); }
}

/** Swift-backed adapter (modules/apollo-security/ios). */
export const IOSSecurityAdapter: SecurityPlatformAdapter = new NativeAdapterBase("ios", "iOS security module", "iOS (Swift)");
/** Kotlin-backed adapter (modules/apollo-security/android). */
export const AndroidSecurityAdapter: SecurityPlatformAdapter = new NativeAdapterBase("android", "Android security module", "Android (Kotlin)");
