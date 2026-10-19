// Adapter selector. Application code imports ONLY `securityAdapter` from here.
// The host adapter is chosen by the platform-split module `hostAdapter` (hostAdapter.ts for iOS/Android,
// hostAdapter.web.ts for the browser). Native bundles therefore physically exclude the browser adapter
// and the device-preview harness; a missing native module fails closed via the boot registry
// (securityBoot.ts → SafeStartScreen) instead of crashing module evaluation or selecting a substitute.

import { chooseHostAdapter, validateHost } from "./hostAdapter";
import { selectFailClosed } from "./securityBoot";
import type { SecurityPlatformAdapter } from "./SecurityPlatformAdapter";

export const securityAdapter: SecurityPlatformAdapter = selectFailClosed(validateHost, chooseHostAdapter);

/** True only when the separate development web preview harness supplies simulated device inputs. */
export const IS_PREVIEW_HARNESS = securityAdapter.kind === "preview_harness";
/** True when a real native host backs the adapter: Kotlin/Swift module on mobile, or the Windows/macOS desktop host. */
export const IS_NATIVE_HOST = securityAdapter.kind === "android" || securityAdapter.kind === "ios" || securityAdapter.kind === "windows" || securityAdapter.kind === "macos";
