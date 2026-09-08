// Higgins' check suggestions. The model ends a reply with a machine-readable line `CHECKS: link, message` (see
// backend/routers/ask.py). We strip that line from what the person reads and turn it into tappable links to the
// actual checks, then track which of them were completed after Higgins asked.

export type CheckId = "link" | "message" | "app" | "device" | "account" | "network";

/** `where` is the path a person takes with their thumb — Higgins says it, the chip shows it, and the chip also jumps there. */
export const CHECKS: Record<CheckId, { label: string; route: string; where: string }> = {
  link: { label: "Check a link", route: "/check", where: "Home → Check a link" },
  message: { label: "Check a message", route: "/message", where: "Home → Check a message" },
  app: { label: "Check an app", route: "/app-check", where: "Home → Check an app" },
  device: { label: "Check my device", route: "/device", where: "Home → Check my device" },
  account: { label: "Account Guard", route: "/account", where: "Home → Account Guard (or Guard tab → Open Account Guard)" },
  network: { label: "Network Guard", route: "/network", where: "Home → Network Guard (or Guard tab → Open Network Guard)" },
};

const IDS = Object.keys(CHECKS) as CheckId[];
const LINE = /^\s*CHECKS?\s*:\s*(.*)$/im;

/** Splits Higgins' reply into the text to show and the checks he asked for (deduped, in order, unknown ids dropped). */
export function parseChecks(content: string): { text: string; checks: CheckId[] } {
  const m = content.match(LINE);
  if (!m) return { text: content, checks: [] };
  const checks = Array.from(new Set(m[1].toLowerCase().split(/[,\s]+/).map((x) => x.replace(/[^a-z]/g, "")).filter((x): x is CheckId => IDS.includes(x as CheckId))));
  const text = content.replace(LINE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, checks };
}

/** A check counts as done for a suggestion when it was completed AFTER Higgins asked. */
export function isDone(completedAt: string | undefined, askedAt: string): boolean {
  return !!completedAt && new Date(completedAt).getTime() >= new Date(askedAt).getTime();
}

export function progressLine(done: number, total: number): string {
  if (!total) return "";
  if (done === total) return total === 1 ? "Done — thank you." : `All ${total} done — thank you.`;
  return `${done} of ${total} done`;
}
