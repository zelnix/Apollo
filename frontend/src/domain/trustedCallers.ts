// Trusted callers: numbers the user marked as safe so Apollo stays quiet for them (no auto-check event).
// Stored locally only; matched on the last 10 digits so formatting/country-code differences still match.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "apollo.call.trusted.v1";
export const normalizeNumber = (n: string): string => n.replace(/[^\d]/g, "").slice(-10);

export async function getTrustedCallers(): Promise<string[]> {
  try { const raw = await AsyncStorage.getItem(KEY); return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
}
export async function isTrustedCaller(n: string): Promise<boolean> {
  const norm = normalizeNumber(n); if (!norm) return false; return (await getTrustedCallers()).includes(norm);
}
export async function trustCaller(n: string): Promise<void> {
  const norm = normalizeNumber(n); if (!norm) return;
  const list = await getTrustedCallers();
  if (!list.includes(norm)) { list.push(norm); await AsyncStorage.setItem(KEY, JSON.stringify(list)); }
}
export async function untrustCaller(n: string): Promise<void> {
  const norm = normalizeNumber(n); if (!norm) return;
  await AsyncStorage.setItem(KEY, JSON.stringify((await getTrustedCallers()).filter((x) => x !== norm)));
}
