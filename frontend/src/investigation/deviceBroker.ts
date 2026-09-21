// Device broker: answers coordinator device requests honestly. No capability is manufactured; browser preview never simulates silently.
import { Platform } from "react-native";

import type { DeviceProfile, DeviceRequest, DeviceResult } from "./types";

export function currentDeviceProfile(): DeviceProfile {
  const platform = Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web";
  return { platform, manufacturer: null, model: null, osVersion: Platform.OS === "web" ? null : String(Platform.Version), locale: "en-AU",
    evidenceOrigin: Platform.OS === "web" ? "browser" : "native", capabilityIds: [] };
}

/** Fresh observation for a coordinator request. Until native capability adapters are bound here, every request is an explicit `unavailable`. */
export async function observe(request: DeviceRequest): Promise<DeviceResult> {
  return { requestId: request.id, caseRevision: request.caseRevision, capabilityId: request.capabilityId, status: "unavailable", observedAt: null, values: {}, simulation: null };
}
