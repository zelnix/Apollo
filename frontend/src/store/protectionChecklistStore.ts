/**
 * Local record of protections the PERSON has checked themselves.
 *
 * Apollo cannot read many OS/OEM settings. When someone goes and checks one, that is their statement
 * — never Apollo's verification — so it is stored and displayed as exactly that, with the date. It
 * lives on the device only and is never sent anywhere.
 */
import { storage } from "@/src/utils/storage";

const KEY = "apollo.protection.selfChecks.v1";

export type SelfCheckMap = Record<string, string>;

export async function getSelfChecks(): Promise<SelfCheckMap> {
  try {
    const raw = await storage.getItem<string | null>(KEY, null);
    return raw ? (JSON.parse(raw) as SelfCheckMap) : {};
  } catch { return {}; }
}

/** Records that the person checked this protection themselves, now. */
export async function recordSelfCheck(id: string): Promise<SelfCheckMap> {
  const map = await getSelfChecks();
  const next = { ...map, [id]: new Date().toISOString() };
  await storage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Clears the person's own record for one protection (e.g. they changed it back). */
export async function clearSelfCheck(id: string): Promise<SelfCheckMap> {
  const map = await getSelfChecks();
  delete map[id];
  await storage.setItem(KEY, JSON.stringify(map));
  return map;
}
