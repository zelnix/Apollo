// Gate Guard M2.1 Phase 6: harness-only device provenance for the physical-device acceptance report
// (docs/M2_PHASE6_ACCEPTANCE_TEMPLATE.md). NOT part of the public GuardDogSecuritySDK surface --
// same pattern as buildProvenance.ts.
import { GuardDogNative, type NativePhase6DeviceProvenance } from "@/src/sdk/nativeModule";

export interface Phase6DeviceProvenance extends NativePhase6DeviceProvenance {
  /** true when this came from a real native module call; false means placeholder data (web/Expo Go --
   * this milestone's native DNS/VPN path cannot be validated there at all). */
  nativeAvailable: boolean;
}

const PLACEHOLDER: NativePhase6DeviceProvenance = {
  manufacturer: "unavailable (no native module -- web/Expo Go)",
  model: "unavailable (no native module -- web/Expo Go)",
  osRelease: "unavailable",
  sdkInt: 0,
  securityPatch: "unavailable",
  activeNativeStackId: "unavailable -- native module not loaded",
};

export function readPhase6DeviceProvenance(): Phase6DeviceProvenance {
  if (!GuardDogNative) return { ...PLACEHOLDER, nativeAvailable: false };
  return { ...GuardDogNative.getPhase6DeviceProvenance(), nativeAvailable: true };
}
