// Shares the Device Capabilities report as a PDF through the phone's share sheet (print dialog on
// web). Mirrors src/utils/evidencePack.ts — built on the device, nothing uploaded.
import * as FS from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { buildDeviceCapabilityReportHtml, deviceCapabilityReportTitle, type DeviceReportMeta } from "@/src/domain/deviceCapabilityReport";
import type { DeviceCapabilityView } from "@/src/domain/deviceCapabilities";

export async function shareDeviceCapabilityReport(view: DeviceCapabilityView, meta: DeviceReportMeta): Promise<void> {
  const html = buildDeviceCapabilityReportHtml(view, meta);
  if (Platform.OS === "web") { await Print.printAsync({ html }); return; }
  const { uri } = await Print.printToFileAsync({ html });
  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: deviceCapabilityReportTitle(meta), UTI: "com.adobe.pdf" });
    } else {
      await Print.printAsync({ uri });
    }
  } finally {
    try { await FS.deleteAsync(uri, { idempotent: true }); } catch { /* temp file */ }
  }
}
