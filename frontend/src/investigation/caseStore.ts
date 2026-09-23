// Case-scoped UI projection. Application-owned create/upload/append operations live in transferManager and survive screens.
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { stopHiggins } from "@/src/voice/higgins";
import { forgetCase } from "./caseIndex";
import * as api from "./client";
import { observe } from "./deviceBroker";
import { appendManagedOperation, cancelManagedOperation, expireOperation, managedOperation, retryManagedOperation,
  settleManagedOperation, startManagedOperation, subscribeManagedOperation, type ManagedOperation } from "./transferManager";
import type { CreateCase, DeviceResult, Failure, HigginsResponse, InvestigationCase, InvestigationEvent, Job, Question, SourceReference, TurnCommit } from "./types";

export type Phase = "idle" | "creating" | "working" | "reconnecting" | "waiting_device" | "waiting_user" | "answered" | "failed" | "expired";
export interface CaseState {
  phase: Phase; operationId: string | null; caseData: InvestigationCase | null; job: Job | null; progress: string[];
  response: HigginsResponse | null; sources: SourceReference[]; turns: TurnCommit[]; failure: Failure | null;
  question: Question | null; error: string | null; notice: string | null; undeleted?: string | null;
}

const EMPTY: CaseState = { phase: "idle", operationId: null, caseData: null, job: null, progress: [], response: null,
  sources: [], turns: [], failure: null, question: null, error: null, notice: null };
const UNDELETED_KEY = "apollo.investigation.undeleted";

