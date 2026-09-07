// Live reachability of Apollo's security service, observed from real calls (src/api/client.ts) and from explicit
// /health probes. Degraded state clears ONLY after a fresh successful observation — never on a timer.
import { useEffect, useState } from "react";

import { INITIAL_HEALTH, observeFailure, observeOk, type FailureKind, type ServiceHealth } from "@/src/domain/serviceHealth";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const PROBE_TIMEOUT_MS = 6000;

let health: ServiceHealth = INITIAL_HEALTH;
const listeners = new Set<(h: ServiceHealth) => void>();
const emit = () => listeners.forEach((l) => l(health));

export function getBackendHealth(): ServiceHealth { return health; }
export function markBackendOk(): void { const was = health.reachable; health = observeOk(health, new Date().toISOString()); if (was !== true || health.failure) emit(); }
export function markBackendFailure(kind: FailureKind): void { health = observeFailure(health, kind, new Date().toISOString()); emit(); }
export function onBackendHealth(l: (h: ServiceHealth) => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

/** Fresh observation of the public /health path (no credential needed). Returns true when reachable. */
export async function probeBackend(): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: ctl.signal });
    if (res.status >= 500) { markBackendFailure("server_error"); return false; }
    markBackendOk();
    return true;
  } catch {
    markBackendFailure(ctl.signal.aborted ? "timeout" : "offline");
    return false;
  } finally { clearTimeout(t); }
}

export function useBackendHealth(): ServiceHealth {
  const [h, setH] = useState(health);
  useEffect(() => onBackendHealth(setH), []);
  return h;
}
