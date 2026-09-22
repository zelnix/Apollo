// Case-scoped state: one active case, its job stream, accepted turns, sources and expiry. Keyed by case; one case's expiry never clears another.
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/src/api/client";
import * as api from "./client";
import { currentDeviceProfile, observe } from "./deviceBroker";
import { forgetCase } from "./caseIndex";
import { storage } from "@/src/utils/storage";
import { stopHiggins } from "@/src/voice/higgins";
import { disposePickerCopy } from "@/src/domain/fileCopyLifecycle";
import { beginObservation, cancelObservations, cancelTransfer, completeObservation, completeTransfer, failTransfer, getTransfer, latestTransfer,
  latestObservation, observationForCase, retainTransfer, subscribeTransfers, updateObservation, updateTransfer, type PendingTransfer } from "./transferManager";
import type { CreateCase, Failure, HigginsResponse, InvestigationCase, InvestigationEvent, Job, Question, SourceReference, TurnCommit } from "./types";

export type Phase = "idle" | "creating" | "working" | "reconnecting" | "waiting_device" | "waiting_user" | "answered" | "failed" | "expired";

export interface CaseState {
  phase: Phase; caseData: InvestigationCase | null; job: Job | null; progress: string[]; response: HigginsResponse | null;
  sources: SourceReference[]; turns: TurnCommit[]; failure: Failure | null; question: Question | null; error: string | null;
  undeleted?: string | null; // case whose server deletion still needs to be retried
}

// A file-upload (or the turn submission right after it) that failed keeps enough state here to RESUME on the exact
// same case, from the exact chunk reached, on retry — never by recreating the case or re-reading the original file.
const EMPTY: CaseState = { phase: "idle", caseData: null, job: null, progress: [], response: null, sources: [], turns: [], failure: null, question: null, error: null };

