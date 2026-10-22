// Device Capabilities — the honest map behind the Device area.
//
// It answers exactly four questions for the person, in their order:
//   1. What does my device already protect?          → deviceProtects[]  (attribution preserved)
//   2. What is Apollo actually allowed to use?       → apolloCanUse[] / needsPermission[]
//   3. What can Apollo NOT access?                   → notAccessible[] / unavailable[] / unknown[]
//   4. What extra native protection can I turn on?   → recommendations[]
//
// Hard rules this module enforces:
//   • A capability is only "Apollo can use" when a real read said so. A failed read stays `unknown`.
//   • A native protection stays attributed to its provider (Samsung/Google/carrier/Apple) and is
//     NEVER described as an Apollo detection.
//   • Where the OS does not expose a capability or its classification, that is reported as managed by
//     the device — Apollo never infers it from an indirect signal.
//   • Apollo never claims a native setting is on or off when it cannot read it. It says so plainly
//     and tells the person exactly what to check and why.
//
// Pure and unit-tested (tests/deviceCapabilities.test.ts). No React, no native imports.

import type { SettingsTarget } from "../utils/deviceSettings";

// ────────────────────────────────────────────────────────────────────
// The five declared classes (+ one honest "couldn't tell")
// ────────────────────────────────────────────────────────────────────

export type CapabilityClass =
  /** Apollo can use this capability on this device right now. */
  | "apollo_can_use"
  /** Exists and Apollo may use it, but it needs the person's permission first. */
  | "permission_required"
  /** Exists on this device, but the OS/OEM does not expose it to Apollo. */
  | "not_exposed"
  /** Not present on this device at all. */
  | "unavailable"
  /** Apollo asked and the read failed. Never upgraded to anything else. */
  | "unknown"
  /** Apollo is not running on the phone itself (browser preview), so nothing can be read. */
  | "not_readable_here";

export const CAPABILITY_CLASS_LABEL: Record<CapabilityClass, string> = {
  apollo_can_use: "Available to Apollo",
  permission_required: "Permission needed",
  not_exposed: "Managed by your device",
  unavailable: "Not available to Apollo",
  unknown: "Apollo couldn’t check",
  not_readable_here: "Can’t be read in this preview",
};

/** Native protection managed by the device — the second class in the Device Capabilities objective.
 *  It is tracked separately from Apollo's own capabilities because the provider, not Apollo, owns it. */
export type NativeProtectionState = "active" | "installed_not_default" | "absent" | "unknown";

export const NATIVE_STATE_LABEL: Record<NativeProtectionState, string> = {
  active: "Active on your device",
  installed_not_default: "Installed, not active",
  absent: "Not on this device",
  unknown: "Apollo couldn’t tell",
};

export type CapabilityPlatform = "android" | "ios" | "web" | "windows" | "macos";

// ────────────────────────────────────────────────────────────────────
// Inputs — structural copies of the real runtime contracts, so this
// module stays pure and testable without importing native code.
// ────────────────────────────────────────────────────────────────────

export type CapabilityStatus = "supported" | "permission_required" | "unsupported";

export interface NativeCapabilityReads {
  installEvents: CapabilityStatus;
  appPermissions: CapabilityStatus;
  accessibilityServices: CapabilityStatus;
  overlayApps: CapabilityStatus;
  notificationAccess: CapabilityStatus;
  vpnState: CapabilityStatus;
  profileState: CapabilityStatus;
  appNetworkCorrelation: CapabilityStatus;
}

export interface ProviderRead {
  provider: string;
  packageName: string;
  installed: boolean;
  isDefaultHandler: boolean;
  feature: string;
  /** Whether the provider exposes its scam classification to Apollo through a permitted interface. */
  classificationAccessible: boolean;
  note: string;
}

export interface NativeProtectionRead {
  callProtection: ProviderRead[];
  messageProtection: ProviderRead[];
  defaultDialerPackage: string;
  defaultSmsPackage: string;
}

export interface DeviceCapabilityInput {
  platform: CapabilityPlatform;
  /** null means the native capability read failed or no native host answered — never "nothing found". */
  caps: NativeCapabilityReads | null;
  /** null means native protection detection failed or is unsupported on this host. */
  native: NativeProtectionRead | null;
  /**
   * False when Apollo is not running on the phone itself (browser preview, or a build without
   * Apollo's device module). Nothing can be read there — which is a different fact from a
   * capability being absent, so every row becomes `not_readable_here` rather than "not on this
   * device".
   */
  hostIsDevice?: boolean;
}

