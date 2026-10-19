import { apiGet, apiGetReadiness, apiPostEmpty } from "@/src/api/client";
import { probeBackend } from "@/src/api/backendHealth";

import type { HigginsCheck, HigginsJob, Readiness } from "./systemHealthTypes";

export const probe = probeBackend;
export async function readiness(): Promise<Readiness> {
  const body = await apiGetReadiness<Readiness>("/health/readiness");
  if (body?.schemaVersion !== 1 || !["healthy", "degraded", "unavailable"].includes(body.status) ||
      !Array.isArray(body.components) || typeof body.checkedAt !== "string" || !Number.isFinite(Date.parse(body.checkedAt))) {
    throw new Error("Apollo's readiness response is incomplete.");
  }
  return body;
}

export async function startHigginsCheck(idempotencyKey: string): Promise<HigginsJob> {
  const body = await apiPostEmpty<HigginsJob>("/health/higgins-checks", idempotencyKey);
  return validateHiggins(body);
}

export function validateHiggins(body: HigginsJob): HigginsJob {
  if (!body || typeof body.checkId !== "string" ||
      typeof body.createdAt !== "string" || !Number.isFinite(Date.parse(body.createdAt)) ||
      typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt))) {
    throw new Error("Higgins' health response is incomplete.");
  }
  if (body.state === "queued" || body.state === "running") return body;
  if (!("schemaVersion" in body) || body.schemaVersion !== 1 || !["completed", "failed"].includes(body.state) ||
      !body.investigation || !body.report || !body.cleanup ||
      !["pending", "complete", "failed"].includes(body.cleanup.status)) {
    throw new Error("Higgins' health response is incomplete.");
  }
  return body;
}

export function isTerminalCheck(job: HigginsJob): job is HigginsCheck {
  return job.state === "completed" || job.state === "failed";
}

export async function getHigginsCheck(checkId: string): Promise<HigginsJob> {
  return validateHiggins(await apiGet<HigginsJob>(`/health/higgins-checks/${encodeURIComponent(checkId)}`));
}