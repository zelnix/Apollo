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
import * as Crypto from "expo-crypto";

// ── Turn diagnostic results into Higgins messages ────────────────────────────

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
  };
}

// ── Local knowledge responses ────────────────────────────────────────────────

const KNOWLEDGE_RESPONSES: Record<LocalKnowledgeIntent, string> = {
  how_apollo_works:
    "Apollo is your scam protection system. It works in three parts:\n\n" +
    "• **Apollo** observes and detects threats automatically — monitoring websites, calls, messages, and apps.\n" +
    "• **Magnum DI** investigates when deeper analysis is needed — examining evidence, checking reputation databases, and analysing content.\n" +
    "• **Higgins** (that's me) communicates findings to you in plain English and helps you decide what to do.\n\n" +
    "Apollo runs on your device. Your personal data stays local. Only sanitised evidence is sent for investigation when needed.",

  what_is_higgins:
    "I'm Higgins — Apollo's trusted adviser, interpreter and guide.\n\n" +
    "I explain what Apollo has found, interpret security alerts, answer your cyber-safety questions, and guide you through what to do next.\n\n" +
    "When you ask me to check something specific — a phone number, link, message or email — I'll send it through Magnum DI for a full investigation and present the results.",

  what_is_magnum_di:
    "Magnum DI is Apollo's investigation engine.\n\n" +
    "When you submit something suspicious — a screenshot, URL, message, email, or phone number — Magnum DI analyses it using reputation databases, AI analysis, and other intelligence sources.\n\n" +
    "Magnum DI only runs when investigation is actually needed. Device status questions like \"Am I protected?\" are answered locally by Apollo without Magnum DI.",

  explain_feature:
    "Apollo has several protection features:\n\n" +
    "• **Site Gate** — blocks malicious websites using DNS filtering via a local VPN.\n" +
    "• **Call Gate** — checks phone numbers against fraud databases.\n" +
    "• **Text Gate** — monitors messages for scam indicators.\n" +
    "• **App Gate** — reviews app permissions and behaviours.\n\n" +
    "Each gate can run automatically or be used on-demand. Check the Protection tab to see what's active.",

  help_navigation:
    "Here's how to find things in Apollo:\n\n" +
    "• **Home** — overview of your protection status and recent activity.\n" +
    "• **Check** — run manual checks on numbers, links, messages, and more.\n" +
    "• **Protection** — see and manage your active protections.\n" +
    "• **Ask Higgins** (here) — ask me anything or submit something for investigation.\n" +
    "• **Settings** — manage your personal data, privacy, and preferences.",

  explain_alert:
    "When Apollo detects something concerning, it shows an alert with a colour-coded severity:\n\n" +
    "• **Red (Barking)** — high risk. Apollo strongly recommends you avoid this.\n" +
    "• **Amber (Growling)** — some risk detected. Review carefully before proceeding.\n" +
    "• **Green (Resting)** — no strong risk signal detected. This doesn't guarantee safety.\n\n" +
    "Tap any alert to see the full investigation details, evidence, and what to do next.",
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
