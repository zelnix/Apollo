// Native bundles never contain the simulated adapter (spec AR-11 / R-isolation). Metro resolves `.web.ts` for the browser preview
// and this fail-closed stub for iOS/Android, so no activation path to simulated device inputs exists in a native build.
import { SecurityConfigurationError } from "./securityConfig";
import type { SecurityPlatformAdapter } from "./SecurityPlatformAdapter";

export const MockSecurityAdapter = new Proxy({} as SecurityPlatformAdapter & { scenario: string; setScenario(s: string): void }, {
  get(_target, property) {
    if (property === "kind") return "mock";
    if (property === "label") return "MOCK adapter unavailable in native builds";
    if (property === "scenario") return "UNAVAILABLE";
    throw new SecurityConfigurationError("The simulated security adapter is not part of native builds. Use EXPO_PUBLIC_SECURITY_MODE=native.");
  },
});
