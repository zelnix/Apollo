// Local, on-device persistence for Account Gate monitoring. The owner's monitored email addresses,
// the last scan, a capped scan history and the latest weekly report live on the device. Scans are run
// through the backend (provider-agnostic: XposedOrNot now, HIBP when keyed). Addresses leave the device
// only inside an authorised scan request; nothing here stores passwords or secrets.
import { apiPost } from "@/src/api/client";
import { buildWeeklyReport, diffExposures, type AccountScan, type EmailFinding, type ExposureDiff, type MonitoredEmail, type WeeklyReport } from "@/src/domain/accountMonitor";
import { storage } from "@/src/utils/storage";

const K_EMAILS = "apollo.account.monitored.v1";
const K_SCAN = "apollo.account.lastscan.v1";
const K_HISTORY = "apollo.account.scanhistory.v1";
const K_REPORT = "apollo.account.report.v1";
const K_CHECKED = "apollo.account.checkedat.v1";
const HISTORY_CAP = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await storage.getItem<string | null>(key, null);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function getMonitoredEmails(): Promise<MonitoredEmail[]> {
  return readJson<MonitoredEmail[]>(K_EMAILS, []);
}

export function isValidEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 254;
}

export async function addMonitoredEmail(email: string): Promise<MonitoredEmail[]> {
  const clean = email.trim().toLowerCase();
  const list = await getMonitoredEmails();
  if (list.some((m) => m.email === clean)) return list;
  const next = [...list, { email: clean, addedAt: new Date().toISOString() }].slice(0, 10);
  await storage.setItem(K_EMAILS, JSON.stringify(next));
  return next;
}

export async function removeMonitoredEmail(email: string): Promise<MonitoredEmail[]> {
  const next = (await getMonitoredEmails()).filter((m) => m.email !== email);
  await storage.setItem(K_EMAILS, JSON.stringify(next));
  return next;
}

export async function getLastScan(): Promise<AccountScan | null> { return readJson<AccountScan | null>(K_SCAN, null); }
export async function getScanHistory(): Promise<AccountScan[]> { return readJson<AccountScan[]>(K_HISTORY, []); }
export async function getLastReport(): Promise<WeeklyReport | null> { return readJson<WeeklyReport | null>(K_REPORT, null); }
export async function getLastCheckedAt(): Promise<string | null> { return storage.getItem<string | null>(K_CHECKED, null); }

interface ScanResponse { provider: string; source_label: string; checked_at: string; results: { email: string; status: EmailFinding["status"]; breaches: { name: string; date: string }[]; password_exposed: boolean; detail: string }[] }

export interface ScanOutcome { scan: AccountScan; report: WeeklyReport; diff: ExposureDiff; previous: AccountScan | null }

/** Run one check of every monitored address. On total failure the previous good scan is preserved and
 *  the error is thrown; a per-address failure is kept as that address's "unavailable" status. */
export async function runScan(deviceId: string): Promise<ScanOutcome> {
  const emails = (await getMonitoredEmails()).map((m) => m.email);
  if (emails.length === 0) throw new Error("Add an email address to monitor first.");
  const res = await apiPost<ScanResponse>("/account/monitor/scan", "account_monitor", { device_id: deviceId, emails });
  const previous = await getLastScan();
  const scan: AccountScan = {
    at: res.checked_at || new Date().toISOString(), provider: res.provider, sourceLabel: res.source_label,
    results: res.results.map((r) => ({ email: r.email, status: r.status, breaches: r.breaches ?? [], passwordExposed: !!r.password_exposed, detail: r.detail })),
  };
  const diff = diffExposures(previous, scan);
  const report = buildWeeklyReport(scan, previous);
  const history = [scan, ...(await getScanHistory())].slice(0, HISTORY_CAP);
  await storage.setItem(K_SCAN, JSON.stringify(scan));
  await storage.setItem(K_HISTORY, JSON.stringify(history));
  await storage.setItem(K_REPORT, JSON.stringify(report));
  await storage.setItem(K_CHECKED, scan.at);
  return { scan, report, diff, previous };
}
