// Gate 7 — App & Device Engine (on-device). Guard Dog does not judge an app by its name: it watches
// what the app is allowed to do, where it came from, and what happened around it (Threat Scent).
// Works from what the user *tells* Apollo plus any Security-SDK findings; never pretends to see more.

import type { ApolloState, EventCategory } from "./types";

export type AppSource = "app_store" | "play_store" | "browser" | "message" | "other_store" | "not_sure";
export const APP_SOURCES: { id: AppSource; label: string }[] = [
  { id: "app_store", label: "Apple App Store" }, { id: "play_store", label: "Google Play" }, { id: "browser", label: "A website download" },
  { id: "message", label: "A file or link someone sent" }, { id: "other_store", label: "Another app store" }, { id: "not_sure", label: "Not sure" },
];

export type AppPurpose = "banking" | "security" | "remote_support" | "vpn" | "keyboard" | "accessibility_tool" | "cleaner" | "update" | "game_media" | "shopping_social" | "simple_tool" | "other";
export const APP_PURPOSES: { id: AppPurpose; label: string }[] = [
  { id: "banking", label: "Banking / payments" }, { id: "security", label: "Security / authenticator / password manager" }, { id: "remote_support", label: "Remote support / screen sharing" },
  { id: "vpn", label: "VPN" }, { id: "keyboard", label: "Keyboard" }, { id: "accessibility_tool", label: "Accessibility helper" }, { id: "cleaner", label: "Cleaner / battery / optimiser" },
  { id: "update", label: "An 'update' for another app" }, { id: "game_media", label: "Game / media" }, { id: "shopping_social", label: "Shopping / social" },
  { id: "simple_tool", label: "Simple tool (torch, calculator…)" }, { id: "other", label: "Something else / don't know" },
];

export type AppPermission = "accessibility" | "overlay" | "notifications" | "sms" | "calls" | "contacts" | "microphone" | "camera" | "location" | "device_admin" | "vpn" | "screen_share" | "keyboard" | "install_apps" | "files";
/** Plain-language permission explanations (PRD §7) + how much an *unexpected* grant contributes to risk. */
export const PERMISSION_INFO: Record<AppPermission, { label: string; plain: string; weight: number }> = {
  accessibility: { label: "Accessibility access", plain: "This can allow an app to read parts of your screen and interact with other apps — including typing and tapping for you.", weight: 30 },
  overlay: { label: "Draw over other apps", plain: "This can allow an app to display content over other apps, such as a fake login screen on top of a real one.", weight: 18 },
  notifications: { label: "Notification access", plain: "This may allow an app to read notifications, including security codes or account alerts.", weight: 18 },
  sms: { label: "SMS / text messages", plain: "Reads or sends your text messages — including one-time verification codes.", weight: 22 },
  calls: { label: "Phone / call log", plain: "Sees your call history or can place and redirect calls.", weight: 15 },
  contacts: { label: "Contacts", plain: "Reads the people in your address book.", weight: 8 },
  microphone: { label: "Microphone", plain: "Can listen while the app is allowed to run.", weight: 10 },
  camera: { label: "Camera", plain: "Can take photos or video.", weight: 8 },
  location: { label: "Location", plain: "Knows where you are.", weight: 8 },
  device_admin: { label: "Device admin / management", plain: "Can lock or wipe the device, change security settings and resist being uninstalled.", weight: 30 },
  vpn: { label: "VPN / network routing", plain: "Can route all your internet traffic through the app.", weight: 20 },
  screen_share: { label: "Screen sharing / remote control", plain: "Lets someone else see — and possibly control — your screen.", weight: 35 },
  keyboard: { label: "Keyboard / input", plain: "Keyboards may see text typed into many apps, depending on platform permissions.", weight: 12 },
  install_apps: { label: "Install other apps", plain: "Can install more apps without going through a store.", weight: 20 },
  files: { label: "Files / storage", plain: "Reads and writes files on the device.", weight: 5 },
};
export const APP_PERMISSIONS = Object.keys(PERMISSION_INFO) as AppPermission[];

