// Gate Guard M2.1 Phase 5: local, on-device Website Gate overrides -- pure, cross-runtime helpers
// (canonicalization, shape validation, bounding) shared between the Expo app's durable
// AsyncStorage-backed store (frontend/src/sdk/websiteGateOverrides.ts) and anything else that needs
// to reason about the same record shape without duplicating the rules. Synced byte-identical into
// frontend/src/contracts/shared/ by scripts/sync-to-app.mjs -- do not hand-edit the copy.
//
// STRUCTURAL INVARIANT: `type` is a literal union of exactly one value, "allow". There is no "block"
// (or any other) override type anywhere in this file's types or validators -- a local override can
// only ever ALLOW a host that a signed rule would otherwise block; it can never itself become, or be
// mistaken for, enforcement evidence. THREAT_BLOCKED can only ever come from a real TUN packet drop
// (see GuardDogSDKEngine.reportBlockedPacket / docs/M2_WEBSITE_GATE_DESIGN.md §0). Removing an
// override just restores whatever the signed rule bundle already says for that host -- it is fully
// reversible and never "blocks" anything by itself.
import { canonicalizeHost } from "./normalization.ts";

/** Hard cap on persisted overrides -- keeps the durable, user-facing record bounded so it can never
 * grow unbounded/"live forever" across app restarts. Oldest-by-decidedAt is evicted first. */
export const MAX_WEBSITE_GATE_OVERRIDES = 500;

export interface WebsiteGateOverrideRecord {
  /** Canonical host (see canonicalizeHost) -- always the lookup/dedupe key. */
  host: string;
  /** The ONLY override type this phase supports. See file header. */
  type: "allow";
  /** Always "user" today -- local, on-device, user-initiated. Reserved for future provenance (e.g.
   * a future "imported from another device" source) without ever adding a "block" type. */
  source: "user";
  /** ISO-8601 timestamp of when the override was created/last touched. Used for audit + eviction order. */
  decidedAt: string;
}

export interface UpsertResult {
  records: WebsiteGateOverrideRecord[];
  ok: boolean;
}

/** Adds or refreshes an ALLOW override for `host`. Returns `ok:false` (records unchanged) if `host`
 * fails canonicalization -- never stores something that couldn't be looked up later. Refreshing an
 * existing host de-dupes (never grows the list) and updates its `decidedAt`. */
export function upsertWebsiteGateOverride(
  records: readonly WebsiteGateOverrideRecord[],
  host: string,
  nowIso: string,
): UpsertResult {
  const canonical = canonicalizeHost(host);
  if (!canonical) return { records: [...records], ok: false };
  const withoutExisting = records.filter((r) => r.host !== canonical);
  const next: WebsiteGateOverrideRecord[] = [
    ...withoutExisting,
    { host: canonical, type: "allow", source: "user", decidedAt: nowIso },
  ];
  return { records: pruneWebsiteGateOverrides(next), ok: true };
}

/** Fully reversible removal. A host with no matching record (or one that fails canonicalization) is
 * a no-op -- never throws. */
export function removeWebsiteGateOverride(
  records: readonly WebsiteGateOverrideRecord[],
  host: string,
): WebsiteGateOverrideRecord[] {
  const canonical = canonicalizeHost(host);
  if (!canonical) return [...records];
  return records.filter((r) => r.host !== canonical);
}

/** Bounded storage: keeps at most MAX_WEBSITE_GATE_OVERRIDES, evicting the oldest by `decidedAt`
 * first, so the durable record can never grow unbounded across restarts. */
export function pruneWebsiteGateOverrides(
  records: readonly WebsiteGateOverrideRecord[],
): WebsiteGateOverrideRecord[] {
  if (records.length <= MAX_WEBSITE_GATE_OVERRIDES) return [...records];
  return [...records]
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
    .slice(records.length - MAX_WEBSITE_GATE_OVERRIDES);
}

/** Shape validator for a single record loaded from untrusted/possibly-corrupted storage. Rejects
 * anything whose `type` is not exactly `"allow"` -- the structural guarantee that a corrupted,
 * tampered, or future-buggy write can never resurrect a "block" override from this shape. */
export function validateWebsiteGateOverrideRecord(input: unknown): WebsiteGateOverrideRecord | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  if (typeof r.host !== "string") return null;
  const canonical = canonicalizeHost(r.host);
  if (!canonical || canonical !== r.host) return null; // must already be stored canonical
  if (r.type !== "allow") return null;
  if (r.source !== "user") return null;
  if (typeof r.decidedAt !== "string" || Number.isNaN(Date.parse(r.decidedAt))) return null;
  return { host: canonical, type: "allow", source: "user", decidedAt: r.decidedAt };
}

/** Validates a whole list loaded from storage: drops any malformed/corrupted entries instead of
 * throwing or trusting them, then applies the same bound as a live write. Fail-safe -- never fails
 * open to an unbounded or malformed set. */
export function validateWebsiteGateOverrideList(input: unknown): WebsiteGateOverrideRecord[] {
  if (!Array.isArray(input)) return [];
  const valid: WebsiteGateOverrideRecord[] = [];
  for (const item of input) {
    const r = validateWebsiteGateOverrideRecord(item);
    if (r) valid.push(r);
  }
  return pruneWebsiteGateOverrides(valid);
}
