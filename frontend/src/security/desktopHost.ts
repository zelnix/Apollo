// Desktop host detection — synchronous and dependency-free so selectors and the device broker can use it at module load.
// The Windows/macOS hosts are the Tauri shell in /desktop; the bridge global only exists inside that shell.
export type DesktopHostKind = "windows" | "macos";

export function desktopHostKind(): DesktopHostKind | null {
  const g = globalThis as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown; navigator?: { userAgent?: string; platform?: string } };
  if (!g.__TAURI_INTERNALS__ && !g.__TAURI__) return null;
  const ua = `${g.navigator?.userAgent ?? ""} ${g.navigator?.platform ?? ""}`;
  if (/Windows|Win32|Win64/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS|MacIntel/i.test(ua)) return "macos";
  return null; // an unknown desktop OS is not a supported host; the web adapter's honest "unavailable" answers apply
}
