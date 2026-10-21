import * as FS from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const PICKER_DIR = (FS.cacheDirectory ?? '') + 'DocumentPicker/';

/** Only the cache copy explicitly created by Apollo's picker is owned, never a shared original. */
export function disposePickerCopy(uri: string, owned: boolean): boolean {
  if (!owned) return true;
  if (Platform.OS === 'web') { if (uri.startsWith('blob:')) URL.revokeObjectURL(uri); return true; }
  if (!uri.startsWith(PICKER_DIR.replace(/\/$/, '')) || uri.includes('/../')) return false;
  try { void FS.deleteAsync(uri, { idempotent: true }); return true; } catch { return false; }
}

/** Crash recovery for this app's picker directory only. Never traverse arbitrary user paths. */
export function sweepPickerCopies() {
  if (Platform.OS === 'web') return;
  void (async () => {
    try {
      const info = await FS.getInfoAsync(PICKER_DIR);
      if (!info.exists) return;
      const entries = await FS.readDirectoryAsync(PICKER_DIR);
      for (const name of entries) {
        const uri = PICKER_DIR + name;
        const fi = await FS.getInfoAsync(uri);
        if (!fi.exists) continue;
        const modified = fi.modificationTime ?? 0;
        if (Date.now() / 1000 - modified >= 15 * 60) disposePickerCopy(uri, true);
      }
    } catch { /* scope is limited to picker copies; retry on next File Gate visit */ }
  })();
}
