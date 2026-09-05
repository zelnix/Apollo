// Gate 8 — Network Guard (Check This Network, N01–N12). Public ≠ malicious; open ≠ intercepted; a VPN the user
// chose is fine. Only SDK-reported blocks produce "Guarding"; if Apollo already handled it, the message stays calm.

import type { NetworkStatus } from "@/src/security/SecurityPlatformAdapter";
import type { ApolloState, EventCategory } from "./types";

export type NetworkContext = "home" | "work" | "public" | "unknown";
export const NETWORK_CONTEXTS: { id: NetworkContext; label: string }[] = [
  { id: "home", label: "Home" }, { id: "work", label: "Work / school" }, { id: "public", label: "Café, airport, hotel, shop" }, { id: "unknown", label: "Not sure" },
];
/** Summary of native network events (SDK). Never invented by the UI. */
export interface NetworkSdkSummary { blockedMalicious: number; c2Apps: string[]; unknownHosts: number; dnsChanged: boolean; vpnChangedRecently: boolean }
export interface SdkNetworkEvent { eventType: "blocked_destination" | "c2_traffic" | "dns_change" | "vpn_change" | "network_change" | "unknown_destinations"; domain: string | null; appName: string | null; verdict: "malicious" | "unknown" | "clean"; blocked: boolean; occurredAt: string; relatedThreatScent: string | null }
export function summariseNetworkEvents(events: SdkNetworkEvent[], sinceMs = 24 * 60 * 60 * 1000, now = Date.now()): NetworkSdkSummary {
  const recent = events.filter((e) => now - Date.parse(e.occurredAt) <= sinceMs);
  return {
    blockedMalicious: recent.filter((e) => e.eventType === "blocked_destination" && e.blocked).length,
    c2Apps: Array.from(new Set(recent.filter((e) => e.eventType === "c2_traffic").map((e) => e.appName ?? "an app"))),
    unknownHosts: recent.filter((e) => e.eventType === "unknown_destinations" || (e.verdict === "unknown" && !e.blocked)).length,
    dnsChanged: recent.some((e) => e.eventType === "dns_change"),
    vpnChangedRecently: recent.some((e) => e.eventType === "vpn_change"),
  };
}