// ────────────────────────────────────────────────────────────────────
// Outputs
// ────────────────────────────────────────────────────────────────────

export interface CapabilityAction {
  target: SettingsTarget;
  path: string;
  label: string;
}

export interface CapabilityRow {
  id: string;
  title: string;
  /** What this capability actually is, in plain words. */
  what: string;
  /** Why it matters to the person — the benefit of Apollo having it. */
  benefit: string;
  /** What Apollo uses this for, in plain words. */
  purpose: string;
  klass: CapabilityClass;
  /** The honest sentence shown under the title. */
  detail: string;
  /** Who owns this fact — "Apollo" for Apollo's own capabilities, otherwise the provider/OS. */
  attributedTo: string;
  action?: CapabilityAction;
}

export interface NativeProtectionRow {
  id: string;
  /** Always the provider's own name. Apollo never substitutes its own. */
  provider: string;
  feature: string;
  kind: "call" | "message";
  state: NativeProtectionState;
  stateLabel: string;
  detail: string;
  /** Can Apollo read this provider's classification through a permitted interface? */
  classificationAccessible: boolean;
  /** Plain statement of whether that classification can become Apollo evidence. */
  evidenceLine: string;
}

export interface NativeRecommendation {
  id: string;
  title: string;
  /** "Recommended protection" / "Optional protection" — never "Enabled". */
  badge: string;
  /** Apollo's honest admission that it cannot read this setting. */
  unverified: string;
  /** What Higgins recommends the person check. */
  recommendation: string;
  /** Button text, e.g. "Check Play Protect". */
  actionLabel: string;
  /** Why this setting matters, in plain words. */
  why: string;
  /** Exactly which setting should be enabled and where. */
  steps: string[];
  settingsTarget: SettingsTarget;
  settingsPath: string;
}

export interface DeviceCapabilityView {
  deviceProtects: NativeProtectionRow[];
  apolloCanUse: CapabilityRow[];
  needsPermission: CapabilityRow[];
  notAccessible: CapabilityRow[];
  unavailable: CapabilityRow[];
  unknown: CapabilityRow[];
  /** Apollo isn't on the phone here, so nothing could be read. Never "absent". */
  notReadableHere: CapabilityRow[];
  recommendations: NativeRecommendation[];
  /** One honest sentence about coverage — counts only, no grading. */
  summary: string;
}

/** Everything in the view, in the order a person reads it. */
export function allCapabilityRows(view: DeviceCapabilityView): CapabilityRow[] {
  return [
    ...view.apolloCanUse, ...view.needsPermission, ...view.notAccessible,
    ...view.unknown, ...view.notReadableHere, ...view.unavailable,
  ];
}

/**
 * The one thing Higgins recommends for a capability in its current state, or null when there is
 * genuinely nothing to do. State-driven, so it can never recommend an action that contradicts the
 * read — and it never claims a provider's setting is on or off.
 */
