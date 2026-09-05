// Connection Guard: turns a platform NetworkStatus into an Apollo assessment.
// Only platform-reported facts produce events; "unknown" never does.

import type { NetworkStatus } from "@/src/security/SecurityPlatformAdapter";
import type { ApolloState } from "./types";

export interface ConnectionAssessment {
  state: ApolloState | null; // null = no event warranted
  key: string; // dedupe key for the current network condition
  headline: string;
  what_happened: string;
  why: string[];
  what_to_do: string;
  summary: string; // one-liner for Guard tab
}

export function assessConnection(n: NetworkStatus | null): ConnectionAssessment {
  if (!n || !n.connected) return { state: null, key: "offline", headline: "", what_happened: "", why: [], what_to_do: "", summary: "Not connected." };
  if (!n.inspectable) return { state: null, key: `uninspectable-${n.type}`, headline: "", what_happened: "", why: [], what_to_do: "", summary: `Connected via ${n.type}. Apollo cannot assess this connection's safety on this build.` };
  if (n.captivePortal) {
    return {
      state: "growling", key: `captive-${n.type}`, headline: "This Wi‑Fi wants you to sign in first",
      what_happened: "The network is holding your connection behind a sign-in page (a captive portal). These pages are sometimes faked to capture details.",
      why: ["The platform reported a captive portal on this network.", "Sign-in pages on public Wi‑Fi can be impersonated."],
      what_to_do: "Only enter details the venue would reasonably ask for. Never enter bank or email passwords on a Wi‑Fi sign-in page.",
      summary: "Wi‑Fi has a sign-in page (captive portal).",
    };
  }
  if (n.type === "wifi" && (n.wifiSecurity === "open" || n.wifiSecurity === "wep")) {
    const open = n.wifiSecurity === "open";
    return {
      state: "growling", key: `wifi-${n.wifiSecurity}`, headline: open ? "You're on an open Wi‑Fi network" : "This Wi‑Fi uses outdated security",
      what_happened: open ? "This Wi‑Fi has no password, so others nearby can see unencrypted traffic." : "This Wi‑Fi uses WEP, which can be broken in minutes.",
      why: [open ? "The platform reported the network has no encryption." : "The platform reported WEP security."],
      what_to_do: "Stick to https websites and apps, avoid banking, or use mobile data. Apollo can't confirm this network is hostile — just that it isn't private.",
      summary: open ? "Open Wi‑Fi (no password)." : "Wi‑Fi uses outdated WEP security.",
    };
  }
  if (n.type === "wifi") return { state: null, key: `wifi-${n.wifiSecurity}`, headline: "", what_happened: "", why: [], what_to_do: "", summary: n.wifiSecurity === "unknown" ? "Wi‑Fi connected. The platform doesn't reveal its security type here." : `Wi‑Fi secured (${n.wifiSecurity.toUpperCase()}).` };
  return { state: null, key: `ok-${n.type}`, headline: "", what_happened: "", why: [], what_to_do: "", summary: `Connected via ${n.type}${n.vpnActive ? " with VPN" : ""}.` };
}
