// Guard master-card wording derived from the security layer's three facts (requested / operational / method).
// Pure so it is unit-tested; the UI never decides whether Apollo is protecting — it reports what the SDK says.
import type { ProtectionStatus } from "../security/SecurityPlatformAdapter.ts";

export interface MasterCopy { title: string; line: string; requested: boolean; operational: boolean }

const METHOD_LABEL: Record<ProtectionStatus["enforcementMethod"], string> = {
  dns_filter: "DNS protection active on this device",
  content_blocker: "Safari content blocker active",
  simulated: "Demo only — nothing enforced",
  none: "No enforcement on this device",
};

/**
 * @param online false while the security service is unreachable — local enforcement is unaffected, online checks are.
 * Mixed states are reported as such: DNS filter operational + service down = "guarding what he can", never "off duty".
 */
export function masterCopy(p: ProtectionStatus | null, online: boolean = true): MasterCopy {
  const requested = !!(p?.requested ?? p?.running);
  const operational = !!p?.operational;
  if (!requested) return { title: "Apollo is off duty", line: "Protection is off. Apollo cannot see or block anything until you turn him back on.", requested, operational };
  if (operational && online) return { title: "Apollo is guarding", line: `Site Guard active · ${METHOD_LABEL[p!.enforcementMethod]}.`, requested, operational };
  if (operational) return { title: "Apollo is guarding what he can", line: `Site Guard active · ${METHOD_LABEL[p!.enforcementMethod]} · Online checks unavailable right now.`, requested, operational };
  const guard = `Site Guard ${p?.enforcementMethod === "simulated" ? "simulated" : "unavailable"}`;
  return { title: "Apollo is guarding what he can", line: online ? `${guard} · Link checks remain active.` : `${guard} · Online checks unavailable right now · On-device link checks remain active.`, requested, operational };
}
