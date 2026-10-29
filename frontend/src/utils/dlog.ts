/**
 * Remote diagnostic logger — sends tagged log entries to /api/debug/log so they can be
 * read from the backend without access to the device console.
 *
 * Usage:  dlog('InvFlow', 'ATTACH', { caseId, submissionId })
 *
 * Entries are fire-and-forget (never blocks the caller) and silently dropped on failure.
 * Remove this file and all call sites when the investigation flow is stable.
 */

const ENDPOINT = "/api/debug/log";
const QUEUE: Array<Record<string, unknown>> = [];
let flushing = false;

function scheduleFlush() {
  if (flushing || !QUEUE.length) return;
  flushing = true;
  setTimeout(async () => {
    const batch = QUEUE.splice(0, 20);
    for (const entry of batch) {
      try {
        await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        });
      } catch { /* silent */ }
    }
    flushing = false;
    if (QUEUE.length) scheduleFlush();
  }, 50);
}

export function dlog(tag: string, msg: string, data?: Record<string, unknown>) {
  const entry = { tag, msg, t: Date.now(), ...data };
  console.warn(`[${tag}] ${msg}`, data ?? "");
  QUEUE.push(entry);
  scheduleFlush();
}
