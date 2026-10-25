// Times Apollo stores are UTC. A time saved without its zone ("2026-10-25T05:33:00") is still UTC — read as is,
// a phone in Perth would show 5:33 am instead of 1:33 pm. Pure: no React, no native imports.

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** The same moment, marked as UTC when it was saved without a zone. Anything that isn't an ISO time is returned unchanged. */
export function asUtc<T extends string | null | undefined>(iso: T): T {
  if (typeof iso !== "string" || !ISO_TIME.test(iso) || HAS_ZONE.test(iso)) return iso;
  return `${iso}Z` as T;
}
