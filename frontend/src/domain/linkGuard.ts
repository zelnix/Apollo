// Email Guard / Text Guard shared link-risk helpers.
//
// Truth-of-State invariant (hard rule, carried over from Website Guard): everything in this file
// may only ever suggest raising state to "growling" or "barking" — it must NEVER produce "biting".
// Biting stays reserved for verified native block evidence elsewhere in the app. Enforced here by
// construction: escalate() below only ever receives the literals "growling" or "barking".
import { STATE_RANK } from "@/src/domain/stateMachine";
import type { ApolloState } from "@/src/domain/types";

export interface LinkAnchor { text: string; href: string }

export interface UrlGuardResult {
  url: string;
  host: string;
  verdict: "clean" | "malicious" | "unknown";
  redirect_chain?: string[];
  final_url?: string | null;
  domain_info?: { newly_registered?: boolean; age_days?: number | null; registrar?: string | null; available?: boolean } | null;
}

export interface LinkMismatch { claimedHost: string; realHost: string }

function hostOf(url: string): string | null {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

// A domain-shaped token inside a link's visible text (e.g. "paypal.com", "www.commbank.com.au").
const DOMAIN_IN_TEXT = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,}[a-z]{2,24})\b/i;

export function claimedHostFromText(text: string): string | null {
  const m = text.match(DOMAIN_IN_TEXT);
  if (!m) return null;
  return m[1].toLowerCase().replace(/^www\./, "");
}

/** The classic phishing pattern: link text says one domain, href goes to another. */
export function detectAnchorMismatch(anchor: LinkAnchor): LinkMismatch | null {
  const claimed = claimedHostFromText(anchor.text);
  if (!claimed) return null;
  const real = hostOf(anchor.href);
  if (!real || claimed === real || real.endsWith(`.${claimed}`) || claimed.endsWith(`.${real}`)) return null;
  return { claimedHost: claimed, realHost: real };
}

// Best-effort recovery of (display, href) pairs from PLAIN pasted text. Most pasted emails/SMS lose
// the HTML anchor structure entirely (paste is just text) — this only catches the minority of
// forwarded messages that happen to preserve a "text (url)" or markdown-style "[text](url)" pattern.
const MARKDOWN_LINK = /\[([^\]]{2,80})\]\((https?:\/\/[^\s)]+)\)/g;
const TEXT_PAREN_LINK = /([a-z0-9][\w.-]{1,60}\.[a-z]{2,24})\s*[<(]\s*(https?:\/\/[^\s)>]+)\s*[)>]/gi;

export function extractAnchorsFromPlainText(text: string): LinkAnchor[] {
  const anchors: LinkAnchor[] = [];
  for (const re of [MARKDOWN_LINK, TEXT_PAREN_LINK]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while (anchors.length < 20 && (m = re.exec(text))) anchors.push({ text: m[1], href: m[2] });
  }
  return anchors;
}

function escalate(state: ApolloState, to: "growling" | "barking"): ApolloState {
  return STATE_RANK[to] > STATE_RANK[state] ? to : state;
}

/** Runs the automatic pre-click assessment over a message/email's checked links + any recovered
 * anchor pairs, producing a state floor and specific, human why-lines — never a generic red banner. */
export function evaluateLinkGuardFindings(urls: UrlGuardResult[], anchors: LinkAnchor[] = []): { state: ApolloState; why: string[] } {
  let state: ApolloState = "resting";
  const why: string[] = [];

  for (const u of urls) {
    if (u.verdict === "malicious") {
      state = escalate(state, "barking");
      const hops = u.redirect_chain?.length ?? 0;
      why.push(hops > 1
        ? `This link redirects through ${hops} domains and ends at a known malicious host (${u.host}).`
        : `${u.host} is a known malicious destination — Apollo's threat intelligence confirms it.`);
    } else if ((u.redirect_chain?.length ?? 0) > 2) {
      state = escalate(state, "growling");
      why.push(`This link redirects through ${u.redirect_chain!.length} different domains before it lands on ${u.host}.`);
    }
    if (u.domain_info?.newly_registered) {
      state = escalate(state, "growling");
      const age = u.domain_info.age_days ?? 0;
      why.push(`${u.host} was only registered ${age} day${age === 1 ? "" : "s"} ago — a common pattern for scam sites.`);
    }
  }

  for (const a of anchors) {
    const mismatch = detectAnchorMismatch(a);
    if (mismatch) {
      state = escalate(state, "barking");
      why.push(`Displayed link says "${mismatch.claimedHost}", but it actually goes to ${mismatch.realHost}.`);
    }
  }

  return { state, why };
}
