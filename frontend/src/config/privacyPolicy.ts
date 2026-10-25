// The full privacy policy is a web page served by ApolloSG's service, so the App Store listing, Google Play and
// the app all show the same words. Opened in the in-app browser.
import * as WebBrowser from "expo-web-browser";

import { API_BASE } from "@/src/api/client";

export const PRIVACY_POLICY_URL = `${API_BASE}/privacy-policy`;

export function openPrivacyPolicy(): void {
  void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL);
}
