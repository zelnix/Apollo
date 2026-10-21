import * as FS from "expo-file-system/legacy";
import * as Print from "expo-print";

import type { SavedReport } from "./client";
import { reportHtml } from "./reportHtml";

/** The normal Saved Report export and the disposable health check share this exact path. */
export async function prepareReportPdf(report: SavedReport): Promise<{ uri: string; dispose: () => void }> {
  const html = reportHtml(report);
  const { uri } = await Print.printToFileAsync({ html });
  try {
    const info = await FS.getInfoAsync(uri);
    if (!info.exists || (info.size ?? 0) < 128) throw new Error("PDF file preparation failed.");
    const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64, length: 5, position: 0 });
    const header = atob(b64);
    if (header.length < 5 || header.slice(0, 5) !== "%PDF-") {
      throw new Error("PDF file signature is invalid.");
    }
    return { uri, dispose: () => { void FS.deleteAsync(uri, { idempotent: true }); } };
  } catch (error) { void FS.deleteAsync(uri, { idempotent: true }); throw error; }
}
