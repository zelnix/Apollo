// Pure, dependency-free core for "starter memory" so it can be unit-tested without native storage.
export interface StarterEntry { q: string; count: number; lastAt: number }

const MAX_ENTRIES = 30;
const normalise = (text: string) => text.trim().replace(/\s+/g, " ");

/** Record one asked question into the frequency table and return the trimmed, re-sorted table. */
export function recordInto(entries: StarterEntry[], text: string, now = Date.now()): StarterEntry[] {
  const q = normalise(text);
  if (q.length < 6 || q.length > 120) return entries; // skip trivially short or very long messages
  const map = new Map(entries.map((e) => [e.q.toLowerCase(), { ...e }]));
  const key = q.toLowerCase();
  const existing = map.get(key);
  if (existing) { existing.count += 1; existing.lastAt = now; existing.q = q; }
  else map.set(key, { q, count: 1, lastAt: now });
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, MAX_ENTRIES);
}

/** The most-asked questions (repeated at least `minCount` times), most frequent first. */
export function topStarters(entries: StarterEntry[], limit = 3, minCount = 2): string[] {
  return entries
    .filter((e) => e.count >= minCount)
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, limit)
    .map((e) => e.q);
}
