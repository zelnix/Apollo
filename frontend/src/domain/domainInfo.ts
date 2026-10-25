// RDAP domain-info formatting — presentational only, mirrors DomainInfo from core/models.py's
// DomainInfo. Never used to compute a verdict, only to add registrar/registration-date context.
import type { DomainInfo } from "./types";

export function formatDomainInfoLine(info: DomainInfo): string {
  // The registration date as this phone's own calendar reads it, not the UTC date.
  const at = info.registered_at ? new Date(info.registered_at) : null;
  const date = at && Number.isFinite(at.getTime()) ? at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "unknown date";
  const via = info.registrar ? ` via ${info.registrar}` : "";
  const registrant = info.registrant_organization ?? "not disclosed";
  return `Registered ${date}${via} · Registrant: ${registrant}`;
}
