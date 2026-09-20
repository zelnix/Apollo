// Guard master-card wording derived from the security layer's three facts (requested / operational / method).
// Pure so it is unit-tested; the UI never decides whether Apollo is protecting — it reports what the SDK says.
import type { ProtectionStatus } from "../security/SecurityPlatformAdapter.ts";

export interface MasterCopy { title: string; line: string; requested: boolean; operational: boolean }

/**
 * @param online false while the security service is unreachable — local enforcement is unaffected, online checks are.
 * Mixed states are reported as such: DNS filter operational + service down = "guarding what he can", never "off duty".
 */
export function masterCopy(p: ProtectionStatus | null, online: boolean = true): MasterCopy {
  if (!p) return { title: "Checking protection status", line: "Apollo has not yet established the current protection state.", requested: false, operational: false };
  const requested = !!(p?.requested ?? p?.running);
  const operational = !!p?.operational;
  if (!requested) return { title: "Some protection needs attention", line: "Site Gate is off. Manual Link Gate checks remain available.", requested, operational };
  if (operational && online) return { title: "All available protection is active", line: `Site Gate is confirmed active.`, requested, operational };
  if (operational) return { title: "Some checks are unavailable", line: `Site Gate remains confirmed active; online investigations are unavailable right now.`, requested, operational };
  const guard = `Site Gate ${p?.enforcementMethod === "simulated" ? "unavailable on this device" : "needs attention"}`;
  return { title: "Some protection needs attention", line: online ? `${guard} · Link checks remain active.` : `${guard} · Online checks unavailable right now · On-device link checks remain active.`, requested, operational };
}
