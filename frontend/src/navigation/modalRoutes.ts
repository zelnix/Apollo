// Routes presented as pop-ups (slide up as modals). The root Stack declares them from this list, and the
// hamburger menu hides itself on them — one list, so the two can never disagree.
export const MODAL_ROUTES = [
  "settings/index", "check", "message", "call", "scan", "file", "app-check", "device", "recheck", "network",
  "account", "email", "share", "patrol/scent/[id]", "patrol/[id]", "privacy-disclosure", "privacy-data",
  "notification-check", "protection-details", "support", "digest", "family", "family/alert/[id]", "family/incident/[id]",
] as const;

const MODAL_SET = new Set<string>(MODAL_ROUTES);

/** True when the current route (from useSegments) is one of the pop-up routes. */
export function isPopupRoute(segments: readonly string[]): boolean {
  const route = segments.join("/");
  return MODAL_SET.has(route) || MODAL_SET.has(`${route}/index`);
}
