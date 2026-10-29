// Tells ApolloSG's server that a feature was used on this device, for the admin Devices counts. Fire and forget: a
// missed count never gets in the person's way, and nothing is sent before the device is registered. A Learn article or
// scam alert sends its slug or link so the same one opened twice counts once; the server keeps only a digest of it.
import { apiPost } from "@/src/api/client";

export type DeviceActivity = "device_check" | "learn_read" | "scam_alert_read";

export function reportActivity(kind: DeviceActivity, item?: string): void {
  void Promise.resolve()
    .then(() => apiPost("/devices/activity", "device_activity", item ? { kind, item: item.slice(0, 2048) } : { kind }))
    .catch(() => undefined);
}
