// Resubmitting a stopped investigation. Magnum DI makes one Gemini call and, if it fails, exactly one retry;
// after that the server sets `resubmitAt` (about five minutes later) and the Resubmit button waits until then.
// The case keeps everything the person submitted, so resubmitting sends the same material again. Pure — no React Native imports.
import type { Failure } from "./types";

/** Whole seconds until resubmitting is allowed; 0 when it already is (or the server set no pause). */
export function resubmitWaitSeconds(failure: Pick<Failure, "resubmitAt"> | null | undefined, now = Date.now()): number {
  const at = failure?.resubmitAt ? Date.parse(failure.resubmitAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

/** m:ss, e.g. 4:05. */
export function formatWait(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A failure another attempt cannot fix (e.g. a configuration fault) offers no Resubmit. */
export function canResubmit(failure: Pick<Failure, "retryable"> | null | undefined): boolean {
  return failure?.retryable !== false;
}

export function resubmitLabels(waitSeconds: number, busy: boolean): { title: string; description: string } {
  if (busy) return { title: "Resubmitting…", description: "Magnum DI is starting again with what you submitted" };
  if (waitSeconds > 0) return { title: `Resubmit in ${formatWait(waitSeconds)}`, description: "Magnum DI needs a short pause first. Everything you submitted is kept." };
  return { title: "Resubmit", description: "Sends what you submitted again — nothing to re-enter" };
}
