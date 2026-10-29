// Evidence Pack: one PDF with the original image, the sent copy, case title, date and notes,
// shared through the device's share sheet (print dialog on web). Built on the device.
import * as FS from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import type { ImageEvidenceRecord } from "@/src/store/imageEvidence";
import type { OriginalSource } from "@/src/store/originalSource";
import { ARTEFACT_CSS, buildOriginalSourceHtml, esc } from "@/src/domain/evidencePackHtml";
import { redactInvestigationSecrets } from "@/src/domain/privacy";


async function embeddable(uri: string): Promise<string> {
  if (Platform.OS === "web" || uri.startsWith("data:")) return uri;
  const ext = uri.split("?")[0].split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 })}`;
}

export interface PackSummary { overview: string | null; findings: string[]; steps: string[]; uncertainties: string[] }

export async function shareEvidencePack(r: ImageEvidenceRecord | null, info: { title: string; date: string; notes: string[]; summary?: PackSummary | null; originalSource?: OriginalSource | null }) {
  const original = r?.originalUri ? await embeddable(r.originalUri) : null;
  const sent = r ? await embeddable(r.sentUri) : null;
  const fmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString(); };
  const img = (src: string | null, label: string, empty: string) => `
    <div class="col"><h3>${esc(label)}</h3>${src ? `<img src="${src}" />` : `<div class="empty">${esc(empty)}</div>`}</div>`;
  const list = (heading: string, items: string[]) => items.length ? `<h2>${esc(heading)}</h2><ul>${items.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  const sm = info.summary;
  const summaryHtml = sm ? `
    ${sm.overview ? `<h2>Higgins's summary</h2><p>${esc(sm.overview)}</p>` : ""}
    ${list("Key findings", sm.findings)}
    ${list("Recommended steps", sm.steps)}
    ${list("Still uncertain", sm.uncertainties)}` : "";
  const originalSourceHtml = info.originalSource ? buildOriginalSourceHtml(info.originalSource, redactInvestigationSecrets) : "";
  const imageHtml = r ? `
    <h2>Image evidence</h2>
    <div class="row">
      ${img(original, "Original, kept on this device", r.originalRemovedAt ? `Original removed from the device on ${fmt(r.originalRemovedAt)}.` : "Original not available.")}
      ${img(sent, "Copy sent for investigation", "")}
    </div>
    <ul>${info.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  const capturedMeta = r ? ` · Image captured: ${esc(fmt(r.createdAt))}` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #0B1220; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; } .meta { color: #4A5568; font-size: 12px; margin-bottom: 16px; }
    h2 { font-size: 14px; margin: 18px 0 6px; } p { font-size: 12px; line-height: 1.5; margin: 0; }
    .row { display: flex; gap: 16px; } .col { flex: 1; } h3 { font-size: 13px; margin: 0 0 6px; }
    img { width: 100%; border: 1px solid #CBD5E0; border-radius: 6px; }
    .empty { border: 1px dashed #CBD5E0; border-radius: 6px; padding: 24px; color: #4A5568; font-size: 12px; text-align: center; }
    ul { font-size: 12px; color: #2D3748; padding-left: 18px; } .foot { font-size: 10px; color: #718096; margin-top: 16px; }
    .fields { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 12px; }
    .flabel { font-weight: 600; color: #4A5568; padding: 4px 12px 4px 0; vertical-align: top; white-space: nowrap; }
    .fvalue { color: #0B1220; padding: 4px 0; word-break: break-word; }
    .srcbox { background: #F7FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 12px; margin: 6px 0; }
    .srctext { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin: 0; }
    .srcnote { font-size: 11px; color: #718096; font-style: italic; margin-top: 4px; }
${ARTEFACT_CSS}
  </style></head><body>
    <h1>${esc(info.title)}</h1>
    <div class="meta">Case date: ${esc(fmt(info.date))}${capturedMeta} · Evidence pack created: ${esc(fmt(new Date().toISOString()))}</div>
    ${summaryHtml}
    ${originalSourceHtml}
    ${imageHtml}
    <div class="foot">Prepared by ApolloSG on the user's device.</div>
  </body></html>`;

  if (Platform.OS === "web") { await Print.printAsync({ html }); return; }
  const { uri } = await Print.printToFileAsync({ html });
  try {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Share evidence pack", UTI: "com.adobe.pdf" });
    else await Print.printAsync({ uri });
  } finally {
    try { await FS.deleteAsync(uri, { idempotent: true }); } catch { /* temp file */ }
  }
}
