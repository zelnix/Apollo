import * as Crypto from "expo-crypto";

import { disposePickerCopy } from "@/src/domain/fileCopyLifecycle";
import * as api from "./client";
import { currentDeviceProfile } from "./deviceBroker";
import type { CreateCase, InvestigationCase, Job, Submission } from "./types";

interface OperationFile { uri: string; name: string; mediaType: string }
export interface OperationTurn { turnId: string; key: string; message: string }
export type OperationPhase = "reserved" | "creating" | "reading" | "uploading" | "appending" | "submitting" | "submitted" | "settled" | "failed" | "expired" | "cancelled";

export interface ManagedOperation {
  operationId: string;
  caseId: string | null;
  kind: "create" | "append";
  input: Omit<CreateCase, "deviceProfile">;
  files: OperationFile[];
  fileIndex: number;
  handle: api.FileUploadHandle | null;
  revision: number;
  evidenceIndex: number;
  evidenceIds: string[];
  turn: OperationTurn;
  phase: OperationPhase;
  error: string | null;
  caseData: InvestigationCase | null;
  job: Job | null;
  expiresAt: string | null;
  controller: AbortController;
  running: Promise<ManagedOperation> | null;
}

const operations = new Map<string, ManagedOperation>();
const operationPairs = new Map<string, string>();
const listeners = new Map<string, Set<(record: ManagedOperation) => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const pairKey = (operationId: string, caseId: string) => `${operationId}:${caseId}`;
const notify = (record: ManagedOperation) => listeners.get(record.operationId)?.forEach((listener) => listener(record));

function scheduleExpiry(record: ManagedOperation) {
  const previous = timers.get(record.operationId);
  if (previous) clearTimeout(previous);
  if (!record.expiresAt || ["expired", "cancelled"].includes(record.phase)) return;
  timers.set(record.operationId, setTimeout(() => expireOperation(record.operationId, record.caseId), Math.max(0, Date.parse(record.expiresAt) - Date.now())));
}

function publish(record: ManagedOperation, update: Partial<ManagedOperation>) {
  Object.assign(record, update);
  scheduleExpiry(record);
  notify(record);
  return record;
}

function bindCase(record: ManagedOperation, caseData: InvestigationCase) {
  if (record.caseId && record.caseId !== caseData.id) throw new Error("Operation ownership conflict: this operation belongs to another investigation.");
  record.caseId = caseData.id;
  operationPairs.set(pairKey(record.operationId, caseData.id), record.operationId);
  return publish(record, { caseData, revision: caseData.revision, expiresAt: caseData.expiresAt });
}

function requireOperation(operationId: string, caseId?: string | null): ManagedOperation | null {
  const record = operations.get(operationId) ?? null;
  if (!record || (caseId && (record.caseId !== caseId || operationPairs.get(pairKey(operationId, caseId)) !== operationId))) return null;
  return record;
}

function releaseFiles(record: ManagedOperation) {
  record.controller.abort();
  if (record.handle) record.handle = { ...record.handle, bytes: null };
  const files = [...record.files];
  record.files.splice(0);
  for (const file of files) void disposePickerCopy(file.uri, true);
}

async function runCreate(record: ManagedOperation): Promise<ManagedOperation> {
  if (!record.caseData) {
    publish(record, { phase: "creating", error: null });
    const opened = await api.createCase({ ...record.input, question: record.files.length ? "" : record.input.question, deviceProfile: currentDeviceProfile() }, record.operationId);
    bindCase(record, opened.case);
    if (!record.files.length) {
      const replayJob = opened.job ?? (opened.case.activeJobId ? (await api.getJob(opened.case.id, opened.case.activeJobId)).job : null);
      return publish(record, { job: replayJob, phase: replayJob ? "submitted" : opened.case.response ? "settled" : "submitted" });
    }
  }
  const caseId = record.caseId!;
  for (let index = record.fileIndex; index < record.files.length; index++) {
    const file = record.files[index];
    const kind = file.mediaType.startsWith("image/") ? "image" : file.mediaType.startsWith("audio/") ? "audio" : /pdf|word|text/.test(file.mediaType) ? "document" : "attachment";
    let handle = record.handle ?? api.createFileUploadHandle(record.expiresAt!);
    const reserve = (next: api.FileUploadHandle) => {
      handle = next;
      publish(record, { handle: next, fileIndex: index, phase: next.bytes ? "uploading" : "reading", error: null });
    };
    const result = await api.uploadFileEvidenceResumable(caseId, record.revision, file, kind, handle, reserve, record.controller.signal);
    await disposePickerCopy(file.uri, true);
    publish(record, { revision: result.caseRevision, fileIndex: index + 1,
      handle: index + 1 < record.files.length ? api.createFileUploadHandle(record.expiresAt!) : handle, phase: "uploading" });
  }
  publish(record, { phase: "submitting" });
  const submitted = await api.submitTurn(caseId, { expectedRevision: record.revision, turnId: record.turn.turnId,
    message: record.turn.message, answerToQuestionId: null, evidenceIds: [] }, record.turn.key, record.controller.signal);
  const fresh = (await api.getCase(caseId)).case;
  bindCase(record, fresh);
  releaseFiles(record);
  return publish(record, { job: submitted.job, phase: "submitted", error: null });
}

