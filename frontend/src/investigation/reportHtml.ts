import type { SavedReport } from "./client";

const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export function validReport(value: unknown): value is SavedReport {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SavedReport>;
  return typeof row.reportId === "string" && typeof row.caseId === "string" &&
    typeof row.overview === "string" && typeof row.explanationMarkdown === "string" &&
    typeof row.scope === "string" && typeof row.assessment === "string" &&
    typeof row.attention === "string" && typeof row.retentionNotice === "string" &&
    typeof row.savedAt === "string" && Number.isFinite(Date.parse(row.savedAt)) &&
    typeof row.responseRevision === "number" && row.responseRevision > 0 &&
    typeof row.historical === "boolean" && Array.isArray(row.gates) && row.gates.every((v) => typeof v === "string") &&
    Array.isArray(row.findings) && row.findings.every((v) => typeof v === "string") &&
    Array.isArray(row.uncertainties) && row.uncertainties.every((v) => typeof v === "string") &&
    Array.isArray(row.actions) && row.actions.every((v) => typeof v.id === "string" && typeof v.label === "string" && typeof v.instruction === "string" && typeof v.kind === "string") &&
    Array.isArray(row.sources) && row.sources.every((v) => typeof v.title === "string" && typeof v.url === "string" && typeof v.authority === "string");
}

/** No external URLs, user HTML or network-fetched assets are evaluated by the PDF renderer. */
export function reportHtml(report: SavedReport): string {
  if (!validReport(report)) throw new Error("Higgins report format is incomplete.");
  const items = (values: string[]) => values.map((v) => `<li>${escape(v)}</li>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;color:#142031;margin:32px;line-height:1.5}h1{font-size:24px}h2{font-size:16px;margin-top:24px}li{margin:6px 0}small{color:#596779}</style></head><body>
<h1>Higgins ${report.historical ? "saved report" : "system health check"}</h1>
<small>${escape(report.savedAt)} · ${escape(report.retentionNotice)}</small>
<h2>Overview</h2><p>${escape(report.overview)}</p>
<h2>Explanation</h2><p>${escape(report.explanationMarkdown)}</p>
<h2>Findings</h2><ul>${items(report.findings)}</ul>
<h2>Uncertainties</h2><ul>${items(report.uncertainties)}</ul>
<h2>Next steps</h2><ul>${items(report.actions.map((a) => `${a.label}: ${a.instruction}`))}</ul>
<h2>Scope</h2><p>${escape(report.scope)}</p>
</body></html>`;
}