// Deletions that could not be confirmed survive navigation and app restarts until the server confirms them (S07).
const UNDELETED_KEY = "apollo.investigation.undeleted";
async function pendingDeletions(): Promise<string[]> {
  const raw = await storage.getItem<string | null>(UNDELETED_KEY, null).catch(() => null);
  try { return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
}
async function rememberDeletion(id: string) { const ids = await pendingDeletions(); if (!ids.includes(id)) await storage.setItem(UNDELETED_KEY, JSON.stringify([...ids, id])).catch(() => undefined); }
async function forgetDeletion(id: string) { const ids = (await pendingDeletions()).filter((x) => x !== id); await storage.setItem(UNDELETED_KEY, JSON.stringify(ids)).catch(() => undefined); }
/** A case created for a screen the person already left: delete it now, or remember to. */
async function abandon(id: string) { try { await api.deleteCase(id); } catch { await rememberDeletion(id); } await forgetCase(id); }

export function useInvestigation() {
  const [state, setState] = useState<CaseState>(EMPTY);
  const stream = useRef<{ abort: () => void; lastSequence: () => number } | null>(null);
  const pending = useRef<{ turnId: string; key: string; message: string; answerTo: string | null } | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caseRef = useRef<InvestigationCase | null>(null);
  const generation = useRef(0); // bumped on start/attach/remove: stale callbacks from an older case are ignored
  const pendingUpload = useRef<PendingTransfer | null>(latestTransfer());
  const pendingCancellation = useRef<{ caseId: string; jobId: string } | null>(null);
  const cancelAction = useRef<() => Promise<void>>(async () => undefined);
  const update = (patch: Partial<CaseState> | ((prev: CaseState) => Partial<CaseState>)) => setState((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));

  /** Publishes only if the captured generation is still current and the case is still the one being viewed (S07). */
  const refresh = useCallback(async (caseId: string, gen: number = generation.current) => {
    const [{ case: caseData }, turns, sources] = await Promise.all([api.getCase(caseId), api.listTurns(caseId), api.listSources(caseId)]);
    if (gen !== generation.current || (caseRef.current && caseRef.current.id !== caseId)) return caseData; // obsolete: discard, never display old content in a new case
    caseRef.current = caseData;
    update({ caseData, turns: turns.items, sources: sources.items, response: caseData.response, question: caseData.response?.question ?? null });
    return caseData;
  }, []);

  /** Server deletions that could not be confirmed are retried on the next start/attach and remain visible until they succeed. */
  const flushPendingDeletions = useCallback(async () => {
    const ids = await pendingDeletions();
    for (const id of ids) {
      try { await api.deleteCase(id); await forgetDeletion(id); }
      catch (e: unknown) { if (e instanceof ApiError && (e.status === 404 || e.status === 410)) await forgetDeletion(id); }
    }
    const remaining = await pendingDeletions();
    update({ undeleted: remaining[0] ?? null });
  }, []);

  const armExpiry = useCallback((caseData: InvestigationCase) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const gen = generation.current;
    expiryTimer.current = setTimeout(() => { if (gen !== generation.current) return; stream.current?.abort(); cancelTransfer(caseData.id); cancelObservations(caseData.id);
      pendingUpload.current = null; stopHiggins(); setState({ ...EMPTY, phase: "expired", error: "This temporary investigation reached its 15-minute limit and was cleared. Submit the evidence again for a new check." }); }, Math.max(0, Date.parse(caseData.expiresAt) - Date.now()));
  }, []);

  // A recreated screen attaches to the application-owned transfer rather than creating a new case/upload.
  useEffect(() => {
    const transfer = latestTransfer();
    if (transfer && !transfer.closed) {
      pendingUpload.current = transfer;
      void api.getCase(transfer.caseId).then(({ case: caseData }) => {
        caseRef.current = caseData; armExpiry(caseData);
        update({ caseData, phase: transfer.phase === "failed" ? "failed" : "working", error: transfer.error,
          progress: [transfer.phase === "failed" ? "The file operation is ready to retry." : "Reattached to the active file operation."] });
      }).catch(() => undefined);
    } else {
      const observation = latestObservation();
      if (observation) void api.getCase(observation.caseId).then(({ case: caseData }) => {
        caseRef.current = caseData; armExpiry(caseData);
        update({ caseData, phase: "failed", error: observation.error ?? "A device observation is ready to resume.",
          progress: ["Reattached to the pending same-case observation."] });
      }).catch(() => undefined);
    }
    return subscribeTransfers((record) => {
      if (pendingUpload.current?.operationId !== record.operationId) return;
      pendingUpload.current = record;
      if (record.phase === "failed") update({ phase: "failed", error: record.error });
      if (record.phase === "expired") update({ phase: "expired", error: "The file operation expired and retained bytes were released." });
    });
  }, [armExpiry]);

  const follow = useCallback((caseId: string, job: Job, after = 0) => {
    stream.current?.abort();
    const gen = generation.current;
    const live = () => gen === generation.current && caseRef.current?.id === caseId;
    update({ job, phase: "working" });
    stream.current = api.streamEvents(caseId, job.id, after, (event: InvestigationEvent) => {
      if (!live()) return;
      if (event.type === "progress") update((prev) => ({ progress: [...prev.progress.slice(-6), event.payload.message] }));
      else if (event.type === "response") update({ response: event.payload.response, sources: event.payload.sources, question: event.payload.response.question });
      else if (event.type === "retry_scheduled") update((prev) => ({ progress: [...prev.progress.slice(-6), event.payload.failure.message], phase: "reconnecting" }));
      else if (event.type === "device_request") {
        update({ phase: "waiting_device" });
        const consumed = event.sequence;
        void observe(event.payload).then((result) => api.submitDeviceResult(caseId, result)).then(({ jobId }) => { if (live()) follow(caseId, { ...job, id: jobId ?? job.id }, consumed); })
          .catch((e: unknown) => { if (live()) update({ phase: "failed", error: e instanceof Error ? e.message : "Device observation could not be delivered." }); });
      } else if (event.type === "completed") { pending.current = null; void refresh(caseId, gen).then((c) => { if (live()) update({ phase: event.payload.completion === "waiting_user" ? "waiting_user" : "answered", failure: null, caseData: c }); }).catch(() => undefined); }
      else if (event.type === "partial") update({ failure: event.payload.reason });
      else if (event.type === "failed") { void refresh(caseId, gen).catch(() => undefined); update((prev) => ({ phase: "failed", failure: event.payload, error: event.payload.message, job: prev.job ? { ...prev.job, status: "failed", failure: event.payload } : prev.job })); }
      else if (event.type === "cancelled") { pending.current = null; void refresh(caseId, gen).then(() => { if (live()) update({ phase: "answered", progress: [] }); }).catch(() => undefined); }
      else if (event.type === "expired") { stopHiggins(); setState({ ...EMPTY, phase: "expired", error: "Temporary evidence expired before Higgins finished." }); }
    }, (reason) => {
      if (!live() || reason === "terminal") return;
      if (reason === "unauthorized") { update({ phase: "failed", error: "Apollo needs to re-register this device." }); return; }
      // EOF without a terminal event: transport interruption → poll the same job, reconnect from the last sequence.
      update({ phase: "reconnecting" });
      setTimeout(() => {
        if (!live()) return;
        api.getJob(caseId, job.id).then(({ job: fresh }) => {
          if (!live()) return;
          if (["queued", "investigating", "retry_wait", "waiting_device"].includes(fresh.status)) follow(caseId, fresh, stream.current?.lastSequence() ?? 0);
          else void refresh(caseId, gen).then((c) => { if (live()) update({ phase: fresh.status === "failed" ? "failed" : c.response?.question ? "waiting_user" : "answered", failure: fresh.failure, error: fresh.failure?.message ?? null, job: fresh }); }).catch(() => undefined);
        }).catch((e: unknown) => { if (live()) update({ phase: "failed", error: e instanceof ApiError && e.status === 410 ? "This investigation expired." : "Connection lost. Retry to reconnect to the same investigation." }); });
      }, 1500);
    });
  }, [refresh]);

  /** Uploads `files` from `startIndex` onward (resuming `startHandle` for the file already in progress, if any), then
   * submits the opening turn. Every step updates `pendingUpload.current` so a failure — network drop, chunk
   * rejected, turn submission interrupted — leaves exactly enough state for `retry()` to continue on the SAME
   * case, from the SAME point, without ever re-reading or discarding the person's original file. */
  const runFileUploads = useCallback(async (caseId: string, files: { uri: string; name: string; mediaType: string }[], question: string, startIndex: number, startRevision: number, gen: number, existing: PendingTransfer | null) => {
    const live = () => gen === generation.current;
    let revision = existing?.revision ?? startRevision;
    let operation = existing;
    for (let i = startIndex; i < files.length; i++) {
      const file = files[i];
      update((prev) => ({ progress: [...prev.progress, `Uploading ${file.name} for inspection.`] }));
      const kind = file.mediaType.startsWith("image/") ? "image" : file.mediaType.startsWith("audio/") ? "audio" : /pdf|word|text/.test(file.mediaType) ? "document" : "attachment";
      let handle = i === startIndex && operation ? operation.handle : api.createFileUploadHandle(caseRef.current?.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString());
      if (!operation || operation.fileIndex !== i) {
        operation = { operationId: handle.transferId, caseId, files: [...files], question, fileIndex: i, handle, revision,
          phase: "reserved", error: null, turn: null, controller: new AbortController(), closed: false };
        operation = retainTransfer(operation);
      }
      if (!operation) return null;
      const reserve = (next: api.FileUploadHandle) => {
        handle = next;
        const current = updateTransfer(caseId, operation!.operationId, { handle: next, revision, fileIndex: i,
          phase: next.bytes ? "uploading" : "reading", error: null });
        if (!current) throw new Error("This file operation expired or was cancelled.");
        operation = current; pendingUpload.current = current;
      };
      reserve(handle); // retry state exists before file I/O and before server session creation
      try {
        const result = await api.uploadFileEvidenceResumable(caseId, revision, file, kind, handle, reserve, operation.controller.signal);
        revision = result.caseRevision;
        // Publication is the acknowledgement boundary. The helper deletes only Apollo cache copies; original
        // document-provider/shared URIs remain untouched even though this call is deliberately best-effort.
        await disposePickerCopy(file.uri, true);
        const nextHandle = i + 1 < files.length ? api.createFileUploadHandle(operation.handle.expiresAt) : operation.handle;
        operation = updateTransfer(caseId, operation.operationId, { revision, fileIndex: i + 1, handle: nextHandle, phase: "uploading" });
        pendingUpload.current = operation;
      } catch (e: unknown) {
        if (!live()) return null;
        const message = e instanceof Error ? e.message : "Apollo could not finish uploading this file. Retry to continue from where it stopped — the original file is kept.";
        if (operation) failTransfer(operation, message);
        update({ phase: "failed", error: message });
        return "failed" as const;
      }
      if (!live()) return null;
    }
    if (!operation) return null;
    const turn = operation.turn ?? { turnId: Crypto.randomUUID(), key: Crypto.randomUUID(), message: question };
    operation = updateTransfer(caseId, operation.operationId, { fileIndex: files.length, revision, phase: "submitting", turn });
    if (!operation) return null;
    pendingUpload.current = operation; pending.current = { ...turn, answerTo: null };
    update((prev) => ({ progress: [...prev.progress, "Sending your question to Higgins."] }));
    try {
      const { job } = await api.submitTurn(caseId, { expectedRevision: revision, turnId: turn.turnId, message: question, answerToQuestionId: null, evidenceIds: [] }, turn.key, operation.controller.signal);
      if (!live()) return null;
      const caseData = (await api.getCase(caseId)).case;
      if (!live()) return null;
      completeTransfer(caseId, operation.operationId); pendingUpload.current = null;
      caseRef.current = caseData; update({ caseData }); armExpiry(caseData); follow(caseData.id, job);
      return caseData;
    } catch (e: unknown) {
      if (!live()) return null;
      const message = e instanceof Error ? e.message : "Apollo could not submit this question. Retry — the uploaded evidence is kept.";
      failTransfer(operation, message); update({ phase: "failed", error: message });
      return "failed" as const;
    }
  }, [armExpiry, follow]);

  const start = useCallback(async (input: Omit<CreateCase, "deviceProfile">, files: { uri: string; name: string; mediaType: string }[] = []) => {
    stream.current?.abort(); generation.current++; if (expiryTimer.current) clearTimeout(expiryTimer.current); caseRef.current = null; pendingUpload.current = null;
    setState((prev) => ({ ...EMPTY, undeleted: prev.undeleted, phase: "creating", progress: ["Creating the investigation case."] }));
    void flushPendingDeletions();
    const gen = generation.current;
    const live = () => gen === generation.current;
    let created: InvestigationCase | null = null;
    try {
      // With files: open the case, upload every original first (inventory before synthesis), then ask.
      const opened = await api.createCase({ ...input, question: files.length ? "" : input.question, deviceProfile: currentDeviceProfile() });
      created = opened.case;
      if (!live()) { await abandon(created.id); return null; } // navigated away while the case was being created: never orphan it until expiry
      caseRef.current = created; armExpiry(created);
      if (files.length) {
        // The case already exists and is visible in state from here on, so a failure anywhere below still leaves
        // `state.caseData` set — the retry affordance depends on it, and this case is exactly what retry resumes.
        update({ caseData: created });
        const outcome = await runFileUploads(created.id, files, input.question, 0, created.revision, gen, null);
        return outcome === "failed" ? null : outcome;
      }
      caseRef.current = created; update({ caseData: created }); if (opened.job) follow(created.id, opened.job);
      return created;
    } catch (e: unknown) {
      if (!live()) { if (created) await abandon(created.id); return null; }
      update({ phase: "failed", error: e instanceof Error ? e.message : "Apollo could not open the investigation." }); return null;
    }
  }, [armExpiry, follow, flushPendingDeletions, runFileUploads]);

  const ask = useCallback(async (message: string) => {
    const caseData = caseRef.current ?? state.caseData; if (!caseData) return false;
    const turn = pending.current?.message === message ? pending.current : { turnId: Crypto.randomUUID(), key: Crypto.randomUUID(), message, answerTo: (caseRef.current?.response?.question ?? state.question)?.id ?? null };
    pending.current = turn;
    update({ phase: "working", error: null, failure: null, progress: ["Sending your follow-up to Higgins."] });
    const gen = generation.current;
    const live = () => gen === generation.current && caseRef.current?.id === caseData.id;
    try {
      const fresh = await api.getCase(caseData.id);
      if (!live()) return false;
      const { job } = await api.submitTurn(caseData.id, { expectedRevision: fresh.case.revision, turnId: turn.turnId, message, answerToQuestionId: turn.answerTo, evidenceIds: [] }, turn.key);
      if (!live()) return false;
      update({ caseData: fresh.case }); follow(caseData.id, job);
      return true;
    } catch (e: unknown) { if (live()) update({ phase: "failed", error: e instanceof Error ? e.message : "Higgins could not take this follow-up." }); return false; }
  }, [state.caseData, state.question, follow]);

  /** Resume one application-owned observation operation; stable item/turn identities survive screen recreation. */
  const continueWith = useCallback(async (input: Omit<CreateCase, "deviceProfile">, operationId = Crypto.randomUUID()) => {
    const caseData = caseRef.current ?? state.caseData;
    if (!caseData) return false;
    let operation = observationForCase(caseData.id);
    if (!operation && caseData.activeJobId) return false;
    if (!operation) {
      const submissions = [...input.submissions];
      if (input.initialFindings.length) submissions.push({ clientItemId: Crypto.randomUUID(), kind: "text", value: input.initialFindings.join("\n"), label: "fresh Apollo observations" });
      const ownedInput = { ...input, submissions, initialFindings: [] };
      operation = beginObservation({ operationId, caseId: caseData.id, input: ownedInput, revision: 0, evidenceIndex: 0, evidenceIds: [],
        turn: { turnId: Crypto.randomUUID(), key: Crypto.randomUUID(), message: input.question }, phase: "appending", error: null,
        controller: new AbortController() });
    }
    const gen = generation.current;
    const live = () => gen === generation.current && caseRef.current?.id === caseData.id;
    update({ phase: "working", error: null, failure: null, progress: ["Adding the fresh observation to this investigation."] });
    try {
      let revision = operation.revision || (await api.getCase(caseData.id)).case.revision;
      for (let index = operation.evidenceIndex; index < operation.input.submissions.length; index++) {
        const added = await api.addSubmissionEvidence(caseData.id, revision, operation.input.submissions[index], operation.controller.signal);
        revision = added.caseRevision; operation.evidenceIds.push(added.evidence.id);
        if (!updateObservation(operation.operationId, { revision, evidenceIndex: index + 1, evidenceIds: operation.evidenceIds })) return false;
      }
      if (!live()) return false;
      if (!updateObservation(operation.operationId, { phase: "submitting", revision })) return false;
      pending.current = { ...operation.turn, answerTo: null };
      const { job } = await api.submitTurn(caseData.id, { expectedRevision: revision, turnId: operation.turn.turnId, message: operation.turn.message,
        answerToQuestionId: null, evidenceIds: operation.evidenceIds }, operation.turn.key, operation.controller.signal);
      if (!live()) return false;
      const fresh = (await api.getCase(caseData.id)).case;
      completeObservation(operation.operationId);
      caseRef.current = fresh; update({ caseData: fresh }); follow(caseData.id, job);
      return true;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Apollo could not append the fresh observation to this investigation.";
      updateObservation(operation.operationId, { phase: "failed", error: message });
      if (live()) update({ phase: "failed", error: message });
      return false;
    }
  }, [state.caseData, follow]);

  const retry = useCallback(async () => {
    const transfer = pendingUpload.current ?? (caseRef.current ? getTransfer(caseRef.current.id) : null);
    if (transfer && caseRef.current?.id === transfer.caseId) {
      if (transfer.closed || transfer.phase === "expired") { pendingUpload.current = null; update({ phase: "expired", error: "This file operation expired; select the file again." }); return; }
      const { caseId, files, question, fileIndex, revision } = transfer;
      update({ phase: "working", error: null, progress: ["Resuming the file upload — the original file was kept."] });
      const gen = generation.current;
      pendingUpload.current = transfer;
      await runFileUploads(caseId, files, question, fileIndex, revision, gen, transfer);
      return;
    }
    const { caseData, job } = state; if (!caseData) return;
    const observation = observationForCase(caseData.id);
    if (observation) { await continueWith(observation.input, observation.operationId); return; }
    if (pendingCancellation.current) { await cancelAction.current(); return; }
    if (pending.current && (!job || job.status !== "failed")) { await ask(pending.current.message); return; }
    if (!job) return;
    update({ phase: "working", error: null, progress: ["Resuming the same turn."] });
    const gen = generation.current;
    const live = () => gen === generation.current && caseRef.current?.id === caseData.id;
    try { const fresh = await api.getCase(caseData.id); if (!live()) return; const { job: resumed } = await api.resumeJob(caseData.id, job.id, fresh.case.revision); if (live()) follow(caseData.id, resumed); }
    catch (e: unknown) { if (live()) update({ phase: "failed", error: e instanceof Error ? e.message : "Could not resume." }); }
  }, [state, ask, continueWith, follow, runFileUploads]);

  const cancel = useCallback(async () => {
    const { caseData, job } = state; if (!caseData || !job) return;
    pendingCancellation.current = { caseId: caseData.id, jobId: job.id };
    update({ phase: "working", error: null, progress: ["Requesting cancellation. Work remains connected until Apollo confirms it stopped."] });
    const gen = generation.current;
    const live = () => gen === generation.current && caseRef.current?.id === caseData.id;
    try {
      const result = await api.cancelJob(caseData.id, job.id, caseData.revision);
      const fresh = await refresh(caseData.id, gen);
      if (!live()) return;
      pendingCancellation.current = null;
      if (result.cancelled) {
        stream.current?.abort(); pending.current = null; pendingUpload.current = null; cancelTransfer(caseData.id); cancelObservations(caseData.id);
        update({ phase: fresh.response ? "answered" : "idle", progress: [], error: fresh.response ? null : "Investigation cancelled." });
        return;
      }
      const terminal = ["completed", "failed", "cancelled", "expired", "waiting_user"].includes(result.status);
      if (!terminal && fresh.activeJobId) { const current = await api.getJob(caseData.id, fresh.activeJobId); follow(caseData.id, current.job); }
      else stream.current?.abort();
      update({ phase: fresh.response ? "answered" : result.status === "failed" ? "failed" : "idle", progress: [],
        error: result.status === "failed" ? "The investigation had already failed before cancellation was requested." : null });
    } catch (e: unknown) {
      if (!live()) return;
      try {
        const fresh = await refresh(caseData.id, gen);
        if (fresh.activeJobId) { const current = await api.getJob(caseData.id, fresh.activeJobId); follow(caseData.id, current.job); }
      } catch { /* preserve the existing stream when authoritative refresh is unavailable */ }
      update({ phase: "failed", error: e instanceof ApiError && e.status === 409
        ? "Cancellation not confirmed because this is no longer the same active turn. Apollo reconnected to current work; Retry to request cancellation again."
        : "Cancellation not confirmed. Apollo kept the investigation connected; Retry to try again." });
    }
  }, [state, refresh, follow]);
  useEffect(() => { cancelAction.current = cancel; }, [cancel]);

  /** Continue an existing case (e.g. from a Gate screen handoff). Rejoins an active job stream if one is running. */
  const attach = useCallback(async (caseId: string) => {
    stream.current?.abort(); pending.current = null; pendingUpload.current = null; generation.current++; if (expiryTimer.current) clearTimeout(expiryTimer.current);
    caseRef.current = { id: caseId } as InvestigationCase;
    setState((prev) => ({ ...EMPTY, undeleted: prev.undeleted, phase: "creating", progress: ["Opening the investigation."] }));
    void flushPendingDeletions();
    const gen = generation.current;
    const live = () => gen === generation.current && caseRef.current?.id === caseId;
    try {
      const caseData = await refresh(caseId, gen); if (!live()) return null; armExpiry(caseData);
      if (caseData.activeJobId) { const { job } = await api.getJob(caseId, caseData.activeJobId); if (live()) follow(caseId, job, 0); }
      else update({ phase: caseData.status === "failed" ? "failed" : caseData.response?.question ? "waiting_user" : caseData.response ? "answered" : "idle" });
      return caseData;
    } catch (e: unknown) { if (live()) update({ phase: e instanceof ApiError && e.status === 410 ? "expired" : "failed", error: e instanceof Error ? e.message : "Could not open this investigation." }); return null; }
  }, [refresh, armExpiry, follow, flushPendingDeletions]);

  const remove = useCallback(async () => {
    const caseData = state.caseData; stream.current?.abort(); pending.current = null; pendingUpload.current = null;
    if (caseData) { cancelTransfer(caseData.id); cancelObservations(caseData.id); }
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    generation.current++; caseRef.current = null; stopHiggins(); setState((prev) => ({ ...EMPTY, undeleted: prev.undeleted }));
    if (caseData) { await forgetCase(caseData.id); try { await api.deleteCase(caseData.id); } catch { await rememberDeletion(caseData.id); update({ error: "Local view cleared; server deletion could not be confirmed.", undeleted: caseData.id }); } }
  }, [state.caseData]);

  const retryDelete = useCallback(async () => {
    const id = state.undeleted; if (!id) return;
    try { await api.deleteCase(id); await forgetDeletion(id); update({ undeleted: null, error: null }); } catch (e: unknown) { if (e instanceof ApiError && (e.status === 404 || e.status === 410)) { await forgetDeletion(id); update({ undeleted: null, error: null }); } }
  }, [state.undeleted]);
  useEffect(() => () => { stream.current?.abort(); if (expiryTimer.current) clearTimeout(expiryTimer.current); }, []);
  return { state, start, ask, continueWith, retry, cancel, remove, attach, retryDelete };
}
