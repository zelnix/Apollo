// Whether Apollo is this phone's default call screener — read honestly, offered
// wherever it matters.
//
// Android: `RoleManager.ROLE_CALL_SCREENING`. When Apollo holds it, the system
// hands every incoming call to Apollo before it rings, which is the only way
// automatic call screening can work. The person grants it through the system's
// own role request (Settings > Default apps > Caller ID & spam blocking).
//
// iOS: Apple provides no equivalent. No app can become the call screener. The
// most any app gets is a blocked-number list. That is stated plainly rather than
// hidden, so nobody is told they have protection they do not have.
//
// Expo Go and web have no native module at all, so the status is "unavailable" —
// which is reported as such, never as "off".

import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

import { CallSdk } from "@/src/security/callSdk";

export type ScreenerState =
  | "held"            // Apollo is the default screener
  | "available"       // the role exists on this phone, Apollo does not hold it
  | "unsupported"     // this Android version / device cannot offer the role
  | "ios"             // iOS: no equivalent exists
  | "unavailable"     // no native module (Expo Go, web) — genuinely unknown
  | "checking";

export interface CallScreener {
  state: ScreenerState;
  detail: string;
  /** One line Higgins and the UI can both show. */
  summary: string;
  canRequest: boolean;
  requesting: boolean;
  refresh: () => Promise<void>;
  request: () => Promise<void>;
}

const IOS_DETAIL = "Apple does not let any app screen incoming calls on iPhone. Apollo checks numbers you give it and keeps a blocked-number list instead.";

export const SCREENER_SUMMARY: Record<ScreenerState, string> = {
  held: "ApolloSG is your default call screener",
  available: "ApolloSG is not your call screener yet",
  unsupported: "This phone cannot offer call screening",
  ios: "Call screening is not possible on iPhone",
  unavailable: "Call screening can't be read in the preview",
  checking: "Checking call screening…",
};

export function useCallScreener(): CallScreener {
  const [state, setState] = useState<ScreenerState>(Platform.OS === "ios" ? "ios" : "checking");
  const [detail, setDetail] = useState<string>(Platform.OS === "ios" ? IOS_DETAIL : "Reading the call-screening role.");
  const [requesting, setRequesting] = useState(false);

  const refresh = useCallback(async () => {
    if (Platform.OS === "ios") { setState("ios"); setDetail(IOS_DETAIL); return; }
    const result = await CallSdk.getCallScreeningRoleStatus();
    if (result.status === "unavailable") {
      setState("unavailable");
      setDetail("Apollo can't read the call-screening role here. It is readable on an installed Android build.");
      return;
    }
    if (result.roleHeld) { setState("held"); setDetail("Android hands every incoming call to ApolloSG before it rings."); return; }
    if (result.roleAvailable) { setState("available"); setDetail(result.detail ?? "Another app may currently hold the role."); return; }
    setState("unsupported");
    setDetail(result.detail ?? "This Android version does not offer a call-screening role.");
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const request = useCallback(async () => {
    if (Platform.OS === "ios") return;
    setRequesting(true);
    try {
      await CallSdk.requestCallScreeningRole();
      await refresh();
    } finally { setRequesting(false); }
  }, [refresh]);

  return { state, detail, summary: SCREENER_SUMMARY[state], canRequest: state === "available", requesting, refresh, request };
}
