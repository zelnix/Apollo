import type { BackendProbe, CheckRow, CheckStatus } from "./systemHealthTypes";

/** Any 4xx/5xx, HTML body, unsupported schema or malformed JSON fails closed. */
export function healthyProbe(httpStatus: number, body: unknown): body is BackendProbe {
  if (httpStatus !== 200 || !body || typeof body !== "object") return false;
  const result = body as Partial<BackendProbe>;
  return result.schemaVersion === 1 && result.status === "ok" && result.service === "apollo-v1" &&
    typeof result.checkedAt === "string" && Number.isFinite(Date.parse(result.checkedAt));
}

export function overallStatus(rows: { device: CheckRow; backend: CheckRow; higgins: CheckRow; report: CheckRow }): CheckStatus {
  if (rows.backend.status === "unavailable" || rows.report.code === "cleanup_not_confirmed" ||
      rows.report.code === "device_cleanup_failed") return "unavailable";
  return Object.values(rows).every((item) => item.status === "healthy") ? "healthy" : "degraded";
}