/** Which permissions are ordinary for a claimed purpose. Anything else is "more than it needs". */
const EXPECTED: Record<AppPurpose, AppPermission[]> = {
  banking: ["camera", "location", "files", "notifications"],
  security: ["accessibility", "keyboard", "vpn", "camera", "notifications", "files"],
  remote_support: ["screen_share", "accessibility", "overlay", "microphone", "files"],
  vpn: ["vpn", "notifications"],
  keyboard: ["keyboard", "microphone", "contacts"],
  accessibility_tool: ["accessibility", "overlay", "microphone", "notifications"],
  cleaner: ["files"],
  update: [],
  game_media: ["microphone", "camera", "files"],
  shopping_social: ["camera", "contacts", "location", "microphone", "files", "notifications"],
  simple_tool: ["camera"],
  other: [],
};

const BRANDS = ["commbank", "westpac", "anz", "nab", "paypal", "auspost", "linkt", "ato", "mygov", "centrelink", "medicare", "telstra", "optus", "whatsapp", "netflix", "amazon", "microsoft", "apple", "google", "facebook", "instagram"];
const REMOTE_TOOLS = ["anydesk", "teamviewer", "quicksupport", "rustdesk", "airdroid", "airmirror", "supremo", "splashtop", "logmein", "rescue", "zoho assist", "ultraviewer", "remote desktop", "alpemix", "aweray", "hoptodesk"];

export interface AppContext {
  /** Someone on a phone call told the user to install it. */
  promptedByCaller?: boolean;
  /** A message, website or download led to the install. */
  promptedByMessageOrSite?: boolean;
  /** The user sought the app out themselves (e.g. contacted their own IT provider). */
  intentional?: boolean;
  /** Someone is connected / controlling the device right now (or already was). */
  accessGrantedNow?: boolean;
  /** Categories of non-resting Patrol events inside the Threat Scent window (supplied by the caller). */
  recentScentCategories?: EventCategory[];
}
/** Findings from the Security SDK's app→network correlation (never invented by the UI). */
export interface AppNetwork { blockedMalicious: number; unknownHosts: number; hosts: string[] }
export interface AppInput { name: string; developer?: string; source: AppSource; purpose: AppPurpose; permissions: AppPermission[]; context: AppContext; network?: AppNetwork | null }
export interface PermissionNote { id: AppPermission; label: string; plain: string; expected: boolean }
export interface AppAnalysis {
  scenario: string; title: string; state: ApolloState; verdict: string; why: string[]; recommendation: string;
  riskScore: number; permissionNotes: PermissionNote[]; claimedBrand: string | null; remoteCapable: boolean;
  handoff: "network" | "identity" | "none"; stayWithMe: boolean; technical: string[];
}

export function brandInName(name: string): string | null {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = BRANDS.find((b) => n.includes(b));
  return hit ? hit.charAt(0).toUpperCase() + hit.slice(1) : null;
}
export function isRemoteTool(name: string): boolean { const n = name.toLowerCase(); return REMOTE_TOOLS.some((t) => n.includes(t)); }

