// RDAP domain-info formatting — presentational only, mirrors DomainInfo from core/models.py's
// DomainInfo. Never used to compute a verdict, only to add registrar/registration-date context.
import type { DomainInfo } from "./types";

export function formatDomainInfoLine(info: DomainInfo): string {
  const date = info.registered_at ? info.registered_at.slice(0, 10) : "unknown date";
  const via = info.registrar ? ` via ${info.registrar}` : "";
  const registrant = info.registrant_organization ?? "not disclosed";
  return `Registered ${date}${via} · Registrant: ${registrant}`;
}
