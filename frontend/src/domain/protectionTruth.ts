// Guard master-card wording derived from the security layer's three facts (requested / operational / method).
// Pure so it is unit-tested; the UI never decides whether Apollo is protecting — it reports what the SDK says.
import type { ProtectionStatus } from "../security/SecurityPlatformAdapter.ts";
import type { PrivateDnsStatus } from "./types.ts";

export interface MasterCopy { title: string; line: string; requested: boolean; operational: boolean; privateDnsWarning?: string | null }

/**
 * @param online false while the security service is unreachable — local enforcement is unaffected, online checks are.
 * Mixed states are reported as such: DNS filter operational + service down = "guarding what he can", never "off duty".
 * @param privateDns optional Private DNS status — when confirmed bypass, appends a warning.
 */
export function masterCopy(p: ProtectionStatus | null, online: boolean = true, privateDns?: PrivateDnsStatus | null): MasterCopy {
  if (!p) return { title: "Checking protection status", line: "Apollo has not yet established the current protection state.", requested: false, operational: false };
  const requested = !!(p?.requested ?? p?.running);
  const operational = !!p?.operational;
  const dnsWarning = privateDns?.bypassLevel === "confirmed"
    ? `Your device's Private DNS setting${privateDns.privateDnsServer ? ` (${privateDns.privateDnsServer})` : ""} routes DNS through an encrypted channel Apollo cannot inspect. Website protection is reduced. Turn off Private DNS in Settings → Network to restore full coverage.`
    : null;
  if (!requested) return { title: "Some protection needs attention", line: "Website protection is off. Manual link checks remain available.", requested, operational, privateDnsWarning: dnsWarning };
  if (operational && online && !dnsWarning) return { title: "All available protection is active", line: `Website protection is confirmed active.`, requested, operational, privateDnsWarning: null };
  if (operational && online && dnsWarning) return { title: "Protection active — reduced DNS coverage", line: `Website protection is active, but DNS visibility is reduced.`, requested, operational, privateDnsWarning: dnsWarning };
  if (operational) return { title: "Some checks are unavailable", line: `Website protection remains confirmed active; online investigations are unavailable right now.`, requested, operational, privateDnsWarning: dnsWarning };
  const guard = `Website protection ${p?.enforcementMethod === "simulated" ? "unavailable on this device" : "needs attention"}`;
  return { title: "Some protection needs attention", line: online ? `${guard} · Link checks remain active.` : `${guard} · Online checks unavailable right now · On-device link checks remain active.`, requested, operational, privateDnsWarning: dnsWarning };
}
