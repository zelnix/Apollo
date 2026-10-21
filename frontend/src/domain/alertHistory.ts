// Plain words for what became of an alert.
//
// The honest ladder: Apollo raised it → the OS or the delivery service accepted it → the person tapped
// it. Only the tap proves it arrived, so "accepted" is never written as "delivered", and a refusal
// always carries its real reason.
import type { AlertLogEntry } from "@/src/push/alertLog";
import type { ServerAlert } from "@/src/push/notifications";

export interface AlertHistoryRow {
  id: string;
  title: string;
  at: string;
  /** Where Apollo sent it from: this phone itself, or Apollo's servers. */
  source: "device" | "server";
  status: string;
  opened: boolean;
}

const FAILURE_REASON: Record<string, string> = {
  push_key_invalid: "Apollo's alert key was rejected",
  insufficient_credits: "the app owner's alert credit ran out",
  integration_disabled: "alerts are switched off for this app",
  daily_limit_reached: "the daily alert limit was reached",
  provider_timeout: "the delivery service didn't answer in time",
  provider_unreachable: "the delivery service couldn't be reached",
  recipient_unregistered: "this phone was not registered for alerts",
};

function reason(code: string | null): string {
  if (!code) return "no reason was given";
  return FAILURE_REASON[code] ?? code.replace(/_/g, " ");
}

function clockTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "later";
  return new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function serverAlertStatus(alert: ServerAlert): string {
  switch (alert.state) {
    case "held": return `Held until ${alert.heldUntil ? clockTime(alert.heldUntil) : "the morning"}`;
    case "queued":
    case "submitted": return "On its way";
    case "provider_accepted": return "Accepted by the delivery service";
    case "device_observed": return "Confirmed by the delivery service";
    case "outcome_unknown": return "Never confirmed either way";
    case "failed": return `Not delivered — ${reason(alert.failureCode)}`;
  }
}

export function deviceAlertStatus(entry: AlertLogEntry): string {
  switch (entry.state) {
    case "shown": return entry.releasedAt ? "Shown after quiet hours ended" : "Shown on this phone";
    case "held": return "Waiting for quiet hours to end";
    case "failed": return `Not shown — ${entry.detail ?? "this phone refused it"}`;
  }
}

/** One list, newest first: what this phone showed and what Apollo's servers sent. */
export function alertHistory(server: ServerAlert[], device: AlertLogEntry[], limit = 30): AlertHistoryRow[] {
  const rows: AlertHistoryRow[] = [
    ...server.map((a) => ({
      id: `server-${a.alertKey}-${a.sentAt}`,
      title: a.title,
      at: a.sentAt,
      source: "server" as const,
      status: serverAlertStatus(a),
      opened: !!a.openedAt,
    })),
    ...device.map((e) => ({
      id: `device-${e.id}`,
      title: e.title,
      at: e.at,
      source: "device" as const,
      status: deviceAlertStatus(e),
      opened: !!e.openedAt,
    })),
  ];
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return rows.slice(0, limit);
}