export function analyseApp(input: AppInput): AppAnalysis {
  const name = input.name.trim() || "This app";
  const ctx = input.context;
  const scent = new Set(ctx.recentScentCategories ?? []);
  const scentCall = scent.has("call");
  const scentWebOrFile = scent.has("website") || scent.has("link") || scent.has("known_threat") || scent.has("message");
  const official = input.source === "app_store" || input.source === "play_store";
  const sideload = input.source === "browser" || input.source === "message" || input.source === "other_store";
  const offStore = sideload || input.source === "not_sure";
  const impersonating = (brandInName(input.name.trim()) !== null || input.purpose === "update" || /\bupdate\b|\bupgrade\b/i.test(input.name)) && !(input.source === "app_store" || input.source === "play_store");
  // An off-store app wearing a brand name or posing as an "update" gets no purpose credit: every permission counts.
  const expected = new Set(impersonating ? [] : EXPECTED[input.purpose]);
  const perms = Array.from(new Set(input.permissions));
  const notes: PermissionNote[] = perms.map((p) => ({ id: p, label: PERMISSION_INFO[p].label, plain: PERMISSION_INFO[p].plain, expected: expected.has(p) }));
  const unexpected = notes.filter((n) => !n.expected);
  const unexpectedWeight = Math.min(60, unexpected.reduce((a, n) => a + PERMISSION_INFO[n.id].weight, 0));
  const brand = brandInName(name);
  const looksUpdate = input.purpose === "update" || /\bupdate\b|\bupgrade\b/i.test(name);
  const securityWords = /secur|protect|verif|anti.?virus|fraud/i.test(name);
  const remoteCapable = input.purpose === "remote_support" || perms.includes("screen_share") || isRemoteTool(name);
  const net = input.network ?? null;
  const has = (p: AppPermission) => perms.includes(p) && !expected.has(p);

  // Risk score (context-aware, PRD §8): source + unexpected permissions + timing/scent + reputation + network.
  let score = { app_store: 0, play_store: 0, other_store: 15, not_sure: 15, browser: 30, message: 40 }[input.source] + unexpectedWeight;
  if (ctx.promptedByCaller || scentCall) score += 40;
  if (ctx.promptedByMessageOrSite || (offStore && scentWebOrFile)) score += 30;
  if (brand && offStore) score += 35;
  if (looksUpdate && offStore) score += 35;
  if (securityWords && offStore && input.purpose !== "security") score += 20;
  if (remoteCapable && !ctx.intentional) score += 20;
  if (net?.blockedMalicious) score += 35;
  if (net && net.unknownHosts >= 5) score += 10;
  if (ctx.intentional) score -= 20;
  score = Math.max(0, Math.min(100, score));
  const byScore: ApolloState = score >= 70 ? "barking" : score >= 40 ? "growling" : score >= 15 ? "ears_up" : "resting";

  const technical = [`Name: ${name}`, input.developer ? `Developer: ${input.developer}` : "Developer: not provided", `Source: ${APP_SOURCES.find((s) => s.id === input.source)?.label}`, `Claimed purpose: ${APP_PURPOSES.find((p) => p.id === input.purpose)?.label}`,
    `Permissions: ${perms.length ? perms.map((p) => PERMISSION_INFO[p].label).join(", ") : "none selected"}`, `Unexpected for purpose: ${unexpected.length ? unexpected.map((n) => n.label).join(", ") : "none"}`,
    `Remote-access capable: ${remoteCapable ? "yes" : "no"}`, brand ? `Name contains brand: ${brand}` : "", net ? `Network (SDK): ${net.blockedMalicious} blocked, ${net.unknownHosts} unknown destinations` : "Network behaviour: not visible on this build", `Threat Scent context: ${scent.size ? [...scent].join(", ") : "none"}`, `Risk score: ${score}`].filter(Boolean);
  const permWhy = unexpected.length ? [`It asks for ${unexpected.slice(0, 3).map((n) => n.label.toLowerCase()).join(", ")} — more than a ${APP_PURPOSES.find((p) => p.id === input.purpose)?.label.toLowerCase() ?? "typical"} app needs.`] : [];
  const R = (scenario: string, title: string, state: ApolloState, verdict: string, why: string[], recommendation: string, extra: Partial<Pick<AppAnalysis, "handoff" | "stayWithMe">> = {}): AppAnalysis =>
    ({ scenario, title, state, verdict, why: why.filter(Boolean), recommendation, riskScore: score, permissionNotes: notes, claimedBrand: brand, remoteCapable, handoff: extra.handoff ?? "none", stayWithMe: extra.stayWithMe ?? false, technical });
  const removeAdvice = "Remove this app unless you intentionally installed it and trust the source. On Android: Settings → Apps. On iPhone: hold the icon → Remove App.";

  // A01 — remote-access app during a suspicious call (acceptance test 1).
  if (remoteCapable && (ctx.promptedByCaller || scentCall)) {
    return R("A01", "Remote access app during a suspicious call", "barking", "This app can let someone control or view your device. Because it was installed during a suspicious call, do not give the caller access.",
      ["Remote-access and screen-sharing apps hand your screen — and often your taps — to another person.", ctx.promptedByCaller ? "A caller told you to install it. Real banks and agencies never do this." : "Apollo saw a suspicious call shortly before this install (Threat Scent).", ...permWhy],
      ctx.accessGrantedNow ? "End the session now: turn off Wi‑Fi and mobile data, hang up, then remove the app. Follow the Stay With Me steps below." : "Don't open it or read out any code it shows. Hang up and remove the app. Contact the organisation yourself using details you find independently.", { stayWithMe: !!ctx.accessGrantedNow, handoff: "identity" });
  }
  // A16 — app installed right after a phishing site / suspicious download.
  if (sideload && (ctx.promptedByMessageOrSite || scentWebOrFile)) {
    return R("A16", "App installed after a suspicious link or download", "barking", `${name} was installed from outside the official store right after a suspicious ${scent.has("call") ? "call" : "link or download"}. These events appear connected.`,
      ["Apps that arrive through a link or file skip the store's checks entirely.", ctx.promptedByMessageOrSite ? "A message or website led you to install it — a common way malware and fake 'bank security' apps get in." : "Apollo connected this install to earlier suspicious activity (Threat Scent).", brand ? `The name uses ${brand}'s branding, but it didn't come from ${brand}'s store listing.` : "", ...permWhy],
      `${removeAdvice} Don't log in to anything through it.`, { stayWithMe: !!ctx.accessGrantedNow });
  }
  // A03 — fake app update.
  if (looksUpdate && offStore) return R("A03", "Fake app update", "barking", "Apps never update through a file or link someone sends you. Real updates come only from the App Store or Google Play.", [brand ? `It claims to update ${brand}.` : "It presents itself as an update for another app.", "Off-store 'updates' are one of the most common ways banking malware is installed.", ...permWhy], removeAdvice);
  // A03b — brand impersonation off-store (acceptance test 2 when combined with SMS/accessibility/overlay).
  if (brand && offStore) return R("A03", `App impersonating ${brand}`, "barking", `${name} uses ${brand}'s name but didn't come from the official store. ${brand} doesn't distribute apps this way.`, ["Brand names are free to copy; the store listing and developer identity are not.", ...permWhy, has("accessibility") || has("sms") || has("overlay") ? "The permissions it asks for are exactly what banking malware uses to read codes and fake login screens." : ""], removeAdvice, { handoff: "identity" });
  // A14 — SDK blocked a dangerous connection from this app (acceptance test 4).
  if (net?.blockedMalicious) return R("A14", "Dangerous connection blocked", byScore === "barking" ? "barking" : "growling", `I blocked a dangerous connection from this app. Review ${name}.`, [`${net.blockedMalicious} connection${net.blockedMalicious > 1 ? "s" : ""} to known malicious infrastructure ${net.blockedMalicious > 1 ? "were" : "was"} stopped.`, "An app that talks to dangerous servers isn't necessarily malware itself — but it deserves a hard look.", ...permWhy], "Keep the block in place. If you don't recognise or need this app, remove it. If it's from a developer you trust, check for an update.", { handoff: "network" });
  // A20 — legitimate remote support session.
  if (remoteCapable && ctx.intentional) return R("A20", "Remote support app you chose", "ears_up", "Remote-support tools are fine when you contacted the provider yourself. Make sure you know exactly who is receiving access.", ["Anyone connected can see your screen — and may be able to control it.", "Only share the session code with the technician you called; never with someone who called you.", "End the session yourself as soon as the work is done."], "Verify who's on the other end before sharing the code. Remove the app afterwards if you won't need it again.");
  // A01b — remote-access capable, no call context, not intentional.
  if (remoteCapable) return R("A01", "Remote access capable app", sideload ? "barking" : "growling", "This app can let someone else see or control your device.", ["Screen-sharing and remote-control apps are legitimate tools — and the #1 tool of phone scammers.", sideload ? "It didn't come from an official store." : "You didn't tell Apollo you sought this app out yourself.", ...permWhy], "If nobody you contacted asked you to install this, remove it. Never share the code it shows with anyone who phoned you.");
  // A05 — accessibility abuse (acceptance test 5 when combined with overlay + notifications).
  if (has("accessibility")) {
    const combo = has("overlay") || has("notifications") || has("sms");
    return R("A05", "Powerful accessibility access", sideload && combo ? "barking" : "growling", `${name} asks for accessibility access that its purpose doesn't explain.${combo ? " Combined with the other permissions, this is how apps read screens, capture codes and fake login pages." : ""}`,
      [PERMISSION_INFO.accessibility.plain, combo ? `It also asks for ${unexpected.filter((n) => n.id !== "accessibility").map((n) => n.label.toLowerCase()).join(" and ")}.` : "Accessibility helpers need this; most other apps do not.", sideload ? "It didn't come from an official store." : "Not confirmed malicious — but these permissions are powerful."], "Revoke accessibility access (Settings → Accessibility) unless you understand exactly why it needs it. Remove the app if you didn't choose it.", { handoff: "identity" });
  }
  // A17 — device admin / elevated control.
  if (has("device_admin")) return R("A17", "Asks for device admin control", sideload ? "barking" : "growling", `${name} wants device-administrator control — the power to lock, wipe or resist removal.`, [PERMISSION_INFO.device_admin.plain, sideload ? "Sideloaded apps with admin rights are very hard to remove later." : "Only work/school management apps you enrolled deliberately should have this.", ...permWhy], "Don't grant it. If already granted: Settings → Security → Device admin apps → deactivate, then uninstall.");
  // A10 — VPN unexpectedly.
  if (has("vpn")) return R("A10", "Unexpected VPN", "growling", `${name} can route all your internet traffic through itself — and it isn't a VPN app.`, [PERMISSION_INFO.vpn.plain, "A VPN you didn't choose can watch or redirect everything your phone does online.", ...permWhy.slice(0, 1)], "Turn the VPN off (Settings → VPN) and remove the app unless you set it up yourself. Apollo's Network gate will watch for connection changes.", { handoff: "network" });
  // A02 — sideloaded with unusual permissions / plain sideload.
  if (sideload && unexpected.length) return R("A02", "Sideloaded app with unusual permissions", byScore === "barking" ? "barking" : "growling", `${name} skipped the store's checks and asks for more than it should need.`, ["Sideloaded apps aren't all dangerous — but nobody has reviewed this one.", ...permWhy, input.developer ? "" : "You don't know who made it."], "Don't grant the extra permissions. Remove it unless you know exactly who made it and why you need it.");
  if (sideload) return R("A02", "Sideloaded app", "ears_up", `${name} was installed outside the official store. That alone isn't proof of harm — but no one checked it for you.`, ["Store apps go through automated and human review; this one didn't.", input.developer ? `Developer given: ${input.developer}. Apollo can't verify it on this build.` : "You don't know who made it.", "Watch what it asks for once opened."], "Keep it only if you know the developer. Come back to Apollo if it asks for accessibility, SMS or overlay access.");
  // A04 / A08 / A19 — excessive permissions.
  if (unexpected.length >= 3 || unexpectedWeight >= 35) return R(input.purpose === "cleaner" ? "A19" : has("sms") || has("calls") ? "A08" : "A04", "Asks for more than it needs", byScore === "barking" ? "barking" : "growling", `A ${APP_PURPOSES.find((p) => p.id === input.purpose)?.label.toLowerCase()} app shouldn't need ${unexpected.slice(0, 3).map((n) => n.label.toLowerCase()).join(", ")}.`, [...unexpected.slice(0, 3).map((n) => `${n.label}: ${n.plain}`), input.purpose === "cleaner" ? "'Cleaner' and 'booster' apps rarely do anything useful and often ask for broad control." : "Permissions alone don't prove bad intent — but they set the ceiling on what the app can do to you."], "Deny the permissions it doesn't need (Settings → Apps → Permissions). If it refuses to work without them, remove it.");
  // A06 / A07 / A09 / A08 — one or two sensitive permissions.
  if (unexpected.length) {
    const top = [...unexpected].sort((a, b) => PERMISSION_INFO[b.id].weight - PERMISSION_INFO[a.id].weight)[0];
    const titles: Partial<Record<AppPermission, [string, string]>> = { overlay: ["A06", "Can draw over other apps"], notifications: ["A07", "Can read notifications"], keyboard: ["A09", "Third-party keyboard"], sms: ["A08", "SMS access"], calls: ["A08", "Call access"], install_apps: ["A02", "Can install other apps"] };
    const [sc, title] = titles[top.id] ?? ["A04", `Asks for ${top.label.toLowerCase()}`];
    return R(sc, title, byScore === "resting" ? "ears_up" : byScore, `${name} has ${top.label.toLowerCase()}. ${top.plain}`, [top.id === "keyboard" ? "Third-party keyboards aren't automatically dangerous — many people use them happily." : "This alone isn't malicious.", `Escalate if it's combined with ${top.id === "overlay" ? "banking use or fake login screens" : top.id === "notifications" ? "a purpose that doesn't need it — it could read your security codes" : "other powerful permissions"}.`, ...(unexpected.length > 1 ? [`It also asks for ${unexpected.filter((n) => n.id !== top.id).map((n) => n.label.toLowerCase()).join(", ")}.`] : [])], `If ${name} doesn't need ${top.label.toLowerCase()} for what you use it for, turn it off in Settings. Otherwise, keep an eye on it.`);
  }
  // A15 — many unknown destinations, nothing confirmed.
  if (net && net.unknownHosts >= 5) return R("A15", "Talks to many unknown servers", "ears_up", `${name} connects to ${net.unknownHosts} destinations Apollo doesn't recognise. None are confirmed dangerous.`, ["Ads and analytics explain most of this for free apps.", "Apollo isn't crying wolf — it's just noting the pattern.", "Nothing was blocked."], "No action needed now. Apollo will bark if any destination turns out to be dangerous.", { handoff: "network" });
  // A09 — third-party keyboard: not malicious by default, but explain the reach.
  if (input.purpose === "keyboard") return R("A09", "Third-party keyboard", "ears_up", `${name} is a keyboard. ${PERMISSION_INFO.keyboard.plain}`, ["Keyboards aren't automatically dangerous — many people use them happily.", official ? "It came from the official store." : "Check the developer before typing passwords with it.", "Use your built-in keyboard for banking passwords if you're unsure."], "Keep it if you trust the developer. Switch to the built-in keyboard for sensitive logins.");
  // A13 / A18 — official store, permissions fit purpose.
  if (official) return R(input.purpose === "security" ? "A13" : "A18", input.purpose === "security" ? "Security app from the official store" : "App from the official store", "resting", `I didn't find anything worrying about ${name}. Its permissions fit what it says it does.`, ["It came from the official store, which is a useful signal — not proof of safety.", perms.length ? "Everything it asks for matches its purpose." : "No sensitive permissions selected.", "Apollo will keep watching what it does next."], "Nothing to do. Come back if it starts asking for accessibility, SMS or overlay access.");
  // not_sure source, nothing else unusual.
  return R("A18", "App from an unknown source", "ears_up", `Nothing about ${name}'s permissions worries me, but you're not sure where it came from.`, ["Where an app came from matters as much as what it asks for.", "Check its store listing: open the App Store / Google Play and search for it.", "If it isn't there, treat it as sideloaded."], "Look it up in the official store. If you can't find it, consider removing it.");
}
