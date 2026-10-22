// The shareable Device Capabilities report.
//
// One page the person can hand to family, a bank, the police or support, showing exactly what their
// device protects, what Apollo is allowed to use, what the operating system keeps private, and which
// native settings they were advised to check.
//
// Rules carried into the document:
//   • A native protection is printed under its provider's name, never Apollo's.
//   • A setting Apollo cannot read is printed as "Apollo can't verify…", never as on or off.
//   • A failed read is printed as unknown, never as clear.
//
// Pure: no printing, no files, no React (tests/deviceCapabilityReport.test.ts).

import { esc } from "./evidencePackHtml.ts";
import { allCapabilityRows, CAPABILITY_CLASS_LABEL, type DeviceCapabilityView, type CapabilityRow } from "./deviceCapabilities.ts";

export interface DeviceReportMeta {
  deviceLabel: string;
  osLabel: string;
  manufacturer: string | null;
  platformLabel: string;
  /** ISO timestamp of the last device check the person actually ran, or null. */
  lastCheckedAt: string | null;
  generatedAt: string;
  /** Plain words for Apollo's own protection state — never a guess. */
  apolloProtection: string;
  /** False when Apollo is running somewhere that cannot see a phone (browser preview). */
  hasNativeHost: boolean;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const capabilityTable = (view: DeviceCapabilityView, platformLabel: string) => {
  const ordered: CapabilityRow[] = allCapabilityRows(view);
  if (!ordered.length) return "";
  return `<h2>Apollo’s capabilities on this device</h2>
    <p class="intro">Every capability Apollo looks for, with the status a real read produced on this device. Apollo asks for a permission only at the moment it needs it, does not infer anything ${esc(platformLabel)} keeps private, and reports a failed read as unknown rather than clear.</p>
    <table class="grid">
      <tr><th>Capability</th><th>Status</th><th>What this means</th></tr>
      ${ordered.map((r) => `<tr>
        <td>${esc(r.title)}</td>
        <td>${esc(CAPABILITY_CLASS_LABEL[r.klass])}</td>
        <td>${esc(r.detail)}${r.attributedTo !== "Apollo" ? `<span class="attr"> Reported by ${esc(r.attributedTo)}.</span>` : ""}</td>
      </tr>`).join("")}
    </table>
    <p class="intro">A status of “${esc(CAPABILITY_CLASS_LABEL.unknown)}” means Apollo asked the device and the read failed: unknown, not clear.</p>`;
};

export function deviceCapabilityReportTitle(meta: DeviceReportMeta): string {
  return `Apollo device capabilities — ${meta.deviceLabel}`;
}

export function buildDeviceCapabilityReportHtml(view: DeviceCapabilityView, meta: DeviceReportMeta): string {
  const protections = view.deviceProtects.length
    ? `<h2>What this device protects</h2>
       <p class="intro">Protection built into this device by its maker or carrier. It runs whether Apollo is present or not, and each finding belongs to the provider named, not to Apollo.</p>
       <table class="grid">
         <tr><th>Provider</th><th>Protection</th><th>State</th><th>Classification shared with Apollo?</th></tr>
         ${view.deviceProtects.map((p) => `<tr>
           <td>${esc(p.provider)}</td>
           <td>${esc(p.feature)}</td>
           <td>${esc(p.stateLabel)}</td>
           <td>${p.classificationAccessible ? "Yes — Apollo may use it as that provider's evidence" : "No — the provider does not share its classification with Apollo"}</td>
         </tr>`).join("")}
       </table>`
    : `<h2>What this device protects</h2><p class="intro">${esc(meta.hasNativeHost
        ? "Apollo did not recognise any built-in call or message protection on this device."
        : "Apollo was not running on the device itself when this report was made, so it could not read the device's built-in protection.")}</p>`;

  const recommendations = view.recommendations.length
    ? `<h2>Protection recommended but not verifiable</h2>
       <p class="intro">Apollo cannot switch these on, and on this platform it cannot read whether they are on. Each one below is a setting Higgins recommends the person checks themselves.</p>
       ${view.recommendations.map((r) => `<div class="rec">
         <div class="rectitle">${esc(r.title)}</div>
         <div class="recbadge">${esc(r.badge)}</div>
         <p>${esc(r.unverified)}</p>
         <p><strong>${esc(r.recommendation)}</strong></p>
         <p class="why">${esc(r.why)}</p>
         <ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
       </div>`).join("")}`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #0B1220; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 20px 0 6px; }
    p { font-size: 12px; line-height: 1.55; margin: 0 0 6px; }
    .meta { color: #4A5568; font-size: 12px; margin-bottom: 14px; }
    .intro { color: #4A5568; }
    ul, ol { font-size: 12px; color: #2D3748; padding-left: 18px; margin: 4px 0; }
    li { margin: 4px 0; line-height: 1.55; }
    .attr { color: #4A5568; font-style: italic; }
    .grid { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0; }
    .grid th { text-align: left; background: #F1F5F9; padding: 6px 8px; border: 1px solid #E2E8F0; }
    .grid td { padding: 6px 8px; border: 1px solid #E2E8F0; vertical-align: top; }
    .rec { border: 1px solid #E2E8F0; border-radius: 6px; padding: 10px 12px; margin: 8px 0; }
    .rectitle { font-size: 13px; font-weight: 700; }
    .recbadge { font-size: 10px; letter-spacing: .4px; text-transform: uppercase; color: #8A6A1F; margin-bottom: 4px; }
    .why { color: #4A5568; }
    .foot { font-size: 10px; color: #718096; margin-top: 18px; line-height: 1.6; }
  </style></head><body>
    <h1>${esc(deviceCapabilityReportTitle(meta))}</h1>
    <div class="meta">
      ${esc([meta.manufacturer, meta.deviceLabel].filter(Boolean).join(" "))} · ${esc(meta.osLabel)}<br />
      Apollo protection: ${esc(meta.apolloProtection)}<br />
      Last device check: ${esc(meta.lastCheckedAt ? when(meta.lastCheckedAt) : "no check recorded")}<br />
      Report created: ${esc(when(meta.generatedAt))}
    </div>
    <p>${esc(view.summary)}</p>
    ${protections}
    ${capabilityTable(view, meta.platformLabel)}
    ${recommendations}
    <div class="foot">
      Prepared by Apollo on this device. Protections listed under “What this device protects” are the named provider’s, not Apollo’s, and are reported here exactly as that provider reports them.<br />
      Settings described as unverifiable are ones this platform does not expose to Apollo; Apollo states that rather than claiming they are on or off.
    </div>
  </body></html>`;
}
