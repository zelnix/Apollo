import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** Only the cache copy explicitly created by Apollo's picker is owned, never a shared original. */
export function disposePickerCopy(uri: string, owned: boolean): boolean {
  if (!owned) return true;
  if (Platform.OS === 'web') { if (uri.startsWith('blob:')) URL.revokeObjectURL(uri); return true; }
  const directory = new Directory(Paths.cache, 'DocumentPicker');
  if (!uri.startsWith(`${directory.uri.replace(/\/$/, '')}/`) || uri.includes('/../')) return false;
  try { const file = new File(uri); if (file.exists) file.delete(); return true; } catch { return false; }
}

/** Crash recovery for this app's picker directory only. Never traverse arbitrary user paths. */
export function sweepPickerCopies() {
  if (Platform.OS === 'web') return;
  try {
    const directory = new Directory(Paths.cache, 'DocumentPicker');
    if (!directory.exists) return;
    for (const file of directory.list()) {
      if (!(file instanceof File)) continue;
      const created = file.creationTime ?? file.modificationTime;
      if (created == null || Date.now() - created >= 15 * 60 * 1000) disposePickerCopy(file.uri, true);
    }
  } catch { /* scope is limited to picker copies; retry on next File Gate visit */ }
}