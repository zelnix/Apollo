// Gate Guard M2.1 Phase 5: the durable, user-facing, auditable record of local Website Gate
// overrides. This is the JS/AsyncStorage-backed store the Kotlin `WebsiteGateOverrideStore` doc
// comments refer to -- the native runtime cache is ephemeral (rebuilt from here every bridge
// session, see GuardDogSecuritySDK.hydrateWebsiteGateOverrides). THIS file is the source of truth
// across app restarts; the shape/validation/bounding rules themselves live in
// contracts/shared/websiteGateOverrides.ts (kept in sync with packages/guarddog-contracts/src, unit
// tested there) so this file stays thin storage glue.
//
// Structural invariant: only ALLOW overrides exist (see contracts/shared/websiteGateOverrides.ts
// header) -- nothing in this file can create, forward, or fabricate a THREAT_BLOCKED / block
// decision. It only ever prevents a sinkhole the signed rule bundle would otherwise arm.
import {
  removeWebsiteGateOverride as removeFromList,
  upsertWebsiteGateOverride,
  validateWebsiteGateOverrideList,
  type WebsiteGateOverrideRecord,
} from "@/src/contracts/shared/websiteGateOverrides.ts";
import { storage } from "@/src/utils/storage";

// Single JSON-blob key (this store's records are a small, bounded list, not individually-keyed KV).
const STORAGE_KEY = "guarddog.websiteGate.overrides.v1";

async function readAll(): Promise<WebsiteGateOverrideRecord[]> {
  const raw = await storage.getItem(STORAGE_KEY, "[]");
  try {
    return validateWebsiteGateOverrideList(JSON.parse(raw ?? "[]"));
  } catch {
    // Corrupted blob: fail safe to empty rather than throwing or trusting it.
    return [];
  }
}

async function writeAll(records: WebsiteGateOverrideRecord[]): Promise<boolean> {
  return storage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/** All currently active local overrides, validated against corruption on every read. */
export async function getWebsiteGateOverrides(): Promise<WebsiteGateOverrideRecord[]> {
  return readAll();
}

/** Persists an ALLOW override for `host`. Returns false (nothing persisted) if `host` fails
 * canonicalization -- mirrors the native `setAllowed` contract so the durable record and the native
 * runtime cache can never disagree about which hosts are valid. Bounded + de-duped by
 * `upsertWebsiteGateOverride`. */
export async function addWebsiteGateOverride(host: string): Promise<boolean> {
  const existing = await readAll();
  const { records, ok } = upsertWebsiteGateOverride(existing, host, new Date().toISOString());
  if (!ok) return false;
  return writeAll(records);
}

/** Fully reversible: removes the override for `host` if present. No-op otherwise. */
export async function removeWebsiteGateOverride(host: string): Promise<void> {
  const existing = await readAll();
  await writeAll(removeFromList(existing, host));
}

/** Clears every persisted override. This is itself an auditable user action -- it does not "block"
 * anything; it simply restores every host to whatever the signed rule bundle already says. */
export async function clearWebsiteGateOverrides(): Promise<void> {
  await writeAll([]);
}
