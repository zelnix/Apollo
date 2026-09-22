import { disposePickerCopy } from "@/src/domain/fileCopyLifecycle";
import type { FileUploadHandle } from "./client";

interface TransferFile { uri: string; name: string; mediaType: string }

export interface PendingTransfer {
  caseId: string; files: TransferFile[]; question: string; fileIndex: number; handle: FileUploadHandle; revision: number;
}

const transfers = new Map<string, PendingTransfer>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function schedule(record: PendingTransfer) {
  const prior = timers.get(record.caseId); if (prior) clearTimeout(prior);
  const delay = Math.max(0, Date.parse(record.handle.expiresAt) - Date.now());
  timers.set(record.caseId, setTimeout(() => {
    const current = transfers.get(record.caseId);
    if (!current) return;
    for (const file of current.files) void disposePickerCopy(file.uri, true);
    transfers.delete(record.caseId); timers.delete(record.caseId);
  }, delay));
}

export function retainTransfer(record: PendingTransfer) { transfers.set(record.caseId, record); schedule(record); }
export function getTransfer(caseId: string): PendingTransfer | null { return transfers.get(caseId) ?? null; }
export function latestTransfer(): PendingTransfer | null { return [...transfers.values()].at(-1) ?? null; }
export function clearTransfer(caseId: string) {
  transfers.delete(caseId); const timer = timers.get(caseId); if (timer) clearTimeout(timer); timers.delete(caseId);
}
export function cancelTransfer(caseId: string) {
  const current = transfers.get(caseId); if (current) for (const file of current.files) void disposePickerCopy(file.uri, true);
  clearTransfer(caseId);
}