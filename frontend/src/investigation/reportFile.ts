import { File } from "expo-file-system";
import * as Print from "expo-print";

import type { SavedReport } from "./client";
import { reportHtml } from "./reportHtml";

/** The normal Saved Report export and the disposable health check share this exact path. */
export async function prepareReportPdf(report: SavedReport): Promise<{ uri: string; dispose: () => void }> {
  const html = reportHtml(report);
  const { uri } = await Print.printToFileAsync({ html });
  const file = new File(uri);
  try {
    if (!file.exists || !file.size || file.size < 128) throw new Error("PDF file preparation failed.");
    const bytes = await file.bytes();
    if (bytes.length < 128 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
      throw new Error("PDF file signature is invalid.");
    }
    return { uri, dispose: () => { if (file.exists) file.delete(); } };
  } catch (error) { if (file.exists) file.delete(); throw error; }
}