export function capabilityAdvice(row: CapabilityRow): string | null {
  const ownedByPlatform = ["Android", "iOS", "Windows", "macOS", "this browser"].includes(row.attributedTo);
  switch (row.klass) {
    case "apollo_can_use":
      return null;
    case "permission_required":
      return `Allowing ${row.title.toLowerCase()} helps Apollo spot suspicious activity this capability covers. Apollo asks for it at the moment it is needed — you can also turn it on in Settings now.`;
    case "not_exposed":
      return ownedByPlatform
        ? `Nothing to do. ${row.attributedTo} keeps this private from every app, so Apollo works from what you choose to show it instead.`
        : `Keep ${row.attributedTo} switched on — it protects you whether or not it shares what it finds with Apollo. Higgins can show you where to check it.`;
    case "unknown":
      return "Nothing is wrong yet — Apollo simply could not read this. Run a device check again and it may settle.";
    case "not_readable_here":
      return "Open Apollo on your phone to see the real state of this.";
    default:
      return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Capability catalogue
// ────────────────────────────────────────────────────────────────────

interface CapabilityDef {
  id: string;
  title: string;
  /** What this capability is, in plain words. */
  what: string;
  /** Why it matters to the person. */
  benefit: string;
  purpose: string;
  /** Platforms on which this capability could exist at all. */
  platforms: CapabilityPlatform[];
  /** Which native read reports its status, when one does. */
  capKey?: keyof NativeCapabilityReads;
  /** Scope note appended when Apollo CAN use it, so reach is never overstated. */
  scope?: string;
  /** Why the OS withholds it, per platform. Used verbatim — attribution preserved. */
  notExposed?: Partial<Record<CapabilityPlatform, string>>;
  action?: CapabilityAction;
}

const CATALOGUE: CapabilityDef[] = [
  {
    id: "app_permissions",
    title: "App permissions",
    what: "The list of things an app has been allowed to use on this phone — camera, microphone, location, messages, or control of the screen.",
    benefit: "Scammers who talk someone through an install nearly always need one of these switched on. Seeing what an app holds is how you catch that, and how you know exactly what to turn off.",
    purpose: "See which apps hold camera, microphone, location, SMS or accessibility access.",
    platforms: ["android", "ios"],
    capKey: "appPermissions",
    scope: "Apollo reads permissions for apps you name and for a published list of remote-access tools — never your whole app list.",
    notExposed: { ios: "Apple does not let any app read another app’s permissions." },
    action: { target: "apps", path: "Settings → Apps → Permissions", label: "Open app permissions" },
  },
  {
    id: "accessibility_services",
    title: "Accessibility services",
    what: "A powerful Android setting that lets one app read and control what happens on your screen. It is built for people who need it, and abused by remote-access scams.",
    benefit: "This is the single most common thing a phone scammer asks someone to turn on. If something holds it and shouldn’t, that is worth knowing today.",
    purpose: "Spot a remote-control or screen-reading service a caller talked you into enabling.",
    platforms: ["android", "ios"],
    capKey: "accessibilityServices",
    notExposed: { ios: "Apple does not list other apps’ accessibility services to any app." },
    action: { target: "accessibility", path: "Settings → Accessibility", label: "Open Accessibility" },
  },
  {
    id: "notification_access",
    title: "Notification access",
    what: "Permission for Apollo to see the notifications your messaging apps post — the banner text, not your message history.",
    benefit: "It lets Apollo check a scam text the moment it arrives, without ever opening your messages.",
    purpose: "Let Text Guard check scam texts from your messaging app’s notifications — without ever reading your SMS database.",
    platforms: ["android"],
    capKey: "notificationAccess",
    action: { target: "notification_access", path: "Settings → Apps → Special access → Notification access", label: "Open notification access" },
  },
  {
    id: "overlay_apps",
    title: "Apps drawing over others",
    what: "The permission that lets one app draw on top of another — the trick behind a fake banking screen sitting over the real one.",
    benefit: "If a hidden app can paint a fake login over your bank, everything you type goes to whoever put it there. Knowing which apps can do this is how you stop it.",
    purpose: "Catch an app covering your banking screen with a fake one.",
    platforms: ["android"],
    capKey: "overlayApps",
    notExposed: { android: "Android does not let Apollo list which other apps are drawing over the screen." },
    action: { target: "overlay", path: "Settings → Apps → Special access → Display over other apps", label: "Open overlay settings" },
  },
  {
    id: "vpn_state",
    title: "VPN status",
    what: "Whether a VPN is active on this phone. Apollo’s own protection runs as one.",
    benefit: "It confirms Apollo’s protection is really running, and shows up a VPN you didn’t set up — which can quietly route everything you do through someone else.",
    purpose: "Confirm Apollo’s own protection is running and notice a VPN you didn’t set up.",
    platforms: ["android", "ios", "windows", "macos"],
    capKey: "vpnState",
    scope: "Apollo can see whether a VPN is on. The operating system may not tell it which app is running one.",
    action: { target: "vpn", path: "Settings → Network → VPN", label: "Open VPN settings" },
  },
  {
    id: "profile_state",
    title: "Management profile",
    what: "A configuration or device-admin profile, which hands another party control over parts of this phone.",
    benefit: "Work phones have these for good reasons. One you don’t recognise can mean someone else can install apps, wipe the phone or watch what you do.",
    purpose: "Notice a configuration profile that gives someone else control of this device.",
    platforms: ["android", "ios"],
    capKey: "profileState",
    action: { target: "security", path: "Settings → Security → Device admin apps", label: "Open device admin" },
  },
  {
    id: "install_events",
    title: "New app installs",
    what: "An app appearing on this phone, and when it arrived.",
    benefit: "An app that turned up during or just after a suspicious call is the strongest sign a remote-access scam got somewhere.",
    purpose: "Notice an app that appeared during or just after a suspicious call.",
    platforms: ["android", "ios"],
    capKey: "installEvents",
    notExposed: {
      android: "Android does not give Apollo a live feed of app installs; Apollo compares what it can see between checks instead.",
      ios: "Apple does not tell any app when another app is installed.",
    },
  },
  {
    id: "app_network",
    title: "App network activity",
    what: "Which app made a connection that Apollo’s protection saw or blocked.",
    benefit: "A blocked connection is only half the story. Tying it to the app that made it tells you what to remove.",
    purpose: "Tie a blocked connection back to the app that made it.",
    platforms: ["android", "windows", "macos"],
    capKey: "appNetworkCorrelation",
    notExposed: { ios: "Apple never exposes another app’s identity to a third-party network extension." },
  },
  {
    id: "call_history",
    title: "Recent callers",
    what: "The numbers that have called this phone recently.",
    benefit: "You can tap the caller you’re worried about instead of typing a number you might mistype — and Apollo reads only the one you pick.",
    purpose: "Let you pick a recent caller to check instead of typing the number.",
    platforms: ["android", "ios"],
    notExposed: { ios: "Apple does not let any app read your call history." },
    action: { target: "apps", path: "Settings → Apps → Apollo → Permissions → Phone", label: "Open Apollo’s permissions" },
  },
  {
    id: "message_inbox",
    title: "Messages",
    what: "The text messages on this phone.",
    benefit: "You can pick the message you’re worried about instead of copying it across — and Apollo reads only the one you pick.",
    purpose: "Let you pick a message to check instead of copying it across.",
    platforms: ["android", "ios"],
    notExposed: { ios: "Apple does not let any app read your messages. You can still share a message into Apollo yourself." },
    action: { target: "apps", path: "Settings → Apps → Apollo → Permissions → SMS", label: "Open Apollo’s permissions" },
  },
  {
    id: "installed_apps",
    title: "Installed apps",
    what: "The apps on this phone that Apollo is allowed to see.",
    benefit: "You can choose the app you want checked from a list, instead of having to spell its name exactly.",
    purpose: "Offer a pick-from-list when you want an app checked.",
    platforms: ["android", "ios"],
    scope: "Apollo sees apps you can open from your launcher plus a published list of remote-access tools. It does not request permission to see every app.",
    notExposed: { ios: "Apple does not let any app list the other apps you have installed." },
  },
  {
    id: "native_call_verdict",
    title: "Your phone’s own scam-call warning",
    what: "The spam or scam label your phone itself puts on an incoming call — from Samsung, Google or your carrier, never from Apollo.",
    benefit: "When your phone shares that label, Apollo can record it as their finding and start its own investigation from it, instead of waiting for you to report the call.",
    purpose: "Use your phone’s own spam warning as evidence and start an Apollo investigation from it.",
    platforms: ["android", "ios"],
  },
  {
    id: "native_message_verdict",
    title: "Your phone’s own spam-text warning",
    what: "The spam label your messaging app itself puts on a text — from Google Messages, Samsung or your carrier, never from Apollo.",
    benefit: "When your messaging app shares that label, Apollo can record it as their finding and investigate from there, instead of waiting for you to notice.",
    purpose: "Use your messaging app’s own spam warning as evidence and start an Apollo investigation from it.",
    platforms: ["android", "ios"],
  },
];

// ────────────────────────────────────────────────────────────────────
// Native protection recommendations — "what else can I turn on?"
// ────────────────────────────────────────────────────────────────────

const RECOMMENDED = "Recommended protection";
const CANNOT_VERIFY = "Apollo can’t verify whether this is currently enabled.";

const GOOGLE_CALL_STEPS = [
  "Open the Phone app",
  "Tap the three dots (top right) → Settings",
  "Tap ‘Caller ID & spam’",
  "Turn on ‘See caller and spam ID’",
  "Turn on ‘Filter spam calls’ if you want suspected spam silenced",
];
const SAMSUNG_CALL_STEPS = [
  "Open the Phone app",
  "Tap the three dots (top right) → Settings",
  "Tap ‘Caller ID and spam protection’ (or ‘Smart Call’)",
  "Turn it on",
];
const GOOGLE_MESSAGE_STEPS = [
  "Open the Messages app",
  "Tap your profile picture → ‘Messages settings’",
  "Tap ‘Spam protection’",
  "Turn on ‘Enable spam protection’",
];
const SAMSUNG_MESSAGE_STEPS = [
  "Open the Messages app",
  "Tap the three dots (top right) → Settings",
  "Tap ‘Block numbers and spam’ → ‘Caller ID and spam protection’",
  "Turn it on",
];

function androidRecommendations(native: NativeProtectionRead | null): NativeRecommendation[] {
  const dialer = native?.defaultDialerPackage ?? "";
  const sms = native?.defaultSmsPackage ?? "";
  const samsungDialer = dialer.includes("samsung");
  const samsungSms = sms.includes("samsung");
  return [
    {
      id: "play_protect",
      title: "Google Play Protect",
      badge: RECOMMENDED,
      unverified: CANNOT_VERIFY,
      recommendation: "Higgins recommends checking that Play Protect is turned on.",
      actionLabel: "Check Play Protect",
      why: "Play Protect is Google’s own scan of the apps on your phone, before and after you install them. It covers ground Apollo cannot reach, and anything it finds stays Google’s finding — not Apollo’s.",
      steps: [
        "Open the Play Store",
        "Tap your profile picture (top right)",
        "Tap ‘Play Protect’, then the settings cog",
        "Turn on ‘Scan apps with Play Protect’",
        "Tap ‘Scan’ to check your apps now",
      ],
      settingsTarget: "security",
      settingsPath: "Play Store → Profile → Play Protect → Settings",
    },
    {
      id: "caller_id_spam",
      title: samsungDialer ? "Samsung caller ID and spam protection" : "Caller ID & spam protection",
      badge: RECOMMENDED,
      unverified: CANNOT_VERIFY,
      recommendation: `Higgins recommends checking that caller ID and spam protection is turned on in your ${samsungDialer ? "Samsung " : ""}Phone app.`,
      actionLabel: "Check caller ID & spam",
      why: "Your phone app can label a suspected spam or scam call before you answer it. That label belongs to Google or Samsung, not to Apollo — Apollo still checks a call separately whenever you ask it to.",
      steps: samsungDialer ? SAMSUNG_CALL_STEPS : GOOGLE_CALL_STEPS,
      settingsTarget: "apps",
      settingsPath: "Phone app → Settings → Caller ID & spam",
    },
    {
      id: "message_spam",
      title: samsungSms ? "Samsung Messages spam protection" : "Messages spam protection",
      badge: RECOMMENDED,
      unverified: CANNOT_VERIFY,
      recommendation: "Higgins recommends checking that spam protection is turned on in your messaging app.",
      actionLabel: "Check message spam protection",
      why: "Your messaging app can move suspected spam out of your inbox and warn you about dangerous links. That decision belongs to your messaging app, not to Apollo.",
      steps: samsungSms ? SAMSUNG_MESSAGE_STEPS : GOOGLE_MESSAGE_STEPS,
      settingsTarget: "apps",
      settingsPath: "Messages app → Settings → Spam protection",
    },
  ];
}

function iosRecommendations(): NativeRecommendation[] {
  return [
    {
      id: "silence_unknown_callers",
      title: "Silence Unknown Callers",
      badge: RECOMMENDED,
      unverified: CANNOT_VERIFY,
      recommendation: "Higgins recommends checking that Silence Unknown Callers is turned on.",
      actionLabel: "Check Silence Unknown Callers",
      why: "Calls from numbers that aren’t in your contacts go straight to voicemail instead of ringing. Most scam calls come from numbers you’ve never saved, so this removes the pressure of answering one.",
      steps: ["Open Settings → Apps → Phone", "Tap ‘Silence Unknown Callers’", "Turn it on"],
      settingsTarget: "apps",
      settingsPath: "Settings → Apps → Phone → Silence Unknown Callers",
    },
    {
      id: "filter_unknown_senders",
      title: "Filter Unknown Senders",
      badge: RECOMMENDED,
      unverified: CANNOT_VERIFY,
      recommendation: "Higgins recommends checking that Filter Unknown Senders is turned on in Messages.",
      actionLabel: "Check message filtering",
      why: "Messages from people who aren’t in your contacts are sorted into a separate list and stop appearing in your main inbox, so a scam text can’t sit next to a message from your bank.",
      steps: ["Open Settings → Apps → Messages", "Tap ‘Unknown & Spam’", "Turn on ‘Filter Unknown Senders’"],
      settingsTarget: "apps",
      settingsPath: "Settings → Apps → Messages → Unknown & Spam",
    },
    {
      id: "lockdown_mode",
      title: "Lockdown Mode",
      badge: "Optional protection",
      unverified: CANNOT_VERIFY,
      recommendation: "Higgins only recommends this if you believe you are being personally targeted — it switches off features you may rely on every day.",
      actionLabel: "Read about Lockdown Mode",
      why: "Lockdown Mode is Apple’s extreme protection for people at risk of targeted attack. It blocks most message attachments, some web technologies and unknown FaceTime calls. It is not needed for everyday scam protection.",
      steps: ["Open Settings → Privacy & Security", "Scroll to ‘Lockdown Mode’", "Read what it switches off before you turn it on"],
      settingsTarget: "security",
      settingsPath: "Settings → Privacy & Security → Lockdown Mode",
    },
  ];
}

/** A provider that is installed but isn't the active handler can be switched on by the person. */
function defaultHandlerRecommendations(native: NativeProtectionRead | null): NativeRecommendation[] {
  if (!native) return [];
  const rows: NativeRecommendation[] = [];
  const offer = (p: ProviderRead, kind: "call" | "message") => {
    if (!p.installed || p.isDefaultHandler) return;
    const app = kind === "call" ? "phone app" : "messaging app";
    const subject = kind === "call" ? "calls" : "messages";
    rows.push({
      id: `default_${kind}_${p.packageName}`,
      title: `${p.provider} is installed but not active`,
      badge: "Available protection",
      unverified: `Apollo can see ${p.provider} on this device, but it is not the app handling your ${subject}, so its protection isn’t being applied.`,
      recommendation: `Higgins recommends choosing ${p.provider} as your ${app} if you want its protection: ${p.feature}.`,
      actionLabel: `Choose your ${app}`,
      why: `${p.provider} only filters ${subject} while it is the app handling them. Whichever app you choose, the filtering belongs to that provider — Apollo checks ${subject} separately when you ask.`,
      steps: ["Open Settings → Apps → Default apps", `Tap ‘${kind === "call" ? "Phone app" : "SMS app"}’`, `Choose ${p.provider}`],
      settingsTarget: "apps",
      settingsPath: `Settings → Apps → Default apps → ${kind === "call" ? "Phone app" : "SMS app"}`,
    });
  };
  for (const p of native.callProtection) offer(p, "call");
  for (const p of native.messageProtection) offer(p, "message");
  return rows;
}

// ────────────────────────────────────────────────────────────────────
// Builder
// ────────────────────────────────────────────────────────────────────

function nativeRow(p: ProviderRead, kind: "call" | "message", nativeReadOk: boolean): NativeProtectionRow {
  const state: NativeProtectionState = !nativeReadOk
    ? "unknown"
    : p.installed && p.isDefaultHandler
      ? "active"
      : p.installed
        ? "installed_not_default"
        : "absent";
  const subject = kind === "call" ? "calls" : "messages";
  const detail = state === "active"
    ? `${p.feature}. This is ${p.provider}’s protection, running on your device — not Apollo’s.`
    : state === "installed_not_default"
      ? `${p.provider} is installed but is not the app handling your ${subject}, so its protection isn’t being applied.`
      : state === "absent"
        ? `${p.provider} is not on this device.`
        : `Apollo could not read whether ${p.provider} is present.`;
  const evidenceLine = p.classificationAccessible
    ? `${p.provider} shares its classification with Apollo. When it flags something, Apollo records it as ${p.provider}’s finding and opens its own investigation from there.`
    : p.note;
  return {
    id: `${kind}:${p.packageName}`,
    provider: p.provider,
    feature: p.feature,
    kind,
    state,
    stateLabel: NATIVE_STATE_LABEL[state],
    detail,
    classificationAccessible: p.classificationAccessible,
    evidenceLine,
  };
}

/** Resolve one capability definition against the real reads. */
function resolve(def: CapabilityDef, input: DeviceCapabilityInput): CapabilityRow {
  const { platform, caps, native } = input;
  const base = { id: def.id, title: def.title, what: def.what, benefit: def.benefit, purpose: def.purpose, attributedTo: "Apollo" };

  // Apollo isn't on the phone at all here, so nothing was read. That is not "absent".
  if (input.hostIsDevice === false) {
    return { ...base, klass: "not_readable_here", detail: "Apollo is not running on your phone here, so it could not read this. Open Apollo on your phone to see the real state." };
  }

  if (!def.platforms.includes(platform)) {
    return { ...base, klass: "unavailable", detail: `This capability does not exist on ${platformName(platform)}.`, attributedTo: platformName(platform) };
  }

  // Native scam classifications are owned by the provider, so they resolve from the protection read.
  if (def.id === "native_call_verdict" || def.id === "native_message_verdict") {
    return resolveNativeVerdict(def, base, native, def.id === "native_call_verdict" ? "call" : "message", platform);
  }

  if (def.capKey) {
    if (!caps) {
      return { ...base, klass: "unknown", detail: "Apollo asked this device and the read failed, so this is genuinely unknown — not an all-clear.", action: def.action };
    }
    const status = caps[def.capKey];
    if (status === "supported") {
      return { ...base, klass: "apollo_can_use", detail: def.scope ?? def.purpose, action: def.action };
    }
    if (status === "permission_required") {
      return { ...base, klass: "permission_required", detail: `Apollo can use this once you allow it. Apollo asks at the moment it is needed, never up front.`, action: def.action };
    }
    return notExposedRow(def, base, platform);
  }

  // Capabilities with no native status field: platform rules decide.
  const reason = def.notExposed?.[platform];
  if (reason) return { ...base, klass: "not_exposed", detail: reason, attributedTo: platformName(platform), action: def.action };
  // Android picker-backed reads are permission-gated and asked for in the moment.
  if (platform === "android" && (def.id === "call_history" || def.id === "message_inbox")) {
    return { ...base, klass: "permission_required", detail: "Apollo asks for this only when you choose to pick a recent caller or message, and only reads the one you pick.", action: def.action };
  }
  return { ...base, klass: "apollo_can_use", detail: def.scope ?? def.purpose, action: def.action };
}

type RowBase = { id: string; title: string; what: string; benefit: string; purpose: string; attributedTo: string };

function notExposedRow(def: CapabilityDef, base: RowBase, platform: CapabilityPlatform): CapabilityRow {
  const reason = def.notExposed?.[platform];
  if (reason) return { ...base, klass: "not_exposed", detail: reason, attributedTo: platformName(platform), action: def.action };
  if (platform === "android" || platform === "ios") {
    return { ...base, klass: "not_exposed", detail: `${platformName(platform)} does not expose this to Apollo on this device.`, attributedTo: platformName(platform), action: def.action };
  }
  return { ...base, klass: "unavailable", detail: `This capability is not available to Apollo on ${platformName(platform)}.`, attributedTo: platformName(platform) };
}

function resolveNativeVerdict(
  def: CapabilityDef,
  base: RowBase,
  native: NativeProtectionRead | null,
  kind: "call" | "message",
  platform: CapabilityPlatform,
): CapabilityRow {
  if (!native) {
    return { ...base, klass: "unknown", detail: "Apollo could not read which native protections this device has, so it cannot say whether a warning is available.", attributedTo: platformName(platform) };
  }
  const providers = kind === "call" ? native.callProtection : native.messageProtection;
  const sharing = providers.filter((p) => p.installed && p.classificationAccessible);
  if (sharing.length) {
    return {
      ...base,
      klass: "apollo_can_use",
      detail: `${sharing.map((p) => p.provider).join(", ")} share${sharing.length === 1 ? "s" : ""} its classification with Apollo. Apollo records it as their finding and opens its own investigation from there.`,
      attributedTo: sharing.map((p) => p.provider).join(", "),
    };
  }
  const present = providers.filter((p) => p.installed);
  if (present.length) {
    const names = present.map((p) => p.provider).join(", ");
    return {
      ...base,
      klass: "not_exposed",
      detail: `${names} ${present.length === 1 ? "decides" : "decide"} this on your device, but ${present.length === 1 ? "does" : "do"} not share that classification with Apollo through any supported interface. Apollo will not guess it from blocked calls or unknown numbers.`,
      attributedTo: names,
      action: kind === "call"
        ? { target: "apps", path: "Phone app → Settings → Caller ID & spam", label: `Check ${present[0].provider} settings` }
        : { target: "apps", path: "Messages app → Settings → Spam protection", label: `Check ${present[0].provider} settings` },
    };
  }
  return {
    ...base,
    klass: "unavailable",
    detail: `No ${kind === "call" ? "call" : "message"} protection Apollo recognises is present on this device, so there is no warning of its own to use.`,
    attributedTo: platformName(platform),
  };
}

export function platformName(platform: CapabilityPlatform): string {
  switch (platform) {
    case "android": return "Android";
    case "ios": return "iOS";
    case "windows": return "Windows";
    case "macos": return "macOS";
    default: return "this browser";
  }
}

export function buildDeviceCapabilities(input: DeviceCapabilityInput): DeviceCapabilityView {  const rows = CATALOGUE.map((def) => resolve(def, input));
  const nativeReadOk = input.native !== null;
  const deviceProtects = input.native
    ? [
        ...input.native.callProtection.map((p) => nativeRow(p, "call", nativeReadOk)),
        ...input.native.messageProtection.map((p) => nativeRow(p, "message", nativeReadOk)),
      ].filter((r) => r.state === "active" || r.state === "installed_not_default")
    : [];

  const recommendations = [
    ...(input.platform === "android" ? androidRecommendations(input.native) : []),
    ...(input.platform === "ios" ? iosRecommendations() : []),
    ...defaultHandlerRecommendations(input.native),
  ];

  const apolloCanUse = rows.filter((r) => r.klass === "apollo_can_use");
  const needsPermission = rows.filter((r) => r.klass === "permission_required");
  const notAccessible = rows.filter((r) => r.klass === "not_exposed");
  const unavailable = rows.filter((r) => r.klass === "unavailable");
  const unknown = rows.filter((r) => r.klass === "unknown");
  const notReadableHere = rows.filter((r) => r.klass === "not_readable_here");

  const summary = notReadableHere.length
    ? `Apollo is not running on your phone here, so it could not read any of the ${rows.length} capabilities it looks for. Open Apollo on your phone to see the real state.`
    : unknown.length
      ? `Apollo can use ${apolloCanUse.length} of the ${rows.length} capabilities it looks for here. ${unknown.length} could not be read, so ${unknown.length === 1 ? "it is" : "they are"} reported as unknown rather than clear.`
      : `Apollo can use ${apolloCanUse.length} of the ${rows.length} capabilities it looks for on this device. ${needsPermission.length} need your permission and ${notAccessible.length} are kept private by ${platformName(input.platform)}.`;

  return { deviceProtects, apolloCanUse, needsPermission, notAccessible, unavailable, unknown, notReadableHere, recommendations, summary };
}

// ────────────────────────────────────────────────────────────────────
// Higgins' reading — the same map, flattened into short state lines
// ────────────────────────────────────────────────────────────────────

export interface CapabilityReadingLike {
  view: DeviceCapabilityView;
  /** False when Apollo is not running on the device itself (browser preview). */
  hasNativeHost: boolean;
  capsReadFailed: boolean;
  nativeReadFailed: boolean;
}

export interface CapabilitySnapshotLines {
  summary: string;
  protections: string[];
  capabilities: string[];
  recommended: string[];
}

/**
 * Flattens the capability map into the lines Higgins receives with every question, so he answers
 * about this device from the SAME reading the Device screen shows. Attribution survives the
 * flattening: a native protection keeps its provider's name, a withheld classification says who withholds
 * it, and a failed read stays "couldn't tell" rather than becoming an all-clear.
 */
export function capabilitySnapshotLines(reading: CapabilityReadingLike): CapabilitySnapshotLines {
  const { view } = reading;
  const protections = view.deviceProtects.map((p) =>
    `${p.provider} — ${p.feature} — ${p.stateLabel} — ${p.classificationAccessible ? "shares its classification with Apollo" : "does not share its classification with Apollo"}`);
  const capabilities = allCapabilityRows(view)
    .map((row) => `${row.title}: ${CAPABILITY_CLASS_LABEL[row.klass]}${row.attributedTo !== "Apollo" ? ` (per ${row.attributedTo})` : ""}`);
  const recommended = view.recommendations.map((r) =>
    `${r.title} — ${r.badge} — Apollo cannot read whether this is on. ${r.recommendation}`);
  const summary = !reading.hasNativeHost
    ? "Apollo is not running on the device itself right now, so it cannot read this device's capabilities or its built-in protection."
    : reading.capsReadFailed || reading.nativeReadFailed
      ? `${view.summary} Some reads failed, so those are unknown rather than clear.`
      : view.summary;
  return { summary, protections, capabilities, recommended };
}
