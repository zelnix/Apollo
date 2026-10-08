// Account Gate — personal account-exposure monitoring (pure logic, unit-tested).
// Apollo monitors the owner's OWN email addresses for appearance in known data breaches. This module
// holds the plain-English derivations: masking, due-check timing, scan diffing, the eight gate states
// and the Higgins Weekly Account Exposure Report. No internal codes ever appear in user-facing strings.
// "No breach returned" is reported honestly as "not found" — never as proof the account is secure.

import type { Tone } from "@/src/components/ui";

export interface MonitoredEmail { email: string; addedAt: string }
export type ExposureStatus = "clear" | "found" | "unavailable";
export interface ScanBreach { name: string; date: string }
export interface EmailFinding { email: string; status: ExposureStatus; breaches: ScanBreach[]; passwordExposed: boolean; detail: string }
export interface AccountScan { at: string; provider: string; sourceLabel: string; results: EmailFinding[] }

export const DUE_MS = 7 * 24 * 60 * 60 * 1000;

/** Mask for display so a full address is never shown back in lists/reports. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const head = local.length <= 2 ? local[0] ?? "" : local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, Math.min(3, local.length - head.length)))}@${domain}`;
}

export function isDue(lastCheckedAt: string | null, now = Date.now()): boolean {
  if (!lastCheckedAt) return true;
  const t = Date.parse(lastCheckedAt);
  if (!Number.isFinite(t)) return true;
  return now - t >= DUE_MS;
}

export function nextScanLabel(lastCheckedAt: string): string {
  const due = new Date(Date.parse(lastCheckedAt) + DUE_MS);
  return due.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export interface ScanSummary { monitored: number; exposed: number; unavailable: number; clear: number; passwordExposed: boolean }
export function scanSummary(scan: AccountScan | null): ScanSummary {
  if (!scan) return { monitored: 0, exposed: 0, unavailable: 0, clear: 0, passwordExposed: false };
  const exposed = scan.results.filter((r) => r.status === "found").length;
  const unavailable = scan.results.filter((r) => r.status === "unavailable").length;
  const clear = scan.results.filter((r) => r.status === "clear").length;
  return { monitored: scan.results.length, exposed, unavailable, clear, passwordExposed: scan.results.some((r) => r.passwordExposed) };
}

export type AccountGateState =
  | "not_set_up" | "monitoring" | "checking" | "no_exposure"
  | "exposure_found" | "action_needed" | "unavailable" | "overdue";

export interface GateStatus { state: AccountGateState; tone: Tone; title: string; detail: string }

/** The eight passive Account-Gate states. `checking` while a scan runs; `overdue` when the weekly check
 *  hasn't completed in time (OS may delay an on-open check — never presented as a guaranteed job). */
export function deriveGateState(args: { monitoredCount: number; lastScan: AccountScan | null; lastCheckedAt: string | null; checking: boolean; now?: number }): GateStatus {
  const { monitoredCount, lastScan, lastCheckedAt, checking } = args;
  if (checking) return { state: "checking", tone: "sniffing", title: "Checking your accounts…", detail: "Apollo is checking your monitored addresses against known breach data." };
  if (monitoredCount === 0) return { state: "not_set_up", tone: "neutral", title: "Not set up yet", detail: "Add an email address and Apollo will watch for it appearing in known data breaches." };
  const sum = scanSummary(lastScan);
  if (!lastScan) return { state: "monitoring", tone: "resting", title: `Monitoring ${monitoredCount} address${monitoredCount > 1 ? "es" : ""}`, detail: "Apollo hasn't run its first check yet. Run one from Check It → Check My Accounts." };
  if (isDue(lastCheckedAt, args.now)) return { state: "overdue", tone: "ears_up", title: "A check is overdue", detail: "The weekly check hasn't run in over seven days. Open Check My Accounts to run it now." };
  if (sum.passwordExposed) return { state: "action_needed", tone: "growling", title: "Action needed", detail: "A monitored address appears in a breach that exposed passwords. Change that password and turn on two-factor authentication." };
  if (sum.exposed > 0) return { state: "exposure_found", tone: "ears_up", title: `${sum.exposed} address${sum.exposed > 1 ? "es appear" : " appears"} in a breach`, detail: "Review the exposures and secure those accounts through the official app or website." };
  if (sum.unavailable > 0 && sum.exposed === 0) return { state: "unavailable", tone: "neutral", title: "Some checks couldn't complete", detail: "Apollo couldn't reach the breach service for every address. It will try again on the next check." };
  return { state: "no_exposure", tone: "resting", title: "No known exposure", detail: `Your monitored address${monitoredCount > 1 ? "es don't" : " doesn't"} appear in known breach data. That's good — not a guarantee.` };
}

