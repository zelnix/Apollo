// Text Gate — group the flat READ_SMS list (address/body/date) into conversations for a familiar
// Messages-style inbox. Pure + unit-tested. No message content is persisted or logged here; this only
// shapes in-memory data the person already chose to browse. Apollo never auto-selects a whole thread.
import type { RecentSms } from "@/src/security/phonePickers";

export interface SmsConversation { address: string; display: string; initials: string; messages: RecentSms[]; lastDate: number; preview: string; count: number }

function displayName(address: string): string { return address.trim() || "Unknown sender"; }

function initialsFor(address: string): string {
  const a = address.trim();
  if (!a) return "?";
  if (/[a-z]/i.test(a)) { const parts = a.split(/[\s._-]+/).filter(Boolean); return (parts[0]?.[0] ?? a[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase(); }
  const digits = a.replace(/\D/g, ""); return digits.slice(-2) || "#";
}

/** Group by sender address; conversations newest-first; messages within a thread oldest→newest (chat order). */
export function groupSms(messages: RecentSms[]): SmsConversation[] {
  const map = new Map<string, RecentSms[]>();
  for (const m of messages) { const key = (m.address || "").trim() || "Unknown sender"; (map.get(key) ?? map.set(key, []).get(key)!).push(m); }
  const out: SmsConversation[] = [];
  for (const [address, list] of map) {
    const sorted = [...list].sort((a, b) => a.date - b.date);
    const last = sorted[sorted.length - 1];
    out.push({ address, display: displayName(address), initials: initialsFor(address), messages: sorted, lastDate: last?.date ?? 0, preview: (last?.body ?? "").replace(/\s+/g, " ").trim(), count: sorted.length });
  }
  return out.sort((a, b) => b.lastDate - a.lastDate);
}

export function filterConversations(conversations: SmsConversation[], query: string): SmsConversation[] {
  const q = query.trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter((c) => c.display.toLowerCase().includes(q) || c.messages.some((m) => (m.body ?? "").toLowerCase().includes(q)));
}

export function timeLabel(date: number, now = Date.now()): string {
  if (!date) return "";
  const d = new Date(date); const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (yest.toDateString() === d.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
