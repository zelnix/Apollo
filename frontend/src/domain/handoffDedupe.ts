export function handoffFingerprint(gate: string, summary: string, findings: unknown[], question: string): string {
  return JSON.stringify([gate, summary, findings, question]);
}

/** Reserve one handoff attempt while suppressing rapid repeats of the same issue action. */
export function reserveHandoff(cache: Map<string, number>, fingerprint: string, now: number, windowMs = 1000): boolean {
  const last = cache.get(fingerprint);
  if (last != null && now - last < windowMs) return false;
  cache.set(fingerprint, now);
  for (const [key, at] of cache) if (now - at > Math.max(5000, windowMs * 5)) cache.delete(key);
  return true;
}