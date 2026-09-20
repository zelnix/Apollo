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