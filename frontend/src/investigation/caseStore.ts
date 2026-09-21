// Case-scoped state: one active case, its job stream, accepted turns, sources and expiry. Keyed by case; one case's expiry never clears another.
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/src/api/client";
import * as api from "./client";
import { currentDeviceProfile, observe } from "./deviceBroker";
import { stopHiggins } from "@/src/voice/higgins";
import type { CreateCase, Failure, HigginsResponse, InvestigationCase, InvestigationEvent, Job, Question, SourceReference, TurnCommit } from "./types";

export type Phase = "idle" | "creating" | "working" | "reconnecting" | "waiting_device" | "waiting_user" | "answered" | "failed" | "expired";

export interface CaseState {
  phase: Phase; caseData: InvestigationCase | null; job: Job | null; progress: string[]; response: HigginsResponse | null;
  sources: SourceReference[]; turns: TurnCommit[]; failure: Failure | null; question: Question | null; error: string | null;
  undeleted?: string | null; // case whose server deletion still needs to be retried
}

const EMPTY: CaseState = { phase: "idle", caseData: null, job: null, progress: [], response: null, sources: [], turns: [], failure: null, question: null, error: null };

export function useInvestigation() {
  const [state, setState] = useState<CaseState>(EMPTY);
  const stream = useRef<{ abort: () => void; lastSequence: () => number } | null>(null);
  const pending = useRef<{ turnId: string; key: string; message: string; answerTo: string | null } | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caseRef = useRef<InvestigationCase | null>(null);
  const generation = useRef(0); // bumped on start/attach/remove: stale callbacks from an older case are ignored
  const update = (patch: Partial<CaseState> | ((prev: CaseState) => Partial<CaseState>)) => setState((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));

  const refresh = useCallback(async (caseId: string) => {
    const [{ case: caseData }, turns, sources] = await Promise.all([api.getCase(caseId), api.listTurns(caseId), api.listSources(caseId)]);
    caseRef.current = caseData;
    update({ caseData, turns: turns.items, sources: sources.items, response: caseData.response, question: caseData.response?.question ?? null });
    return caseData;
  }, []);

  const armExpiry = useCallback((caseData: InvestigationCase) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const gen = generation.current;
    expiryTimer.current = setTimeout(() => { if (gen !== generation.current) return; stream.current?.abort(); stopHiggins(); setState({ ...EMPTY, phase: "expired", error: "This temporary investigation reached its 15-minute limit and was cleared. Submit the evidence again for a new check." }); }, Math.max(0, Date.parse(caseData.expiresAt) - Date.now()));
  }, []);

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
      } else if (event.type === "completed") { pending.current = null; void refresh(caseId).then((c) => update({ phase: event.payload.completion === "waiting_user" ? "waiting_user" : "answered", failure: null, caseData: c })); }
      else if (event.type === "partial") update({ failure: event.payload.reason });
      else if (event.type === "failed") { void refresh(caseId); update((prev) => ({ phase: "failed", failure: event.payload, error: event.payload.message, job: prev.job ? { ...prev.job, status: "failed", failure: event.payload } : prev.job })); }
      else if (event.type === "cancelled") { pending.current = null; void refresh(caseId).then(() => update({ phase: "answered", progress: [] })); }
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
          else void refresh(caseId).then((c) => update({ phase: fresh.status === "failed" ? "failed" : c.response?.question ? "waiting_user" : "answered", failure: fresh.failure, error: fresh.failure?.message ?? null, job: fresh }));
        }).catch((e: unknown) => update({ phase: "failed", error: e instanceof ApiError && e.status === 410 ? "This investigation expired." : "Connection lost. Retry to reconnect to the same investigation." }));
      }, 1500);
    });
  }, [refresh]);

  const start = useCallback(async (input: Omit<CreateCase, "deviceProfile">, files: { uri: string; name: string; mediaType: string }[] = []) => {
    stream.current?.abort(); generation.current++; if (expiryTimer.current) clearTimeout(expiryTimer.current); caseRef.current = null;
    setState({ ...EMPTY, phase: "creating", progress: ["Creating the investigation case."] });
    try {
      // With files: open the case, upload every original first (inventory before synthesis), then ask.
      const gen = generation.current;
      const { case: created, job: firstJob } = await api.createCase({ ...input, question: files.length ? "" : input.question, deviceProfile: currentDeviceProfile() });
      if (gen !== generation.current) return null;
      caseRef.current = created;
      let caseData = created; let job = firstJob;
      if (files.length) {
        let revision = created.revision;
        for (const file of files) {
          update((prev) => ({ progress: [...prev.progress, `Uploading ${file.name} for inspection.`] }));
          const kind = file.mediaType.startsWith("image/") ? "image" : file.mediaType.startsWith("audio/") ? "audio" : /pdf|word|text/.test(file.mediaType) ? "document" : "attachment";
          revision = (await api.uploadFileEvidence(created.id, revision, file, kind)).caseRevision;
        }
        const turn = { turnId: Crypto.randomUUID(), key: Crypto.randomUUID(), message: input.question, answerTo: null };
        pending.current = turn;
        job = (await api.submitTurn(created.id, { expectedRevision: revision, turnId: turn.turnId, message: input.question, answerToQuestionId: null, evidenceIds: [] }, turn.key)).job;
        caseData = (await api.getCase(created.id)).case;
      }
      caseRef.current = caseData; update({ caseData }); armExpiry(caseData); if (job) follow(caseData.id, job);
      return caseData;
    } catch (e: unknown) { update({ phase: "failed", error: e instanceof Error ? e.message : "Apollo could not open the investigation." }); return null; }
  }, [armExpiry, follow]);

  const ask = useCallback(async (message: string) => {
    const caseData = caseRef.current ?? state.caseData; if (!caseData) return false;
    const turn = pending.current?.message === message ? pending.current : { turnId: Crypto.randomUUID(), key: Crypto.randomUUID(), message, answerTo: (caseRef.current?.response?.question ?? state.question)?.id ?? null };
    pending.current = turn;
    update({ phase: "working", error: null, failure: null, progress: ["Sending your follow-up to Higgins."] });
    try {
      const fresh = await api.getCase(caseData.id);
      const { job } = await api.submitTurn(caseData.id, { expectedRevision: fresh.case.revision, turnId: turn.turnId, message, answerToQuestionId: turn.answerTo, evidenceIds: [] }, turn.key);
      update({ caseData: fresh.case }); follow(caseData.id, job);
      return true;
    } catch (e: unknown) { update({ phase: "failed", error: e instanceof Error ? e.message : "Higgins could not take this follow-up." }); return false; }
  }, [state.caseData, state.question, follow]);

  const retry = useCallback(async () => {
    const { caseData, job } = state; if (!caseData) return;
    if (pending.current && (!job || job.status !== "failed")) { await ask(pending.current.message); return; }
    if (!job) return;
    update({ phase: "working", error: null, progress: ["Resuming the same turn."] });
    try { const fresh = await api.getCase(caseData.id); const { job: resumed } = await api.resumeJob(caseData.id, job.id, fresh.case.revision); follow(caseData.id, resumed); }
    catch (e: unknown) { update({ phase: "failed", error: e instanceof Error ? e.message : "Could not resume." }); }
  }, [state, ask, follow]);

  const cancel = useCallback(async () => {
    const { caseData, job } = state; if (!caseData || !job) return;
    stream.current?.abort(); pending.current = null;
    try { await api.cancelJob(caseData.id, job.id, caseData.revision); } catch { /* cancellation is idempotent */ }
    await refresh(caseData.id).then((c) => update({ phase: c.response ? "answered" : "idle", progress: [], error: c.response ? null : "Investigation cancelled." })).catch(() => update({ phase: "idle", progress: [] }));
  }, [state, refresh]);

  /** Continue an existing case (e.g. from a Gate screen handoff). Rejoins an active job stream if one is running. */
  const attach = useCallback(async (caseId: string) => {
    stream.current?.abort(); pending.current = null; generation.current++; if (expiryTimer.current) clearTimeout(expiryTimer.current);
    caseRef.current = { id: caseId } as InvestigationCase;
    setState({ ...EMPTY, phase: "creating", progress: ["Opening the investigation."] });
    try {
      const caseData = await refresh(caseId); armExpiry(caseData);
      if (caseData.activeJobId) { const { job } = await api.getJob(caseId, caseData.activeJobId); follow(caseId, job, 0); }
      else update({ phase: caseData.status === "failed" ? "failed" : caseData.response?.question ? "waiting_user" : caseData.response ? "answered" : "idle" });
      return caseData;
    } catch (e: unknown) { update({ phase: e instanceof ApiError && e.status === 410 ? "expired" : "failed", error: e instanceof Error ? e.message : "Could not open this investigation." }); return null; }
  }, [refresh, armExpiry, follow]);

  const remove = useCallback(async () => {
    const caseData = state.caseData; stream.current?.abort(); pending.current = null;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    generation.current++; caseRef.current = null; stopHiggins(); setState(EMPTY);
    if (caseData) { try { await api.deleteCase(caseData.id); } catch { update({ error: "Local view cleared; server deletion could not be confirmed.", undeleted: caseData.id }); } }
  }, [state.caseData]);

  const retryDelete = useCallback(async () => {
    const id = state.undeleted; if (!id) return;
    try { await api.deleteCase(id); update({ undeleted: null, error: null }); } catch (e: unknown) { if (e instanceof ApiError && (e.status === 404 || e.status === 410)) update({ undeleted: null, error: null }); }
  }, [state.undeleted]);
  useEffect(() => () => { stream.current?.abort(); if (expiryTimer.current) clearTimeout(expiryTimer.current); }, []);
  return { state, start, ask, retry, cancel, remove, attach, retryDelete };
}