function namesByEmail(scan: AccountScan | null): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!scan) return map;
  for (const r of scan.results) if (r.status === "found") map.set(r.email, new Set(r.breaches.map((b) => b.name)));
  return map;
}

export interface ExposureDiff { newExposures: { email: string; breaches: string[] }[]; resolved: { email: string; breaches: string[] }[] }
export function diffExposures(previous: AccountScan | null, next: AccountScan): ExposureDiff {
  const prev = namesByEmail(previous);
  const now = namesByEmail(next);
  const newExposures: ExposureDiff["newExposures"] = [];
  const resolved: ExposureDiff["resolved"] = [];
  for (const [email, names] of now) {
    const before = prev.get(email) ?? new Set<string>();
    const added = [...names].filter((n) => !before.has(n));
    if (added.length) newExposures.push({ email, breaches: added });
  }
  for (const [email, names] of prev) {
    const after = now.get(email) ?? new Set<string>();
    const gone = [...names].filter((n) => !after.has(n));
    if (gone.length) resolved.push({ email, breaches: gone });
  }
  return { newExposures, resolved };
}

export interface WeeklyReportSection { title: string; lines: string[] }
export interface WeeklyReport { generatedAt: string; headline: string; overall: Tone; sections: WeeklyReportSection[]; sourceLabel: string; nextScan: string }

/** Higgins Weekly Account Exposure Report — built from the ACTUAL scan, generated even when clean.
 *  Failures are explained (never shown as a false "all clear"); partial coverage is flagged. */
export function buildWeeklyReport(scan: AccountScan, previous: AccountScan | null): WeeklyReport {
  const sum = scanSummary(scan);
  const diff = diffExposures(previous, scan);
  const sections: WeeklyReportSection[] = [];

  sections.push({ title: "Accounts monitored", lines: scan.results.map((r) => maskEmail(r.email)) });

  if (diff.newExposures.length) sections.push({ title: "New since your last check", lines: diff.newExposures.map((e) => `${maskEmail(e.email)} — ${e.breaches.join(", ")}`) });

  const ongoing = scan.results.filter((r) => r.status === "found");
  if (ongoing.length) sections.push({ title: "Exposures found", lines: ongoing.map((r) => `${maskEmail(r.email)} — ${r.breaches.map((b) => b.name + (b.date ? ` (${b.date})` : "")).join(", ")}${r.passwordExposed ? " · passwords exposed" : ""}`) });

  if (diff.resolved.length) sections.push({ title: "No longer showing", lines: diff.resolved.map((e) => `${maskEmail(e.email)} — ${e.breaches.join(", ")}`) });

  const unavailable = scan.results.filter((r) => r.status === "unavailable");
  if (unavailable.length) sections.push({ title: "Couldn't be checked this time", lines: unavailable.map((r) => `${maskEmail(r.email)} — ${r.detail}`) });

  const actions: string[] = [];
  if (sum.passwordExposed) actions.push("Change that password everywhere you used it, and turn on two-factor authentication.");
  if (sum.exposed > 0) actions.push("Expect more targeted phishing. Turn on two-factor authentication and never reuse a password.");
  if (sum.exposed > 0) actions.push("Open each affected service yourself — never through a link in a breach email.");
  if (sum.exposed === 0 && unavailable.length === 0) actions.push("Nothing to do right now. Keep two-factor authentication on and keep using unique passwords.");
  if (unavailable.length) actions.push("Apollo will re-check the addresses it couldn't reach on the next check.");
  sections.push({ title: "What to do", lines: actions });

  sections.push({ title: "Coverage", lines: [`${sum.monitored} address${sum.monitored > 1 ? "es" : ""} checked against known breach data.`, `Breach data provided by ${scan.sourceLabel}.`, `"Not found" means not in this source — not proof the account has never been exposed.`] });

  let overall: Tone = "resting";
  let headline = "No new account exposure found";
  if (diff.newExposures.length || sum.passwordExposed) { overall = "growling"; headline = sum.passwordExposed ? "A password was exposed — act now" : "New account exposure found"; }
  else if (sum.exposed > 0) { overall = "ears_up"; headline = "Known exposures still need attention"; }
  else if (unavailable.length) { overall = "neutral"; headline = "Some accounts couldn't be checked"; }

  return { generatedAt: scan.at, headline, overall, sections, sourceLabel: scan.sourceLabel, nextScan: nextScanLabel(scan.at) };
}