async function pendingDeletions(): Promise<string[]> {
  const raw = await storage.getItem<string | null>(UNDELETED_KEY, null).catch(() => null);
  try { return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
}
async function rememberDeletion(id: string) { const ids = await pendingDeletions(); if (!ids.includes(id)) await storage.setItem(UNDELETED_KEY, JSON.stringify([...ids, id])).catch(() => undefined); }
async function forgetDeletion(id: string) { await storage.setItem(UNDELETED_KEY, JSON.stringify((await pendingDeletions()).filter((value) => value !== id))).catch(() => undefined); }

export function useInvestigation(boundOperationId?: string | null) {
  const [state, setState] = useState<CaseState>(EMPTY);
  const stream = useRef<{ abort: () => void; lastSequence: () => number } | null>(null);
  const pending = useRef<{ turnId: string; key: string; message: string; answerTo: string | null } | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caseRef = useRef<InvestigationCase | null>(null);
  const operationRef = useRef<string | null>(boundOperationId ?? null);
  const followed = useRef<string | null>(null);
  const generation = useRef(0);
  const pendingCancellation = useRef<{ caseId: string; jobId: string } | null>(null);
  const pendingDeviceResult = useRef<{ caseId: string; result: DeviceResult; job: Job; after: number } | null>(null);
  const cancelAction = useRef<() => Promise<void>>(async () => undefined);
  const update = (patch: Partial<CaseState> | ((previous: CaseState) => Partial<CaseState>)) => setState((previous) => ({ ...previous, ...(typeof patch === "function" ? patch(previous) : patch) }));

  const refresh = useCallback(async (caseId: string, gen = generation.current) => {
    const [{ case: caseData }, turns, sources] = await Promise.all([api.getCase(caseId), api.listTurns(caseId), api.listSources(caseId)]);
    if (gen !== generation.current || (caseRef.current && caseRef.current.id !== caseId)) return caseData;
    caseRef.current = caseData;
    update({ caseData, turns: turns.items, sources: sources.items, response: caseData.response, question: caseData.response?.question ?? null });
    return caseData;
  }, []);

  const flushPendingDeletions = useCallback(async () => {
    for (const id of await pendingDeletions()) {
      try { await api.deleteCase(id); await forgetDeletion(id); }
      catch (error: unknown) { if (error instanceof ApiError && (error.status === 404 || error.status === 410)) await forgetDeletion(id); }
    }
    update({ undeleted: (await pendingDeletions())[0] ?? null });
  }, []);

  const armExpiry = useCallback((caseData: InvestigationCase) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const gen = generation.current;
    expiryTimer.current = setTimeout(() => {
      if (gen !== generation.current || caseRef.current?.id !== caseData.id) return;
      stream.current?.abort(); stopHiggins(); pending.current = null; followed.current = null;
      generation.current += 1; caseRef.current = null; expiryTimer.current = null;
      if (operationRef.current) expireOperation(operationRef.current, caseData.id);
      setState({ ...EMPTY, phase: "expired", operationId: operationRef.current,
        error: "This temporary investigation reached its 15-minute limit and was cleared. Submit the evidence again for a new check." });
    }, Math.max(0, Date.parse(caseData.expiresAt) - Date.now()));
  }, []);

  const follow = useCallback((caseId: string, job: Job, after = 0) => {
    stream.current?.abort();
    const gen = generation.current;
    const operationId = operationRef.current;
    const live = () => gen === generation.current && caseRef.current?.id === caseId;
    update({ job, phase: "working" });
    stream.current = api.streamEvents(caseId, job.id, after, (event: InvestigationEvent) => {
      if (!live() || event.caseId !== caseId || event.jobId !== job.id) return;
      if (event.type === "progress") update((previous) => ({ progress: [...previous.progress.slice(-6), event.payload.message] }));
      else if (event.type === "response") update({ response: event.payload.response, sources: event.payload.sources, question: event.payload.response.question });
      else if (event.type === "retry_scheduled") update((previous) => ({ progress: [...previous.progress.slice(-6), event.payload.failure.message], phase: "reconnecting" }));
      else if (event.type === "device_request") {
        update({ phase: "waiting_device" });
        const consumed = event.sequence;
        void observe(event.payload).then((result) => { pendingDeviceResult.current = { caseId, result, job, after: consumed }; return api.submitDeviceResult(caseId, result); }).then(({ jobId }) => {
          pendingDeviceResult.current = null; if (live()) follow(caseId, { ...job, id: jobId ?? job.id }, consumed);
        }).catch(() => { if (live()) update({ phase: "failed", error: "Apollo couldn't safely deliver this device observation. Retry sends the same observation without starting a new check." }); });
      } else if (event.type === "completed") {
        pending.current = null;
        void refresh(caseId, gen).then((caseData) => {
          if (!live()) return;
          update({ phase: event.payload.completion === "waiting_user" ? "waiting_user" : "answered", failure: null, caseData });
          if (operationId) settleManagedOperation(operationId, caseId, caseData, { ...job, status: event.payload.caseStatus });
        }).catch(() => undefined);
      } else if (event.type === "partial") update({ failure: event.payload.reason });
      else if (event.type === "failed") {
        const failed = { ...job, status: "failed" as const, failure: event.payload };
        update({ phase: "failed", failure: event.payload, error: event.payload.message, job: failed });
        void refresh(caseId, gen).then((caseData) => { if (live() && operationId) settleManagedOperation(operationId, caseId, caseData, failed); }).catch(() => undefined);
      } else if (event.type === "cancelled") {
        pending.current = null;
        void refresh(caseId, gen).then((caseData) => { if (live()) update({ phase: caseData.response ? "answered" : "idle", progress: [] }); }).catch(() => undefined);
      } else if (event.type === "expired") {
        if (operationId) expireOperation(operationId, caseId);
        stopHiggins(); setState({ ...EMPTY, phase: "expired", operationId, error: "Temporary evidence expired before Higgins finished." });
      }
    }, (reason) => {
      if (!live() || reason === "terminal") return;
      if (reason === "unauthorized") { update({ phase: "failed", error: "Apollo needs to re-register this device." }); return; }
      update({ phase: "reconnecting" });
      setTimeout(() => {
        if (!live()) return;
        api.getJob(caseId, job.id).then(({ job: fresh }) => {
          if (!live()) return;
          if (["queued", "investigating", "retry_wait", "waiting_device"].includes(fresh.status)) follow(caseId, fresh, stream.current?.lastSequence() ?? 0);
          else void refresh(caseId, gen).then((caseData) => {
            if (!live()) return;
            update({ phase: fresh.status === "failed" ? "failed" : caseData.response?.question ? "waiting_user" : "answered",
              failure: fresh.failure, error: fresh.failure?.message ?? null, job: fresh });
            if (operationId) settleManagedOperation(operationId, caseId, caseData, fresh);
          }).catch(() => undefined);
        }).catch((error: unknown) => { if (live()) update({ phase: "failed", error: error instanceof ApiError && error.status === 410 ? "This investigation expired." : "Connection lost. Retry to reconnect to the same investigation." }); });
      }, 1500);
    });
  }, [refresh]);

  const adoptManaged = useCallback((record: ManagedOperation) => {
    if (operationRef.current !== record.operationId) return;
    if (record.caseData) { caseRef.current = record.caseData; armExpiry(record.caseData); }
    const progress = record.phase === "failed" ? ["This exact operation is ready to retry."]
      : record.phase === "submitted" || record.phase === "settled" ? ["The operation is attached to this investigation."]
      : ["Apollo is continuing this investigation operation."];
    update({ operationId: record.operationId, caseData: record.caseData, job: record.job, error: record.error, progress,
      phase: record.phase === "failed" ? "failed" : record.phase === "expired" ? "expired" : record.phase === "settled"
        ? record.caseData?.response?.question ? "waiting_user" : record.caseData?.response ? "answered" : "idle" : "working",
      response: record.caseData?.response ?? null, question: record.caseData?.response?.question ?? null });
    if (record.caseData && record.job && record.phase === "submitted") {
      const key = `${record.operationId}:${record.caseData.id}:${record.job.id}`;
      if (followed.current !== key) { followed.current = key; follow(record.caseData.id, record.job); }
    }
  }, [armExpiry, follow]);

  useEffect(() => {
    if (!boundOperationId) return;
    stream.current?.abort(); generation.current += 1; followed.current = null; operationRef.current = boundOperationId;
    const unsubscribe = subscribeManagedOperation(boundOperationId, adoptManaged);
    return unsubscribe;
  }, [boundOperationId, adoptManaged]);

  const start = useCallback(async (input: Omit<CreateCase, "deviceProfile">, files: { uri: string; name: string; mediaType: string }[] = [], operationId = boundOperationId ?? Crypto.randomUUID()) => {
    stream.current?.abort(); generation.current += 1; followed.current = null; operationRef.current = operationId; caseRef.current = null;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    setState((previous) => ({ ...EMPTY, undeleted: previous.undeleted, operationId, phase: "creating", progress: ["Creating the investigation case."] }));
    void flushPendingDeletions();
    const unsubscribe = subscribeManagedOperation(operationId, adoptManaged);
    const record = await startManagedOperation(operationId, input, files);
    adoptManaged(record); unsubscribe();
    return record.phase === "failed" || record.phase === "expired" ? null : record.caseData;
  }, [adoptManaged, boundOperationId, flushPendingDeletions]);

  const ask = useCallback(async (message: string) => {
    const caseData = caseRef.current ?? state.caseData; if (!caseData) return false;
    const turn = pending.current?.message === message ? pending.current : { turnId: Crypto.randomUUID(), key: Crypto.randomUUID(), message,
      answerTo: (caseRef.current?.response?.question ?? state.question)?.id ?? null };
    pending.current = turn;
    update({ phase: "working", error: null, notice: null, failure: null, progress: ["Sending your follow-up to Higgins."] });
    const gen = generation.current; const live = () => gen === generation.current && caseRef.current?.id === caseData.id;
    try {
      const fresh = await api.getCase(caseData.id); if (!live()) return false;
      const { job } = await api.submitTurn(caseData.id, { expectedRevision: fresh.case.revision, turnId: turn.turnId, message,
        answerToQuestionId: turn.answerTo, evidenceIds: [] }, turn.key);
      if (!live()) return false; update({ caseData: fresh.case }); follow(caseData.id, job); return true;
    } catch (error: unknown) { if (live()) update({ phase: "failed", error: error instanceof Error ? error.message : "Higgins could not take this follow-up." }); return false; }
  }, [state.caseData, state.question, follow]);

  const continueWith = useCallback(async (input: Omit<CreateCase, "deviceProfile">, operationId = boundOperationId ?? Crypto.randomUUID()) => {
    const caseData = caseRef.current ?? state.caseData; if (!caseData || (caseData.activeJobId && !managedOperation(operationId, caseData.id))) return false;
    operationRef.current = operationId; followed.current = null;
    const unsubscribe = subscribeManagedOperation(operationId, adoptManaged);
    try {
      const record = await appendManagedOperation(operationId, caseData, input); adoptManaged(record); return record.phase !== "failed";
    } catch (error: unknown) { update({ phase: "failed", error: error instanceof Error ? error.message : "Apollo could not append the fresh observation." }); return false; }
    finally { unsubscribe(); }
  }, [adoptManaged, boundOperationId, state.caseData]);

  const retry = useCallback(async () => {
    const caseData = caseRef.current ?? state.caseData;
    if (pendingDeviceResult.current) {
      const pendingResult = pendingDeviceResult.current; update({ phase: "working", error: null, progress: ["Retrying the same device observation."] });
      try { const { jobId } = await api.submitDeviceResult(pendingResult.caseId, pendingResult.result); pendingDeviceResult.current = null; follow(pendingResult.caseId, { ...pendingResult.job, id: jobId ?? pendingResult.job.id }, pendingResult.after); }
      catch { update({ phase: "failed", error: "Apollo still couldn't safely deliver this device observation. Retry remains available." }); }
      return;
    }
    if (operationRef.current) {
      const record = managedOperation(operationRef.current, caseData?.id);
      if (record?.phase === "failed") { update({ phase: "working", error: null, notice: null, progress: ["Resuming this exact operation."] }); adoptManaged((await retryManagedOperation(record.operationId, record.caseId))!); return; }
    }
    if (pendingCancellation.current) { await cancelAction.current(); return; }
    if (pending.current && (!state.job || state.job.status !== "failed")) { await ask(pending.current.message); return; }
    if (!caseData || !state.job) return;
    const gen = generation.current; const live = () => gen === generation.current && caseRef.current?.id === caseData.id;
    try { const fresh = await api.getCase(caseData.id); if (!live()) return; const { job } = await api.resumeJob(caseData.id, state.job.id, fresh.case.revision); if (live()) follow(caseData.id, job); }
    catch (error: unknown) { if (live()) update({ phase: "failed", error: error instanceof Error ? error.message : "Could not resume." }); }
  }, [state.caseData, state.job, ask, adoptManaged, follow]);

  const cancel = useCallback(async () => {
    const { caseData, job } = state; if (!caseData || !job) return;
    pendingCancellation.current = { caseId: caseData.id, jobId: job.id };
    update({ phase: "working", error: null, notice: null, progress: ["Requesting cancellation. Work remains connected until Apollo confirms it stopped."] });
    const gen = generation.current; const live = () => gen === generation.current && caseRef.current?.id === caseData.id;
    try {
      const result = await api.cancelJob(caseData.id, job.id, caseData.revision); const fresh = await refresh(caseData.id, gen); if (!live()) return;
      pendingCancellation.current = null;
      if (result.cancelled) { stream.current?.abort(); pending.current = null; if (operationRef.current) cancelManagedOperation(operationRef.current, caseData.id);
        update({ phase: fresh.response ? "answered" : "idle", progress: [], error: null,
          notice: "The active turn was cancelled. Existing case evidence remains available until its deadline." }); return; }
      if (result.outcome === "completed" || fresh.response) {
        stream.current?.abort(); pending.current = null;
        if (operationRef.current) settleManagedOperation(operationRef.current, caseData.id, fresh, null);
        update({ phase: fresh.response?.question ? "waiting_user" : "answered", response: fresh.response, question: fresh.response?.question ?? null,
          progress: [], error: null, notice: "Higgins finished before cancellation took effect, so the completed answer is shown." });
        return;
      }
      if (result.outcome === "failed") { stream.current?.abort(); update({ phase: "failed", progress: [], notice: null,
        error: "This turn finished with an error before cancellation took effect." }); return; }
      if (!["complete", "failed", "cancelled", "expired", "waiting_user"].includes(result.status) && fresh.activeJobId) {
        const active = (await api.getJob(caseData.id, fresh.activeJobId)).job;
        update({ notice: "This turn was no longer active; Apollo stayed connected to the current work." }); follow(caseData.id, active);
      } else { stream.current?.abort(); update({ notice: "This turn was no longer active, so no cancellation was applied." }); }
    } catch (error: unknown) {
      if (live()) update({ phase: "failed", notice: null, error: error instanceof ApiError && error.status === 409
        ? "Cancellation was not confirmed because this is no longer the same active turn. Retry against current work."
        : "Cancellation was not confirmed. Apollo kept the investigation connected; Retry to try again." });
    }
  }, [state, refresh, follow]);
  useEffect(() => { cancelAction.current = cancel; }, [cancel]);

  const attach = useCallback(async (caseId: string) => {
    stream.current?.abort(); pending.current = null; generation.current += 1; followed.current = null;
    if (expiryTimer.current) clearTimeout(expiryTimer.current); caseRef.current = { id: caseId } as InvestigationCase;
    setState((previous) => ({ ...EMPTY, undeleted: previous.undeleted, operationId: operationRef.current, phase: "creating", progress: ["Opening the investigation."] }));
    void flushPendingDeletions(); const gen = generation.current; const live = () => gen === generation.current && caseRef.current?.id === caseId;
    try {
      const caseData = await refresh(caseId, gen); if (!live()) return null; armExpiry(caseData);
      if (caseData.activeJobId) { const { job } = await api.getJob(caseId, caseData.activeJobId); if (live()) follow(caseId, job); }
      else update({ phase: caseData.status === "failed" ? "failed" : caseData.response?.question ? "waiting_user" : caseData.response ? "answered" : "idle" });
      return caseData;
    } catch (error: unknown) { if (live()) update({ phase: error instanceof ApiError && error.status === 410 ? "expired" : "failed", error: error instanceof Error ? error.message : "Could not open this investigation." }); return null; }
  }, [refresh, armExpiry, follow, flushPendingDeletions]);

  const remove = useCallback(async () => {
    const caseData = state.caseData; stream.current?.abort(); pending.current = null;
    if (operationRef.current) cancelManagedOperation(operationRef.current, caseData?.id);
    if (expiryTimer.current) clearTimeout(expiryTimer.current); generation.current += 1; caseRef.current = null; operationRef.current = null;
    stopHiggins(); setState((previous) => ({ ...EMPTY, undeleted: previous.undeleted }));
    if (caseData) { await forgetCase(caseData.id); try { await api.deleteCase(caseData.id); } catch { await rememberDeletion(caseData.id); update({ error: "Local view cleared; server deletion could not be confirmed.", undeleted: caseData.id }); } }
  }, [state.caseData]);

  const retryDelete = useCallback(async () => {
    const id = state.undeleted; if (!id) return;
    try { await api.deleteCase(id); await forgetDeletion(id); update({ undeleted: null, error: null }); }
    catch (error: unknown) { if (error instanceof ApiError && (error.status === 404 || error.status === 410)) { await forgetDeletion(id); update({ undeleted: null, error: null }); } }
  }, [state.undeleted]);

  useEffect(() => () => { stream.current?.abort(); if (expiryTimer.current) clearTimeout(expiryTimer.current); }, []);
  return { state, start, ask, continueWith, retry, cancel, remove, attach, retryDelete };
}