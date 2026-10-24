/**
 * Higgins Local Responder — turns Diagnostic Core facts into
 * conversational Higgins answers WITHOUT calling Magnum DI or any API.
 *
 * This is the final step in the local-first pipeline:
 *   Intent Router → Diagnostic Core → Local Responder → user sees answer
 *
 * For local_knowledge intents, provides canned Apollo knowledge responses.
 */

import type { DiagnosticResult } from "./diagnosticCore";
import type { LocalKnowledgeIntent } from "./intentRouter";
import type { HigginsChatMessage } from "./chatClient";
import { navLinks, type NavLink } from "./appMap";
import * as Crypto from "expo-crypto";

// ── Turn diagnostic results into Higgins messages ────────────────────────────

/** Where each on-device answer sensibly leads, so the person can tap straight through. */
const DIAGNOSTIC_LINKS: Record<string, NavLink[]> = {
  protection_status: navLinks("/gates"),
  site_status: navLinks("/gates"),
  call_status: navLinks("/call-guard", "/gates"),
  text_status: navLinks("/text-guard", "/gates"),
  app_status: navLinks("/app-check", "/gates"),
  vpn_status: navLinks("/network", "/gates"),
  permission_status: navLinks("/gates"),
  notification_status: navLinks("/notification-check"),
  current_issues: navLinks("/(tabs)/patrol"),
};

export function diagnosticToHigginsMessage(result: DiagnosticResult, conversationId: string): HigginsChatMessage {
  const caveats = result.caveats.length > 0
    ? "\n\n" + result.caveats.map((c) => `_${c}_`).join("\n")
    : "";

  return {
    id: Crypto.randomUUID(),
    turnId: Crypto.randomUUID(),
    role: "higgins",
    content: result.summary + caveats,
    createdAt: new Date().toISOString(),
    conversationId,
    links: DIAGNOSTIC_LINKS[result.intent],
  };
}

// ── Local knowledge responses ────────────────────────────────────────────────

const KNOWLEDGE_RESPONSES: Record<LocalKnowledgeIntent, string> = {
  how_apollo_works:
    "Apollo is your scam protection, and four of us do the work:\n\n" +
    "• **Apollo** watches and detects — websites, calls, messages, apps, your device and your connection. Apollo acts on the phone.\n" +
    "• **Teddy FlyBy** investigates quickly — checking official sources, Apollo's knowledge base and one targeted search.\n" +
    "• **Magnum DI** investigates deeply — only when Teddy FlyBy can't settle something that could change the answer.\n" +
    "• **Higgins** (me) knows Apollo and scams. I explain what was found, guide you, and take you to the right screen.\n\n" +
    "Every check runs on your device first and produces exactly one threat case. If the rules settle it cleanly, that's your answer. If something looks possible, or can't be determined, Teddy FlyBy investigates it — and Magnum DI looks deeper only if that could change the answer. How Apollo checks has the full rules.",

  what_is_higgins:
    "I'm Higgins — Apollo's trusted adviser, interpreter and guide, and the savant of this app.\n\n" +
    "I know every screen, check, protection, setting and privacy rule in Apollo, and I know how scams work. Ask me where something is and I'll take you there. Ask me why Apollo is growling and I'll tell you from what your phone actually reports.\n\n" +
    "What I don't do is investigate — when you ask me to check a number, link, message or email, Teddy FlyBy investigates it first, Magnum DI looks deeper only if needed, and I bring you the findings.",

  what_is_magnum_di:
    "Magnum DI is Apollo's deep investigator. It's called only when Teddy FlyBy — Apollo's fast, low-cost investigator — can't settle something that could change the answer.\n\n" +
    "Teddy FlyBy checks official sources, Apollo's knowledge base and one targeted search first. Magnum DI then examines just what's still open — for example a picture Apollo couldn't read, or a request to send money somewhere nobody has verified — and returns a full briefing with findings and recommended actions.\n\n" +
    "\"Am I protected?\" is answered on your phone, with no investigation at all.",

  explain_feature:
    "Apollo's protections, by the names you'll see:\n\n" +
    "• **Websites & Links** — automatic website blocking plus manual link checks.\n" +
    "• **Messages & Calls** — message screening plus call and number risk checks.\n" +
    "• **Email & Accounts** — email monitoring plus account compromise checks.\n" +
    "• **Apps & Files** — app and file safety checks.\n" +
    "• **Device & Internet** — device settings plus network security monitoring.\n" +
    "• **Vision** — screenshot and photograph safety checks.\n\n" +
    "Each one is automatic wherever your phone genuinely allows it, and always available as a manual check where it doesn't. All protections shows you the real status of every one.",

  help_navigation:
    "Here's the whole app:\n\n" +
    "• **Home** — your protection status and anything needing attention.\n" +
    "• **Threats** — every threat Apollo found or you checked. Tap one for the full case and evidence.\n" +
    "• **Scam Alerts** — current campaigns from government and cyber-authority feeds.\n" +
    "• **Higgins** (here) — ask me anything; the + button submits something for a check.\n" +
    "• **Settings** — protections, alerts, accounts and family, your data, and the privacy statement.\n\n" +
    "**Check It** is the hub for every manual check: a message, a website link, a file, a number, a QR code, an email, an app, an account alert, your device or your internet.",

  explain_alert:
    "Apollo tells you how worried it is by how it behaves:\n\n" +
    "• **Patrolling** — nothing of concern in the checks that completed.\n" +
    "• **Sniffing** — noticed something, looking closer.\n" +
    "• **Growling** — a possible concern. Caution, or an investigation.\n" +
    "• **Barking** — a significant concern that needs your attention.\n" +
    "• **Biting** — a real block, confirmed by the device's own evidence.\n\n" +
    "Tap any threat to see the full case: what happened, the evidence, the original item exactly as it arrived, and what to do.",
};

/** Where each canned answer sensibly leads. */
const KNOWLEDGE_LINKS: Record<LocalKnowledgeIntent, NavLink[]> = {
  how_apollo_works: navLinks("/how-apollo-checks", "/gates"),
  what_is_higgins: navLinks("/higgins/learning"),
  what_is_magnum_di: navLinks("/how-apollo-checks", "/(tabs)/check-it"),
  explain_feature: navLinks("/gates"),
  help_navigation: navLinks("/(tabs)/check-it", "/(tabs)/settings"),
  explain_alert: navLinks("/(tabs)/patrol"),
};

export function knowledgeToHigginsMessage(intent: LocalKnowledgeIntent, conversationId: string): HigginsChatMessage {
  const content = KNOWLEDGE_RESPONSES[intent] ?? KNOWLEDGE_RESPONSES.how_apollo_works;
  return {
    id: Crypto.randomUUID(),
    turnId: Crypto.randomUUID(),
    role: "higgins",
    content,
    createdAt: new Date().toISOString(),
    conversationId,
    links: KNOWLEDGE_LINKS[intent] ?? KNOWLEDGE_LINKS.how_apollo_works,
  };
}

/** Build a clarification message when the intent is ambiguous. */
export function clarificationToHigginsMessage(question: string, conversationId: string): HigginsChatMessage {
  return {
    id: Crypto.randomUUID(),
    turnId: Crypto.randomUUID(),
    role: "higgins",
    content: question,
    createdAt: new Date().toISOString(),
    conversationId,
  };
}