async function runAppend(record: ManagedOperation): Promise<ManagedOperation> {
  const caseId = record.caseId!;
  let revision = record.revision || (await api.getCase(caseId)).case.revision;
  const submissions: Submission[] = [...record.input.submissions];
  if (record.input.initialFindings.length) submissions.push({ clientItemId: `${record.operationId}-observations`, kind: "text", value: record.input.initialFindings.join("\n"), label: "fresh Apollo observations" });
  publish(record, { phase: "appending", error: null });
  for (let index = record.evidenceIndex; index < submissions.length; index++) {
    const added = await api.addSubmissionEvidence(caseId, revision, submissions[index], record.controller.signal);
    revision = added.caseRevision;
    publish(record, { revision, evidenceIndex: index + 1, evidenceIds: [...record.evidenceIds, added.evidence.id] });
  }
  publish(record, { phase: "submitting" });
  const submitted = await api.submitTurn(caseId, { expectedRevision: revision, turnId: record.turn.turnId,
    message: record.turn.message, answerToQuestionId: null, evidenceIds: record.evidenceIds }, record.turn.key, record.controller.signal);
  const fresh = (await api.getCase(caseId)).case;
  bindCase(record, fresh);
  return publish(record, { job: submitted.job, phase: "submitted", error: null });
}

function execute(record: ManagedOperation): Promise<ManagedOperation> {
  if (record.running) return record.running;
  if (["submitted", "settled"].includes(record.phase)) return Promise.resolve(record);
  record.controller = new AbortController();
  const task = (record.kind === "create" ? runCreate(record) : runAppend(record)).catch((error: unknown) => {
    if (record.phase !== "expired" && record.phase !== "cancelled") publish(record, { phase: "failed", error: error instanceof Error ? error.message : "The investigation operation did not finish." });
    return record;
  }).finally(() => { record.running = null; notify(record); });
  record.running = task;
  notify(record);
  return task;
}

export function startManagedOperation(operationId: string, input: Omit<CreateCase, "deviceProfile">, files: OperationFile[] = []) {
  const existing = requireOperation(operationId);
  if (existing) return execute(existing);
  const record: ManagedOperation = { operationId, caseId: null, kind: "create", input, files: [...files], fileIndex: 0, handle: null,
    revision: 0, evidenceIndex: 0, evidenceIds: [], turn: { turnId: Crypto.randomUUID(), key: Crypto.randomUUID(), message: input.question },
    phase: "reserved", error: null, caseData: null, job: null, expiresAt: null, controller: new AbortController(), running: null };
  operations.set(operationId, record);
  notify(record);
  return execute(record);
}

export function appendManagedOperation(operationId: string, caseData: InvestigationCase, input: Omit<CreateCase, "deviceProfile">) {
  const existing = requireOperation(operationId, caseData.id);
  if (existing) return execute(existing);
  if (operations.has(operationId)) return Promise.reject(new Error("Operation ownership conflict: this operation belongs to another investigation."));
  const record: ManagedOperation = { operationId, caseId: caseData.id, kind: "append", input, files: [], fileIndex: 0, handle: null,
    revision: 0, evidenceIndex: 0, evidenceIds: [], turn: { turnId: Crypto.randomUUID(), key: Crypto.randomUUID(), message: input.question },
    phase: "reserved", error: null, caseData, job: null, expiresAt: caseData.expiresAt, controller: new AbortController(), running: null };
  operations.set(operationId, record);
  operationPairs.set(pairKey(operationId, caseData.id), operationId);
  scheduleExpiry(record);
  notify(record);
  return execute(record);
}

export function retryManagedOperation(operationId: string, caseId?: string | null) {
  const record = requireOperation(operationId, caseId);
  return record ? execute(record) : Promise.resolve(null);
}

export function managedOperation(operationId: string, caseId?: string | null) { return requireOperation(operationId, caseId); }

export function subscribeManagedOperation(operationId: string, listener: (record: ManagedOperation) => void) {
  const scoped = listeners.get(operationId) ?? new Set<(record: ManagedOperation) => void>();
  scoped.add(listener); listeners.set(operationId, scoped);
  const current = operations.get(operationId); if (current) listener(current);
  return () => { scoped.delete(listener); if (!scoped.size) listeners.delete(operationId); };
}

export function settleManagedOperation(operationId: string, caseId: string, caseData: InvestigationCase, job: Job | null) {
  const record = requireOperation(operationId, caseId);
  if (record) publish(record, { caseData, job, phase: "settled", error: job?.failure?.message ?? null });
}

export function expireOperation(operationId: string, caseId?: string | null) {
  const record = requireOperation(operationId, caseId);
  if (!record) return;
  releaseFiles(record);
  publish(record, { phase: "expired", error: "This temporary investigation operation expired." });
}

export function cancelManagedOperation(operationId: string, caseId?: string | null) {
  const record = requireOperation(operationId, caseId);
  if (!record) return;
  releaseFiles(record);
  publish(record, { phase: "cancelled", error: null });
}