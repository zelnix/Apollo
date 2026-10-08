export const FILE_SAMPLE_BYTES = 200_000;
export const FILE_SIZE_LIMIT = 20 * 1024 * 1024;
export type Inspection = { headBytes: Uint8Array | null; textSample: string | null; inspectionError?: string };
export function inspectSample(bytes: Uint8Array): Inspection {
  const sample = bytes.subarray(0, FILE_SAMPLE_BYTES);
  return { headBytes: sample.subarray(0, 16), textSample: Array.from(sample, b => b >= 32 && b < 127 ? String.fromCharCode(b) : ' ').join('') };
}
export function inspectWithHandle(file: { size: number; open(): { readBytes(n: number): Uint8Array; close(): void } }): Inspection {
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > FILE_SIZE_LIMIT) return { headBytes: null, textSample: null, inspectionError: 'File size is unavailable, empty, or exceeds the 20 MB inspection limit.' };
  const handle = file.open();
  try { return inspectSample(handle.readBytes(Math.min(FILE_SAMPLE_BYTES, file.size))); }
  finally { handle.close(); }
}

// Read one asset's signature + bounded text sample locally (web fetch or a native file handle). Mirrors the
// single-file File Gate read so the multi-file batch reuses the exact same inspection, never a second engine.
export async function readInspection(asset: { uri: string; size?: number | null }): Promise<Inspection> {
  const { Platform } = await import("react-native");
  try {
    if (Platform.OS === "web") {
      if (asset.size != null && (!Number.isFinite(asset.size) || asset.size <= 0 || asset.size > FILE_SIZE_LIMIT)) return { headBytes: null, textSample: null, inspectionError: "File size is unavailable, empty, or exceeds the 20 MB inspection limit." };
      const response = await fetch(asset.uri);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > FILE_SIZE_LIMIT) return { headBytes: null, textSample: null, inspectionError: "File is empty or exceeds the 20 MB inspection limit." };
      return inspectSample(bytes);
    }
    const { File } = await import("expo-file-system");
    return inspectWithHandle(new File(asset.uri));
  } catch {
    return { headBytes: null, textSample: null, inspectionError: "This build could not read the file contents." };
  }
}