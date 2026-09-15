// Shared "at a glance" status for the two top-level test entry points on the home screen
// (Gate Guard M2.1 Phase 6A automated acceptance, and the DNS/DoH capability diagnostic wizard).
//
// Read-only with respect to Phase 6A: reads its OWN AsyncStorage snapshot (key
// "phase6a-automated-run-v1", written only by app/phase6-automated.tsx) purely to derive a status
// label for the home screen -- never writes to it, never re-derives or overrides its verdict logic
// (that stays entirely owned by src/harness/phase6AutomatedHarness.ts's finalizeRun).
//
// Owns a NEW, separate key for the DNS/DoH wizard, which previously had no persistence at all.
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Phase6RunState } from "@/src/harness/phase6AutomatedHarness";

export type TestRunStatusValue = "not_started" | "in_progress" | "passed" | "failed" | "completed" | "needs_attention";

const PHASE6_STORAGE_KEY = "phase6a-automated-run-v1"; // must stay byte-identical to app/phase6-automated.tsx's STORAGE_KEY
const DNS_DOH_STATUS_KEY = "dns-doh-diagnostic-status-v1";

interface DnsDohWizardStatus {
  status: TestRunStatusValue;
  updatedAt: string;
}

export async function readPhase6Status(): Promise<TestRunStatusValue> {
  try {
    const raw = await AsyncStorage.getItem(PHASE6_STORAGE_KEY);
    if (!raw) return "not_started";
    const run = JSON.parse(raw) as Phase6RunState;
    if (run.overallVerdict === "PASS") return "passed";
    if (run.overallVerdict === "FAIL") return "failed";
    if (run.overallVerdict === "PRECONDITION_FAILURE") return "needs_attention";
    if (run.overallVerdict === "PASS_WITH_CAPABILITY_GAP" || run.overallVerdict === "PASS_WITH_UNVERIFIED_ROWS") return "needs_attention";
    if (!run.phase || run.phase === "idle") return "not_started";
    return "in_progress"; // has a persisted run in flight, no overall verdict yet
  } catch {
    return "not_started";
  }
}

export async function readDnsDohStatus(): Promise<TestRunStatusValue> {
  try {
    const raw = await AsyncStorage.getItem(DNS_DOH_STATUS_KEY);
    if (!raw) return "not_started";
    return (JSON.parse(raw) as DnsDohWizardStatus).status;
  } catch {
    return "not_started";
  }
}

/** Called only by app/dns-capability-diagnostic.tsx at its own natural transition points
 * (Preflight success -> in_progress; reaching the Final report step -> completed/needs_attention). */
export async function writeDnsDohStatus(status: TestRunStatusValue): Promise<void> {
  try {
    await AsyncStorage.setItem(DNS_DOH_STATUS_KEY, JSON.stringify({ status, updatedAt: new Date().toISOString() } satisfies DnsDohWizardStatus));
  } catch {
    // best-effort UI status only -- never block the wizard on a storage failure.
  }
}
