// On-app-open weekly Account Gate check. When the app opens and 7+ days have passed since the last
// completed check, Apollo re-checks the owner's monitored addresses in the background and, only when a
// NEW exposure appears (deduplicated against the previous scan), raises one Patrol item. This is an
// on-open "due check", not a guaranteed background job — the OS may delay it until the app is next opened.
import { useEffect, useRef } from "react";

import { isDue, maskEmail } from "@/src/domain/accountMonitor";
import { getLastCheckedAt, getMonitoredEmails, runScan } from "@/src/store/accountMonitorStore";
import { useApollo } from "@/src/store/ApolloContext";

export function useAccountMonitorDueCheck() {
  const { ready, setupDone, deviceId, adapterLabel, upsertEvent } = useApollo();
  const ran = useRef(false);
  useEffect(() => {
    if (!ready || !setupDone || !deviceId || ran.current) return;
    ran.current = true;
    void (async () => {
      try {
        const emails = await getMonitoredEmails();
        if (emails.length === 0) return;
        if (!isDue(await getLastCheckedAt())) return;
        const { diff } = await runScan(deviceId);
        if (!diff.newExposures.length) return;
        const count = diff.newExposures.length;
        await upsertEvent({
          event_id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          device_id: deviceId, category: "account", state: "ears_up", status: "active",
          headline: `Account exposure: ${count} new breach match${count > 1 ? "es" : ""}`,
          what_happened: `This week's account check found ${count} monitored address${count > 1 ? "es" : ""} newly appearing in breach data: ${diff.newExposures.map((e) => maskEmail(e.email)).join(", ")}.`,
          why: ["A monitored address appeared in known breach data that wasn't there at the last check.", "Appearing in a breach is not the same as your account being broken into — but it invites targeted phishing."],
          what_to_do: "Open Check It → Check My Accounts to read the full weekly report, then secure the affected accounts through their official app or website.",
          indicator_host: null, indicator_digest: null, local_indicator: null, verified_block: false,
          adapter_label: adapterLabel, occurred_at: new Date().toISOString(), resolved_at: null,
          trust_allowed: false, claimed_brand: null, scenario: "account_exposure", scent_id: null,
        });
      } catch { /* best-effort; a failed on-open check must never block the app or overwrite good results */ }
    })();
  }, [ready, setupDone, deviceId, adapterLabel, upsertEvent]);
}
