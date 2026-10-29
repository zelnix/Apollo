// The Overall Protection Posture for Home and the Protection screen: Apollo's own protections and the device's,
// decided once by `protectionPosture` so both screens always say the same thing.
import { useCallback, useMemo, useState } from "react";

import { deviceAreaRows, type DeviceAreaRow, type DeviceAreaStatus } from "@/src/domain/deviceProtectionTypes";
import { areaCounts, areaRows, countLine, protectionPosture } from "@/src/domain/protectionPosture";
import { assessDeviceProtections, useDeviceProtections } from "@/src/store/deviceProtectionStore";
import { runProtectionHealthCheck } from "./healthCoordinator";
import { useProtectionHealth } from "./healthStore";

export interface DeviceCounts { protected: number; attention: number; toCheck: number; optional: number }

/** Short summary from device area rows — same style as Apollo's countLine. */
function deviceAreaCountLine(areas: DeviceAreaRow[]): string {
  if (!areas.length) return "No areas available";
  const n = (statuses: DeviceAreaStatus[]) => areas.filter((r) => statuses.includes(r.status)).length;
  const ok = n(["protected"]);
  const attention = n(["attention"]);
  const toCheck = n(["unconfirmed"]);
  const unread = n(["unread"]);
  if (unread === areas.length) return `${areas.length} areas · Not yet checked`;
  return countLine({ protected: ok, attention, toCheck });
}

export function useProtectionPosture() {
  const health = useProtectionHealth();
  const assessment = useDeviceProtections();
  const [rechecking, setRechecking] = useState(false);

  const view = useMemo(() => {
    const onDevice = assessment?.reading.hasNativeHost ?? false;
    const device = !assessment ? "reading" as const : onDevice ? assessment.reading.view.deviceProtects : "not_here" as const;
    // Only the very first reading counts as "still checking"; a re-check keeps the last real answer on screen.
    const posture = protectionPosture({ gates: health.gates, checking: health.checking && !health.checkedAt, device });
    const areas = areaRows(posture);
    const g = assessment?.groups;
    const deviceCounts: DeviceCounts | null = g && onDevice
      ? { protected: g.protectedRows.length, attention: g.needsAttention.length, toCheck: g.needsChecking.length, optional: g.optional.length }
      : null;
    const deviceAreas = deviceAreaRows(device);
    const deviceLine = !assessment ? "Reading this device…" : deviceCounts ? countLine(deviceCounts)
      : deviceAreaCountLine(deviceAreas);
    return { posture, areas, apolloLine: countLine(areaCounts(areas)), deviceCounts, deviceLine, deviceAreas, deviceRead: !!assessment };
  }, [health.gates, health.checking, health.checkedAt, assessment]);

  const recheck = useCallback(() => {
    setRechecking(true);
    void Promise.allSettled([runProtectionHealthCheck("user_action"), assessDeviceProtections(true)]).finally(() => setRechecking(false));
  }, []);

  return { ...view, health, recheck, rechecking: rechecking || health.checking };
}
