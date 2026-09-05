// Application environment — explicit, never inferred from __DEV__.
import { validateSecurityConfig, type AppEnvironment } from "@/src/security/securityConfig";

const validated = validateSecurityConfig({
  appEnvironment: process.env.EXPO_PUBLIC_APP_ENV,
  secureCoreMode: process.env.EXPO_PUBLIC_SECURECORE_MODE,
  securityAdapterMode: process.env.EXPO_PUBLIC_SECURITY_MODE,
});

export const APP_ENV: AppEnvironment = validated.appEnvironment;
export const IS_PRODUCTION = APP_ENV === "production";
export const SECURITY_CONFIG = validated;
