// Shared Gmail read-only OAuth connect. Extracted from app/email.tsx so both the Email Gate screen
// and the setup walkthrough use the exact same browser-based OAuth flow (Web-application client —
// see backend/services/gmail.py). Resolves inline via WebBrowser; no deep-link/AppState roundtrip.
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { apiGet } from "@/src/api/client";

export type GmailConnectResult = "connected" | "denied" | "cancelled" | "error";

export async function connectGmailOAuth(deviceId: string): Promise<GmailConnectResult> {
  const redirect = Linking.createURL("/email");
  const { authorization_url } = await apiGet<{ authorization_url: string }>(
    `/gmail/connect?device_id=${deviceId}&app_redirect=${encodeURIComponent(redirect)}`,
  );
  const res = await WebBrowser.openAuthSessionAsync(authorization_url, redirect);
  if (res.type === "success" && res.url.includes("gmail=connected")) return "connected";
  if (res.type === "success" && res.url.includes("gmail=denied")) return "denied";
  if (res.type === "cancel" || res.type === "dismiss") return "cancelled";
  return "error";
}
