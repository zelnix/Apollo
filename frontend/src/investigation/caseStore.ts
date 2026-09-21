// Case-scoped state: one active case, its job stream, accepted turns, sources and expiry. Keyed by case; one case's expiry never clears another.
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/src/api/client";
import * as api from "./client";
import { currentDeviceProfile, observe } from "./deviceBroker";
import type { CreateCase, Failure, HigginsResponse, InvestigationCase, InvestigationEvent, Job, Question, SourceReference, TurnCommit } from "./types";

export type Phase = "idle" | "creating" | "working" | "reconnecting" | "waiting_device" | "waiting_user" | "answered" | "failed" | "expired";

export interface CaseState {
  phase: Phase; caseData: InvestigationCase | null; job: Job | null; progress: string[]; response: HigginsResponse | null;
  sources: SourceReference[]; turns: TurnCommit[]; failure: Failure | null; question: Question | null; error: string | null;
}

const EMPTY: CaseState = { phase: "idle", caseData: null, job: null, progress: [], response: null, sources: [], turns: [], failure: null, question: null, error: null };

export function useInvestigation() {
  const [state, setState] = useState<CaseState>(EMPTY);
  const stream = useRef<{ abort: () => void; lastSequence: () => number } | null>(null);
  const pending = useRef<{ turnId: string; key: string; message: string; answerTo: string | null } | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caseRef = useRef<InvestigationCase | null>(null);
  const update = (patch: Partial<CaseState> | ((prev: CaseState) => Partial<CaseState>)) => setState((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));

  const refresh = useCallback(async (caseId: string) => {
    const [{ case: caseData }, turns, sources] = await Promise.all([api.getCase(caseId), api.listTurns(caseId), api.listSources(caseId)]);
    caseRef.current = caseData;
    update({ caseData, turns: turns.items, sources: sources.items, response: caseData.response, question: caseData.response?.question ?? null });
    return caseData;
  }, []);

  const armExpiry = useCallback((caseData: InvestigationCase) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    expiryTimer.current = setTimeout(() => { stream.current?.abort(); setState({ ...EMPTY, phase: "expired", error: "This temporary investigation reached its 15-minute limit and was cleared. Submit the evidence again for a new check." }); }, Math.max(0, Date.parse(caseData.expiresAt) - Date.now()));
  }, []);

  const follow = useCallback((caseId: string, job: Job, after = 0) => {
    stream.current?.abort();
    update({ job, phase: "working" });
    stream.current = api.streamEvents(caseId, job.id, after, (event: InvestigationEvent) => {
      if (event.type === "progress") update((prev) => ({ progress: [...prev.progress.slice(-6), event.payload.message] }));
      else if (event.type === "response") update({ response: event.payload.response, sources: event.payload.sources, question: event.payload.response.question });
      else if (event.type === "retry_scheduled") update((prev) => ({ progress: [...prev.progress.slice(-6), event.payload.failure.message], phase: "reconnecting" }));
      else if (event.type === "device_request") {
        update({ phase: "waiting_device" });
        void observe(event.payload).then((result) => api.submitDeviceResult(caseId, result)).then(({ jobId }) => follow(caseId, { ...job, id: jobId }, 0)).catch((e: unknown) => update({ phase: "failed", error: e instanceof Error ? e.message : "Device observation could not be delivered." }));
      } else if (event.type === "completed") { pending.current = null; void refresh(caseId).then((c) => update({ phase: event.payload.completion === "waiting_user" ? "waiting_user" : "answered", failure: null, caseData: c })); }
      else if (event.type === "partial") update({ failure: event.payload.reason });
      else if (event.type === "failed") { void refresh(caseId); update({ phase: "failed", failure: event.payload, error: event.payload.message }); }
      else if (event.type === "cancelled") { pending.current = null; void refresh(caseId).then(() => update({ phase: "answered", progress: [] })); }
      else if (event.type === "expired") setState({ ...EMPTY, phase: "expired", error: "Temporary evidence expired before Higgins finished." });
    }, (reason) => {
      if (reason === "terminal") return;
      if (reason === "unauthorized") { update({ phase: "failed", error: "Apollo needs to re-register this device." }); return; }
      // EOF without a terminal event: transport interruption → poll the same job, reconnect from the last sequence.
      update({ phase: "reconnecting" });
      setTimeout(() => {
        api.getJob(caseId, job.id).then(({ job: fresh }) => {
          if (["queued", "investigating", "retry_wait", "waiting_device"].includes(fresh.status)) follow(caseId, fresh, stream.current?.lastSequence() ?? 0);
          else void refresh(caseId).then((c) => update({ phase: fresh.status === "failed" ? "failed" : c.response?.question ? "waiting_user" : "answered", failure: fresh.failure, error: fresh.failure?.message ?? null, job: fresh }));
        }).catch((e: unknown) => update({ phase: "failed", error: e instanceof ApiError && e.status === 410 ? "This investigation expired." : "Connection lost. Retry to reconnect to the same investigation." }));
      }, 1500);
    });
  }, [refresh]);

  const start = useCallback(async (input: Omit<CreateCase, "deviceProfile">, files: { uri: string; name: string; mediaType: string }[] = []) => {
    stream.current?.abort();
    setState({ ...EMPTY, phase: "creating", progress: ["Creating the investigation case."] });
    try {
      // With files: open the case, upload every original first (inventory before synthesis), then ask.
      const { case: created, job: firstJob } = await api.createCase({ ...input, question: files.length ? "" : input.question, deviceProfile: currentDeviceProfile() });
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
    stream.current?.abort(); pending.current = null;
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
    caseRef.current = null; setState(EMPTY);
    if (caseData) { try { await api.deleteCase(caseData.id); } catch { update({ error: "Local view cleared; server deletion could not be confirmed. Try again." }); } }
  }, [state.caseData]);

  useEffect(() => () => { stream.current?.abort(); if (expiryTimer.current) clearTimeout(expiryTimer.current); }, []);
  return { state, start, ask, retry, cancel, remove, attach };
}
