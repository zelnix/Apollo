// Type surface for the platform-split module (MockSecurityAdapter.web.ts / MockSecurityAdapter.native.ts).
import type { SecurityPlatformAdapter } from "./SecurityPlatformAdapter";
export type MockScenario = "NORMAL" | "PERMISSION_DENIED" | "BLOCK_UNVERIFIED" | "PROTECTION_UNAVAILABLE" | "OPEN_WIFI" | "CAPTIVE_PORTAL";
export declare const MockSecurityAdapter: SecurityPlatformAdapter & { scenario: MockScenario; setScenario(s: MockScenario): void };
