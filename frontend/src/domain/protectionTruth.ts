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
  // When Private DNS is confirmed active, Apollo's DNS-level visibility is limited.
  // When unobservable, we cannot confirm DNS inspection is operating.
  // State this honestly without suggesting the user change their settings
  // and without overstating the protection that remains.
  const dnsWarning = privateDns?.bypassLevel === "confirmed"
    ? "Some automatic website checks are limited on this device. You don't need to change any settings. Other available protections continue working where supported."
    : privateDns?.bypassLevel === "unobservable"
      ? "Apollo could not determine this device's DNS configuration. Some automatic website checks may not be operating."
      : null;
  if (!requested) return { title: "Some protection needs attention", line: "Website protection is off. Manual link checks remain available.", requested, operational, privateDnsWarning: dnsWarning };
  if (operational && online && !dnsWarning) return { title: "All available protection is active", line: `Website protection is confirmed active.`, requested, operational, privateDnsWarning: null };
  if (operational && online && dnsWarning) return { title: "Protection active — limited coverage", line: `Apollo is running, but some automatic website checks are limited on this device. You don't need to change any settings. Other available protections continue working where supported.`, requested, operational, privateDnsWarning: dnsWarning };
  if (operational) return { title: "Some checks are unavailable", line: `Website protection remains confirmed active; online investigations are unavailable right now.`, requested, operational, privateDnsWarning: dnsWarning };
  const guard = `Website protection ${p?.enforcementMethod === "simulated" ? "unavailable on this device" : "needs attention"}`;
  return { title: "Some protection needs attention", line: online ? `${guard} · Link checks remain active.` : `${guard} · Online checks unavailable right now · On-device link checks remain active.`, requested, operational, privateDnsWarning: dnsWarning };
}
