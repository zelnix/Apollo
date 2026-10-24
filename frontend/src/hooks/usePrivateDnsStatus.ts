// Reads Android's Private DNS state for the screens that advise on it, and re-reads it whenever the
// person comes back to Apollo (they have usually just changed it in Settings). Android-only: other
// hosts have no Private DNS setting for Apollo to read, so the status stays null there.
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

import type { PrivateDnsStatus } from "@/src/domain/types";
import { securityAdapter } from "@/src/security/securityAdapter";

export function usePrivateDnsStatus(): { status: PrivateDnsStatus | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<PrivateDnsStatus | null>(null);
  const enabled = Platform.OS === "android" && securityAdapter.kind === "android" && !!securityAdapter.getPrivateDnsStatus;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try { setStatus(await securityAdapter.getPrivateDnsStatus!()); }
    catch { setStatus(null); }
  }, [enabled]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (next) => { if (next === "active") void refresh(); });
    return () => sub.remove();
  }, [enabled, refresh]);

  return { status, refresh };
}
