// Adapter selector. Application code imports ONLY `securityAdapter` from here.
// Mode is an explicit build-time setting (EXPO_PUBLIC_SECURITY_MODE=mock|native),
// never inferred from __DEV__. Production requires native (securityConfig.ts);
// native mode fails closed if the module is missing — recorded on the boot registry
// (securityBoot.ts → SafeStartScreen) instead of crashing module evaluation.

import { Platform } from "react-native";

import { SECURITY_CONFIG } from "@/src/config/appEnvironment";
import { MockSecurityAdapter } from "./MockSecurityAdapter";
import { getNativeModule } from "./nativeBridge";
import { AndroidSecurityAdapter, IOSSecurityAdapter } from "./NativeSecurityAdapters";
import { GuardDogSecurityAdapter } from "./guarddog/GuardDogSecurityAdapter";
import { selectFailClosed } from "./securityBoot";
import { validateSecurityConfig, SecurityConfigurationError, type SecurityMode } from "./securityConfig";
import type { SecurityPlatformAdapter } from "./SecurityPlatformAdapter";

export type { SecurityMode };
export const SECURITY_MODE: SecurityMode = SECURITY_CONFIG.securityAdapterMode;
export const IS_MOCK_SECURITY = SECURITY_MODE === "mock";

function selectAdapter(): SecurityPlatformAdapter {
  return selectFailClosed(
    () => validateSecurityConfig({
      appEnvironment: SECURITY_CONFIG.appEnvironment, secureCoreMode: SECURITY_CONFIG.secureCoreMode, securityAdapterMode: SECURITY_MODE,
      androidEnforcementEngine: SECURITY_CONFIG.androidEnforcementEngine,
      nativeSecurityAdapterAvailable: SECURITY_MODE === "native" ? getNativeModule() != null : undefined,
    }),
    () => {
      if (SECURITY_MODE === "mock") return MockSecurityAdapter;
      if (Platform.OS === "ios") return IOSSecurityAdapter;
      if (Platform.OS === "android") return SECURITY_CONFIG.androidEnforcementEngine === "guarddog_acceptance"
        ? new GuardDogSecurityAdapter() : AndroidSecurityAdapter;
      throw new SecurityConfigurationError(`Apollo native security is not supported on platform "${Platform.OS}".`);
    },
  );
}

export const securityAdapter: SecurityPlatformAdapter = selectAdapter();
