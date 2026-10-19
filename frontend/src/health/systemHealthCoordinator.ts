import * as Crypto from "expo-crypto";
import { useSyncExternalStore } from "react";

import { ApiError } from "@/src/api/client";
import { prepareReportPdf } from "@/src/investigation/reportFile";
import { validReport } from "@/src/investigation/reportHtml";
import { runProtectionHealthCheck } from "@/src/protection/healthCoordinator";
import { protectionHealthSnapshot } from "@/src/protection/healthStore";

import * as client from "./systemHealthClient";
import { overallStatus } from "./systemHealthPolicy";
import { INITIAL_CHECK, type CheckRow, type CheckStatus, type FullHealthCheck, type HigginsCheck } from "./systemHealthTypes";

let snapshot: FullHealthCheck = INITIAL_CHECK;
let running: Promise<FullHealthCheck> | null = null;
let activeAbort: AbortController | null = null;
const listeners = new Set<() => void>();
const emit = (patch: Partial<FullHealthCheck>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((l) => l()); };
const row = (status: CheckStatus, code: string | null = null, at: string | null = null): CheckRow => ({ status, code, checkedAt: at });
export const currentSystemHealth = () => snapshot;
function subscribeSystemHealth(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); if (listeners.size === 0) activeAbort?.abort(); };
}
export function useSystemHealth(): FullHealthCheck { return useSyncExternalStore(subscribeSystemHealth, currentSystemHealth, currentSystemHealth); }

async function deviceCheck(isMock: boolean): Promise<void> {
  try {
    if (isMock) { emit({ device: row("unavailable", "native_build_required") }); return; }
    const started = Date.now();
    await runProtectionHealthCheck("support");
    const observation = protectionHealthSnapshot();
    if (!observation.checkedAt || Date.parse(observation.checkedAt) < started - 1000 || !observation.protection) {
      emit({ device: row("unavailable", "observation_unavailable") }); return;
    }
    emit({ device: row(observation.protection.operational ? "healthy" : "degraded",
      observation.protection.operational ? null : "protection_needs_attention", observation.checkedAt) });
  } catch { emit({ device: row("unavailable", "observation_unavailable") }); }
}

async function finishReport(check: HigginsCheck, stale: boolean, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  if (check.cleanup.status !== "complete" || check.report.status !== "healthy" || !validReport(check.report.fixture)) {
    emit({ report: row(check.cleanup.status === "failed" ? "unavailable" : "degraded",
      check.report.code ?? "report_not_available", check.checkedAt) });
    return;
  }
  let prepared: Awaited<ReturnType<typeof prepareReportPdf>> | null = null;
  try {
    prepared = await prepareReportPdf(check.report.fixture);
    if (!signal.aborted) emit({ report: row(stale ? "degraded" : "healthy", stale ? "cached_result" : null, check.checkedAt) });
  } catch { if (!signal.aborted) emit({ report: row("unavailable", "render_unavailable", check.checkedAt) }); }
  finally {
    try { prepared?.dispose(); }
    catch { if (!signal.aborted) emit({ report: row("unavailable", "device_cleanup_failed", check.checkedAt) }); }
  }
}

async function pollCheck(id: string, signal: AbortSignal): Promise<HigginsCheck> {
  for (let attempt = 0; attempt < 75; attempt++) {
    if (signal.aborted) throw new Error("check_cancelled");
    const current = await client.getHigginsCheck(id);
    if (current.state === "completed" || current.state === "failed") return current;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new Error("check_cancelled")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 1000);
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw new Error("check_timeout");
}

async function serverCheck(signal: AbortSignal, started: number): Promise<void> {
  try {
    const reachable = await client.probe();
    if (!reachable) throw new Error("backend_unreachable");
    const ready = await client.readiness();
    if (signal.aborted) return;
    emit({ backend: row(ready.status, ready.components.find((c) => c.status !== "healthy")?.code ?? null, ready.checkedAt) });
    if (ready.status === "unavailable") {
      emit({ higgins: row("unavailable", "readiness_unavailable"), report: row("unavailable", "readiness_unavailable") });
      return;
    }
  } catch {
    if (signal.aborted) return;
    emit({ backend: row("unavailable", "backend_unreachable"), higgins: row("unavailable", "backend_unreachable"), report: row("unavailable", "backend_unreachable") });
    return;
  }
  try {
    if (signal.aborted) return;
    const admitted = await client.startHigginsCheck(Crypto.randomUUID());
    emit({ checkId: admitted.checkId });
    const check: HigginsCheck = client.isTerminalCheck(admitted) ? admitted : await pollCheck(admitted.checkId, signal);
    if (signal.aborted) return;
    const stale = check.cached && !!check.checkedAt && Date.parse(check.checkedAt) < started - 1000;
    emit({ higgins: row(stale ? "degraded" : check.investigation.status === "healthy" ? "healthy" : "degraded",
      stale ? "cached_result" : check.investigation.code, check.checkedAt) });
    await finishReport(check, stale, signal);
  } catch (error) {
    if (signal.aborted) return;
    const cooledDown = error instanceof ApiError && error.status === 429;
    emit({ higgins: row(cooledDown ? "degraded" : "unavailable", cooledDown ? "rate_limited" : "investigation_unavailable"),
      report: row(cooledDown ? "degraded" : "unavailable", "report_not_attempted") });
  }
}

export function runSystemHealthCheck(isMock: boolean): Promise<FullHealthCheck> {
  if (running) return running;
  const controller = new AbortController();
  activeAbort = controller;
  const started = Date.now();
  emit({ checking: true, overall: "checking", checkedAt: null, device: row("checking"), backend: row("checking"),
    higgins: row("checking"), report: row("checking"), checkId: null });
  running = Promise.all([deviceCheck(isMock), serverCheck(controller.signal, started)]).then(() => {
    if (controller.signal.aborted) {
      const complete = (part: CheckRow) => part.status === "checking" ? row("unavailable", "check_cancelled") : part;
      emit({ device: complete(snapshot.device), backend: complete(snapshot.backend),
        higgins: complete(snapshot.higgins), report: complete(snapshot.report) });
    }
    emit({ checking: false, overall: overallStatus(snapshot), checkedAt: new Date().toISOString() });
    return snapshot;
  }).finally(() => { activeAbort = null; running = null; });
  return running;
}