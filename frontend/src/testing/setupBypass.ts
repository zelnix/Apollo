export const TEST_SETUP_BYPASS_PARAM = "__apollo_test_setup";

/** Preview-only deterministic setup state for automated payload-capture runs.
 * It is unavailable in production and on every native platform, and is never persisted. */
export function shouldBypassSetup(platform: string, isDevelopment: boolean, href: string): boolean {
  if (platform !== "web" || !isDevelopment) return false;
  try {
    return new URL(href).searchParams.get(TEST_SETUP_BYPASS_PARAM) === "1";
  } catch {
    return false;
  }
}