export interface NetworkInput {
  status: NetworkStatus | null; context: NetworkContext; trustedSsids: string[];
  /** The network name the venue advertised (to spot lookalikes). */
  expectedName?: string;
  /** Did the user turn the active VPN on themselves? null = not sure. */
  vpnTrusted: boolean | null;
  /** A Wi‑Fi sign-in page appeared at this address (handed to Gate 3). */
  captiveUrl?: string;
  sdk?: NetworkSdkSummary | null;
  recentScentCategories?: EventCategory[];
}
export interface NetworkAnalysis { scenario: string; title: string; state: ApolloState; verdict: string; why: string[]; recommendation: string; handoff: "web" | "app" | "none"; technical: string[]; ssid: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function lookalike(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y || x === y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  // cheap edit distance for short SSIDs
  if (Math.abs(x.length - y.length) > 3) return false;
  const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) dp[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return dp[x.length][y.length] <= 3;
}
export function ssidMatches(actual: string | null, expected: string | undefined): "same" | "lookalike" | "different" | "unknown" {
  if (!actual || !expected?.trim()) return "unknown";
  if (norm(actual) === norm(expected)) return "same";
  return lookalike(actual, expected) ? "lookalike" : "different";
}

export function analyseNetwork(input: NetworkInput): NetworkAnalysis {
  const n = input.status;
  const ssid = n?.ssid ?? null;
  const wifi = n?.type === "wifi";
  const trusted = !!ssid && input.trustedSsids.includes(ssid);
  const sdk = input.sdk ?? null;
  const scent = new Set(input.recentScentCategories ?? []);
  const vpnOn = n?.vpnActive === true || n?.type === "vpn";
  const match = ssidMatches(ssid, input.expectedName);
  const technical = [`Connection: ${n ? (n.connected ? n.type : "offline") : "unknown"}`, ssid ? `Network name: ${ssid}` : "Network name: not revealed by the platform", wifi ? `Wi‑Fi security: ${n?.wifiSecurity}` : "", `Captive portal: ${n?.captivePortal === null || n?.captivePortal === undefined ? "unknown" : n.captivePortal ? "yes" : "no"}`, `VPN: ${vpnOn ? "active" : n?.vpnActive === null ? "unknown" : "off"}`, `Inspectable by this build: ${n?.inspectable ? "yes" : "no"}`,
    sdk ? `SDK: ${sdk.blockedMalicious} blocked, ${sdk.unknownHosts} unknown destinations${sdk.c2Apps.length ? `, C2 traffic from ${sdk.c2Apps.join(", ")}` : ""}${sdk.dnsChanged ? ", DNS changed" : ""}` : "SDK network events: not available on this build", `Context: ${input.context}${trusted ? " (trusted network)" : ""}`, `Threat Scent: ${scent.size ? [...scent].join(", ") : "none"}`].filter(Boolean);
  const R = (scenario: string, title: string, state: ApolloState, verdict: string, why: string[], recommendation: string, handoff: NetworkAnalysis["handoff"] = "none"): NetworkAnalysis => ({ scenario, title, state, verdict, why: why.filter(Boolean), recommendation, handoff, technical, ssid });

  if (!n || !n.connected) return R("N00", "Not connected", "resting", "You're offline. Nothing to check until you connect.", ["No network, no exposure."], "Nothing to do.");
  // N07 — command-and-control traffic from an installed app (Guard on the connection, Bark about the app).
  if (sdk?.c2Apps.length) return R("N07", "Dangerous traffic from an app blocked", "barking", `I blocked ${sdk.c2Apps.join(", ")} from reaching infrastructure used to control infected devices. The connection is stopped — the app needs your attention.`, ["This isn't a one-off bad link: the app kept trying to phone home.", "Apollo is standing guard on the connection; removing the app closes the door for good."], "Open Check This App for it and remove it unless you can explain why it needs that traffic.", "app");
  // N06 / N12 — dangerous connection already blocked; calm.
  if (sdk?.blockedMalicious) return R("N12", "Dangerous connection blocked", "biting", `I blocked ${sdk.blockedMalicious === 1 ? "a dangerous connection" : `${sdk.blockedMalicious} dangerous connections`}. No action needed.`, ["The destination is on a confirmed-malicious list.", "It was stopped before anything reached it.", "Apollo keeps watching quietly."], "Nothing to do. If this keeps happening from one app, Apollo will tell you which.");
  // N05 — captive portal on a suspicious domain → Gate 3.
  if (n.captivePortal && input.captiveUrl?.trim()) return R("N05", "Wi‑Fi sign-in page to check", "growling", "This network's sign-in page deserves a look before you type anything into it.", ["Fake sign-in pages imitate hotels, airports and even Google or Microsoft logins.", "Venue Wi‑Fi never needs your email or bank password."], "Apollo will check the page's address. Enter only what the venue would reasonably ask.", "web");
  if (n.captivePortal) return R("N05", "Wi‑Fi wants you to sign in", "growling", "This network holds you behind a sign-in page. These pages are sometimes faked.", ["The platform reported a captive portal.", "Only enter what the venue would reasonably ask — never an email or bank password."], "Paste the sign-in page's address above and Apollo will check it.", "web");
  // N09 / N10 — VPN.
  if (vpnOn && input.vpnTrusted === true) return R("N10", "Your VPN is on", "resting", "A VPN you turned on yourself is protecting this connection. Nothing to do.", ["You chose it — that's the whole difference.", "Apollo stays quiet for VPNs you trust."], "Nothing to do.");
  if (vpnOn && (scent.has("app") || scent.has("device") || sdk?.vpnChangedRecently)) return R("N09", "VPN switched on after an app or device change", "growling", "A VPN became active shortly after a suspicious app or device change. It can route everything you do through someone else.", ["A VPN you didn't set up can read or redirect your traffic.", "Apollo connected this to the earlier app/device event (Threat Scent)."], "Turn the VPN off (Settings → VPN) and check the app or profile that created it.", "app");
  if (vpnOn && input.vpnTrusted !== true) return R("N09", "A VPN is active", "ears_up", "A VPN is running. If you turned it on, all good — if not, find out what did.", ["VPNs are usually fine; unexpected ones aren't.", "Check Settings → VPN for the app or profile behind it."], "If you didn't set it up, turn it off and run Check My Device.", "app");
  // N08 — DNS changed.
  if (sdk?.dnsChanged) return R("N08", "DNS settings changed", scent.has("app") || scent.has("device") ? "growling" : "ears_up", "Your device's DNS settings changed. That decides which servers translate website names — a new VPN, profile or privacy DNS can do this.", ["Legitimate causes: a VPN you installed, a private-DNS service, or your work profile.", scent.has("app") || scent.has("device") ? "It followed a suspicious app/device event, which makes it more concerning." : "Not dangerous by itself."], "If you didn't change anything, check Settings → Network → Private DNS / VPN and Check My Device.", "app");
  // N03 — lookalike network name.
  if (wifi && match === "lookalike") return R("N03", "Network name looks similar, not the same", "ears_up", `“${ssid}” looks similar to “${input.expectedName?.trim()}”, but I can't confirm it's the same network.`, ["Lookalike hotspots are set up next to real ones to catch people.", "Same name ≠ same network; similar name is even less certain."], "Ask staff which network is theirs. Prefer mobile data for anything sensitive until you know.");
  if (wifi && match === "different") return R("N03", "Not the network you expected", "ears_up", `You're on “${ssid}”, not “${input.expectedName?.trim()}”.`, ["You may have joined a different hotspot automatically.", "Not necessarily hostile — but not what you meant to join."], "Switch to the network the venue named, or use mobile data.");
  // N04 — open Wi‑Fi.
  if (wifi && (n.wifiSecurity === "open" || n.wifiSecurity === "wep")) return R("N04", n.wifiSecurity === "open" ? "Open Wi‑Fi (no encryption)" : "Outdated Wi‑Fi security (WEP)", "ears_up", n.wifiSecurity === "open" ? "This network doesn't use normal Wi‑Fi encryption. That doesn't mean anyone is listening — it means they could." : "This network uses WEP, which is easy to break.", ["Apps and https websites still encrypt their own traffic.", "Avoid banking or logging in to email here unless you're on a VPN you trust."], "Stick to https and your apps; use mobile data for anything sensitive.");
  // N11 — many unknown destinations, nothing confirmed.
  if (sdk && sdk.unknownHosts >= 5) return R("N11", "Lots of unfamiliar destinations", "ears_up", `Your device talked to ${sdk.unknownHosts} destinations Apollo doesn't recognise. None are confirmed dangerous.`, ["Ads, analytics and content networks explain most of this.", "Nothing was blocked; Apollo is just noting the pattern."], "No action needed. Apollo will bark if any turn out to be dangerous.");
  // N02 — public Wi‑Fi.
  if (wifi && input.context === "public" && !trusted) return R("N02", "Public Wi‑Fi", "ears_up", "You're on public Wi‑Fi. I'll keep a closer watch while you're connected.", ["Public networks aren't attacks — they're just shared with strangers.", n.wifiSecurity === "unknown" ? "The platform doesn't reveal this network's security type." : `Wi‑Fi security: ${n.wifiSecurity.toUpperCase()}.`, "Nothing suspicious has been seen on it."], "Use it normally. Prefer your bank's app over its website, and don't install anything a sign-in page asks for.");
  // N01 — home / trusted / mobile data.
  if (wifi && (trusted || input.context === "home" || input.context === "work")) return R("N01", trusted ? "Trusted network" : input.context === "home" ? "Home Wi‑Fi" : "Work Wi‑Fi", "resting", `Nothing worrying on ${ssid ? `“${ssid}”` : "this network"}. ${trusted ? "You marked it trusted, so Apollo stays quiet here." : "No suspicious activity seen."}`, [n.wifiSecurity === "unknown" ? "The platform doesn't reveal the security type here." : `Wi‑Fi security: ${n.wifiSecurity.toUpperCase()}.`, "No dangerous destinations recorded."], "Nothing to do.");
  if (wifi) return R("N02", "Wi‑Fi you haven't classified", "ears_up", `You're on ${ssid ? `“${ssid}”` : "a Wi‑Fi network"}. Tell Apollo whether it's home, work or public so it knows how closely to watch.`, ["Unfamiliar networks get a closer watch by default.", "Nothing suspicious has been seen on it."], "Pick a context above, or mark it trusted in Guard if it's yours.");
  return R("N01", n.type === "cellular" ? "Mobile data" : "Connected", "resting", n.type === "cellular" ? "You're on mobile data — the safest everyday connection." : `Connected via ${n.type}. Nothing worrying.`, ["No shared Wi‑Fi, no sign-in pages.", "No dangerous destinations recorded."], "Nothing to do.");
}
