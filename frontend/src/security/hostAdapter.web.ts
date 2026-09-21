// Browser host selection. The ordinary web application uses the real browser adapter
// (WebSecurityAdapter: genuine browser capabilities, native capabilities reported unavailable).
// The device-preview harness is the ONLY permitted source of simulated device inputs and is reachable
// solely through the build-time literal `EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS === "enabled"` below, which
// Metro inlines at bundle time: ordinary web bundles (flag unset) contain a dead branch that release
// minification removes, and securityConfig rejects the flag outside development.
import { SECURITY_CONFIG } from "@/src/config/appEnvironment";
import { validateSecurityConfig } from "./securityConfig";
import type { SecurityPlatformAdapter } from "./SecurityPlatformAdapter";
import { DesktopSecurityAdapter, desktopHostPresent } from "./DesktopSecurityAdapter";
import { WebSecurityAdapter } from "./WebSecurityAdapter";

export function validateHost(): void {
  validateSecurityConfig({
    appEnvironment: SECURITY_CONFIG.appEnvironment,
    androidEnforcementEngine: SECURITY_CONFIG.androidEnforcementEngine,
    devicePreviewHarness: SECURITY_CONFIG.devicePreviewHarness,
    hostPlatform: "web",
  });
}

export function chooseHostAdapter(): SecurityPlatformAdapter {
  if (process.env.EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS === "enabled" && SECURITY_CONFIG.devicePreviewHarness === "enabled") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const harness = require("../../tools/preview-device-harness/PreviewDeviceAdapter") as typeof import("../../tools/preview-device-harness/PreviewDeviceAdapter");
    return harness.PreviewDeviceAdapter;
  }
  // Inside the Windows/macOS desktop shell (/desktop, Tauri) the web bundle talks to the real host through typed commands.
  if (desktopHostPresent()) return DesktopSecurityAdapter;
  return WebSecurityAdapter;
}
