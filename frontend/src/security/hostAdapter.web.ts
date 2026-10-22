// Browser host selection. The ordinary web application uses the real browser adapter
// (WebSecurityAdapter: genuine browser capabilities, native capabilities reported unavailable), and
// the Tauri desktop shell uses the desktop adapter. There is no simulated device adapter: when a
// real read cannot be made here, the capability is reported as unreadable, never substituted.
import { SECURITY_CONFIG } from "@/src/config/appEnvironment";
import { validateSecurityConfig } from "./securityConfig";
import type { SecurityPlatformAdapter } from "./SecurityPlatformAdapter";
import { DesktopSecurityAdapter, desktopHostPresent } from "./DesktopSecurityAdapter";
import { chooseWebHostKind, desktopHostKind } from "./desktopHost";
import { WebSecurityAdapter } from "./WebSecurityAdapter";

export function validateHost(): void {
  validateSecurityConfig({
    appEnvironment: SECURITY_CONFIG.appEnvironment,
    androidEnforcementEngine: SECURITY_CONFIG.androidEnforcementEngine,
    hostPlatform: desktopHostPresent() ? "desktop" : "web",
  });
}

export function chooseHostAdapter(): SecurityPlatformAdapter {
  return chooseWebHostKind(desktopHostKind()) === "desktop" ? DesktopSecurityAdapter : WebSecurityAdapter;
}
