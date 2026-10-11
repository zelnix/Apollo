import type { SavedReport } from "./client";
import type { EvidenceItem } from "./types";

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

/** Build the evidentiary chain section for HTML export. */
function evidenceChainHtml(evidenceItems: EvidenceItem[]): string {
  if (evidenceItems.length === 0) return "";
  const rows = evidenceItems.map((e) => {
    const displayId = e.displayId || e.id.slice(0, 8);
    const kindLabel = e.kind.charAt(0).toUpperCase() + e.kind.slice(1);
    const origin = e.origin.replace(/_/g, " ");
    const hash = e.integrityHash ? `<br/><small>SHA-256: ${escape(e.integrityHash)}</small>` : "";
    const provenance = e.provenance?.sourceDescription ? `<br/><small>${escape(e.provenance.sourceDescription)}</small>` : "";
    const transforms = e.transformations && e.transformations.length > 0
      ? `<br/><small>Processing: ${e.transformations.map((t) => escape(t.description)).join("; ")}</small>` : "";
    return `<tr><td><strong>${escape(displayId)}</strong></td><td>${escape(kindLabel)}</td><td>${escape(origin)}</td><td>${escape(e.label || "—")}${provenance}${hash}${transforms}</td><td>${escape(e.availability)}</td></tr>`;
  }).join("");
  return `<h2>Evidentiary Chain</h2><p>${evidenceItems.length} evidence item${evidenceItems.length !== 1 ? "s" : ""}</p><table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr><th>ID</th><th>Type</th><th>Source</th><th>Description</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** No external URLs, user HTML or network-fetched assets are evaluated by the PDF renderer. */
export function reportHtml(report: SavedReport, evidenceItems?: EvidenceItem[]): string {
  if (!validReport(report)) throw new Error("Higgins report format is incomplete.");
  const items = (values: string[]) => values.map((v) => `<li>${escape(v)}</li>`).join("");
  const badge = report.assessment === "concern_found" ? "background:#fee;color:#c33"
    : report.assessment === "no_concern_found_within_scope" ? "background:#efe;color:#363" : "background:#ffd;color:#663";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;color:#142031;margin:32px;line-height:1.5}h1{font-size:24px}h2{font-size:16px;margin-top:24px}li{margin:6px 0}small{color:#596779}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.85em;font-weight:500}table{margin:1em 0}th{text-align:left;background:#f5f5f5}</style></head><body>
<h1>Apollo Investigation Report</h1>
<small>${escape(report.savedAt)} · ${escape(report.retentionNotice)} · <span class="badge" style="${badge}">${escape(report.assessment)}</span></small>
<h2>Overview</h2><p>${escape(report.overview)}</p>
<h2>Explanation</h2><p>${escape(report.explanationMarkdown)}</p>
<h2>Findings</h2><ul>${items(report.findings)}</ul>
<h2>Uncertainties</h2><ul>${items(report.uncertainties)}</ul>
<h2>Next steps</h2><ul>${items(report.actions.map((a) => `${a.label}: ${a.instruction}`))}</ul>
${evidenceChainHtml(evidenceItems || [])}
<h2>Scope</h2><p>${escape(report.scope)}</p>
</body></html>`;
}