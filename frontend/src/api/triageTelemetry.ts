// Sends one Triage outcome's telemetry (outcome + cause codes, no content) for the admin "Limited by cause"
// report. Fire-and-forget: telemetry never delays or fails a check.

import { apiPost } from "@/src/api/client";
import type { RetryRecord, TriageInvestigationRecord } from "@/src/domain/triage/contract";
import { triageTelemetry, type CauseContext } from "@/src/domain/triage/limitedCause";

export function reportTriageOutcome(record: TriageInvestigationRecord, ctx: CauseContext = {}, lookup?: RetryRecord | null): void {
  void apiPost("/triage/telemetry", "triage_telemetry", { ...triageTelemetry(record, ctx, lookup) }).catch(() => undefined);
}
