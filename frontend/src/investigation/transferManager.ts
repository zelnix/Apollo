import { disposePickerCopy } from "@/src/domain/fileCopyLifecycle";
import type { FileUploadHandle } from "./client";
import type { CreateCase } from "./types";

interface TransferFile { uri: string; name: string; mediaType: string }
export interface TransferTurn { turnId: string; key: string; message: string }
export type TransferPhase = "reserved" | "reading" | "uploading" | "submitting" | "failed" | "expired";

export interface PendingTransfer {
  operationId: string; caseId: string; files: TransferFile[]; question: string; fileIndex: number;
  handle: FileUploadHandle; revision: number; phase: TransferPhase; error: string | null;
  turn: TransferTurn | null; controller: AbortController; closed: boolean;
}

const transfers = new Map<string, PendingTransfer>();
const closedOperations = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<(record: PendingTransfer) => void>();

function notify(record: PendingTransfer) { for (const listener of listeners) listener(record); }
function release(record: PendingTransfer, phase: "expired" | "failed" = "expired") {
  record.closed = phase === "expired"; record.phase = phase; record.controller.abort();
  record.handle = { ...record.handle, bytes: null }; const files = [...record.files]; record.files.splice(0);
  for (const file of files) void disposePickerCopy(file.uri, true);
  if (record.closed) closedOperations.add(record.operationId);
  notify(record);
}
function schedule(record: PendingTransfer) {
  const prior = timers.get(record.caseId); if (prior) clearTimeout(prior);
  const delay = Math.max(0, Date.parse(record.handle.expiresAt) - Date.now());
  timers.set(record.caseId, setTimeout(() => {
    const current = transfers.get(record.caseId); if (!current || current.operationId !== record.operationId) return;
    release(current); transfers.delete(record.caseId); timers.delete(record.caseId);
  }, delay));
}

export function retainTransfer(record: PendingTransfer): PendingTransfer | null {
  if (closedOperations.has(record.operationId)) return null;
  const current = transfers.get(record.caseId);
  if (current && current.operationId === record.operationId) {
    const controller = current.controller; Object.assign(current, record, { controller }); schedule(current); notify(current); return current;
  }
  transfers.set(record.caseId, record); schedule(record); notify(record); return record;
}
export function updateTransfer(caseId: string, operationId: string, update: Partial<PendingTransfer>): PendingTransfer | null {
  const record = transfers.get(caseId);
  if (!record || record.operationId !== operationId || record.closed || closedOperations.has(operationId)) return null;
  Object.assign(record, update); schedule(record); notify(record); return record;
}
export function getTransfer(caseId: string): PendingTransfer | null { return transfers.get(caseId) ?? null; }
export function latestTransfer(): PendingTransfer | null { return [...transfers.values()].at(-1) ?? null; }
export function subscribeTransfers(listener: (record: PendingTransfer) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function failTransfer(record: PendingTransfer, error: string) { record.error = error; record.phase = "failed"; notify(record); }
export function completeTransfer(caseId: string, operationId: string) {
  const record = transfers.get(caseId); if (!record || record.operationId !== operationId) return;
  closedOperations.add(operationId); record.closed = true; record.handle = { ...record.handle, bytes: null };
  transfers.delete(caseId); const timer = timers.get(caseId); if (timer) clearTimeout(timer); timers.delete(caseId); notify(record);
}
export function cancelTransfer(caseId: string) {
  const record = transfers.get(caseId); if (record) release(record);
  transfers.delete(caseId); const timer = timers.get(caseId); if (timer) clearTimeout(timer); timers.delete(caseId);
}

export interface PendingObservation {
  operationId: string; caseId: string; input: Omit<CreateCase, "deviceProfile">; revision: number;
  evidenceIndex: number; evidenceIds: string[]; turn: TransferTurn; phase: "appending" | "submitting" | "failed";
  error: string | null;
  controller: AbortController;
}
const observations = new Map<string, PendingObservation>();
export function beginObservation(record: PendingObservation): PendingObservation {
  const existing = observations.get(record.operationId); if (existing) return existing;
  observations.set(record.operationId, record); return record;
}
export function updateObservation(operationId: string, update: Partial<PendingObservation>): PendingObservation | null {
  const record = observations.get(operationId); if (!record) return null; Object.assign(record, update); return record;
}
export function observationForCase(caseId: string): PendingObservation | null {
  return [...observations.values()].find((record) => record.caseId === caseId) ?? null;
}
export function latestObservation(): PendingObservation | null { return [...observations.values()].at(-1) ?? null; }
export function completeObservation(operationId: string) { observations.delete(operationId); }
export function cancelObservations(caseId: string) {
  for (const [id, record] of observations) if (record.caseId === caseId) { record.controller.abort(); observations.delete(id); }
}