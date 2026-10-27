// Email evidence — Higgins Triage's classification of the email evidence it received (L1–L4), what each level
// let ApolloSG examine, and the investigation signals the headers raised.
//
//   L1 Visual/Text        a screenshot or pasted text
//   L2 Shared Email       shared from another app, without full headers
//   L3 Original Message   the original message with its full headers (.eml file or pasted original source)
//   L4 Provider-Verified  the original, retrieved by ApolloSG itself through the connected email account
//
// Authentication is reported exactly as the RECEIVING mail server recorded it and credited to that server.
// ApolloSG never re-checks SPF, DKIM or DMARC. Signals are things to weigh, never proof of fraud on their own.
// `emailFindings` is the only part that may leave the phone: domains, results, counts and fingerprints — no
// subject, body, names or header text. Pure, no Expo imports.

import type { EmailAnalysis } from "../emailAnalysis.ts";
import { sameOrg, type AuthEntry, type EmailTechnical, type ParsedOriginal } from "./emailOriginal.ts";
import { capability, fill, mergeProfiles, newProfile, typeWords, upgrades, type CapabilityRow, type EvidenceProfile, type EvidenceSignal } from "./evidenceProfile.ts";

export type EmailVia = "pasted" | "screenshot" | "shared" | "eml_file" | "raw_source" | "connected_mailbox" | "simulated";
export type EmailLevel = "L1" | "L2" | "L3" | "L4";

export interface EmailAuthSummary {
  /** The authserv-id of the topmost Authentication-Results header ("unknown" when the server wrote none). */
  recordedBy: string;
  /** That server is one of the servers that delivered the email. */
  receiverConfirmed: boolean;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  arc: string | null;
  spfDomain: string | null;
  dkimDomains: string[];
  dmarcDomain: string | null;
}

export interface EmailFacts {
  fromDomain: string | null;
  replyToDomains: string[];
  returnPathDomain: string | null;
  messageIdDomain: string | null;
  receivedHops: number;
  headerCount: number;
  mimeType: string | null;
  partCount: number;
  attachments: { name: string; type: string; size: number; sha256: string | null }[];
  linkDomains: string[];
}

export interface EmailEvidenceProfile extends EvidenceProfile {
  type: "email";
  auth: EmailAuthSummary | null;
  facts: EmailFacts;
}

const WORDS = typeWords("email") as ReturnType<typeof typeWords> & {
  authRecorded: string; authUnconfirmed: string; authNotRecorded: string; authNeedsOriginal: string;
  upgrade: string; upgradeMismatch: string; signals: Record<string, string>;
};
export const EMAIL_WORDS = WORDS;

const FAILED = new Set(["fail", "softfail", "permerror", "hardfail"]);
const domainOf = (value: string | null | undefined): string | null =>
  value ? value.replace(/^.*@/, "").replace(/[>\s].*$/, "").toLowerCase() || null : null;

/** Which level the evidence is. An "original" without delivery headers (a draft, an export that dropped them) is
 *  not an original message — it can tell ApolloSG no more than a shared copy. */
export function emailLevelFor(via: EmailVia, fullHeaders: boolean): EmailLevel {
  if (via === "connected_mailbox") return fullHeaders ? "L4" : "L2";
  if (via === "eml_file" || via === "raw_source") return fullHeaders ? "L3" : "L2";
  if (via === "simulated") return fullHeaders ? "L3" : "L1";
  if (via === "shared") return "L2";
  return "L1";
}

/** The headline result of one method as recorded: pass wins when any signature passed (DKIM), else the first. */
function result(entries: AuthEntry[]): string | null {
  if (!entries.length) return null;
  return entries.find((e) => e.result === "pass")?.result ?? entries[0].result;
}

export function emailAuthSummary(t: EmailTechnical): EmailAuthSummary | null {
  const auth = t.recordedAuth;
  if (!auth || ![auth.spf, auth.dkim, auth.dmarc].some((m) => m.length)) return null;
  return {
    recordedBy: auth.authservId,
    receiverConfirmed: t.recordedAuthConfirmed,
    spf: result(auth.spf), dkim: result(auth.dkim), dmarc: result(auth.dmarc),
    arc: result(auth.arc) ?? (t.arc.sets ? t.arc.cv : null),
    spfDomain: domainOf(auth.spf[0]?.props["smtp.mailfrom"] ?? auth.spf[0]?.props["smtp.helo"]),
    dkimDomains: [...new Set(auth.dkim.filter((e) => e.result === "pass").map((e) => domainOf(e.props["header.d"] ?? e.props["header.i"])).filter((d): d is string => !!d))],
    dmarcDomain: domainOf(auth.dmarc[0]?.props["header.from"]),
  };
}

function attribution(auth: EmailAuthSummary): string {
  return fill(auth.receiverConfirmed ? WORDS.authRecorded : WORDS.authUnconfirmed, { server: auth.recordedBy === "unknown" ? "a mail server that didn't name itself" : auth.recordedBy });
}

function authRow(id: "spf" | "dkim" | "dmarc" | "arc", auth: EmailAuthSummary | null, haveOriginal: boolean): CapabilityRow {
  if (!haveOriginal) return capability("email", id, "unavailable", null, WORDS.authNeedsOriginal);
  const value = auth?.[id] ?? null;
  if (!auth || !value) return capability("email", id, "unavailable", null, WORDS.authNotRecorded);
  const domain = id === "spf" ? auth.spfDomain : id === "dkim" ? auth.dkimDomains.join(", ") || null : id === "dmarc" ? auth.dmarcDomain : null;
  return capability("email", id, "recorded", `${value}${domain ? ` (${domain})` : ""}`, attribution(auth));
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
}

function signalsFor(t: EmailTechnical | null, auth: EmailAuthSummary | null, analysis: EmailAnalysis): EvidenceSignal[] {
  const out: EvidenceSignal[] = [];
  const add = (id: string, vars: Record<string, string | null | undefined>) => out.push({ id, text: fill(WORDS.signals[id], vars) });
  const from = t?.from?.domain ?? analysis.senderDomain;
  const replyDomains = t ? t.replyTo.map((r) => r.domain).filter((d): d is string => !!d) : analysis.replyToDomain ? [analysis.replyToDomain] : [];
  const differing = replyDomains.find((d) => from && !sameOrg(d, from));
  if (differing) add("reply_to_differs", { replyTo: differing, from });
  if (!t) return out;

  const returnPath = domainOf(t.returnPath);
  if (returnPath && from && !sameOrg(returnPath, from)) add("return_path_differs", { returnPath, from });
  if (auth) {
    if (auth.spf && FAILED.has(auth.spf)) add("spf_failed", { result: auth.spf, domain: auth.spfDomain ?? from ?? "the sender" });
    if (auth.dkim && FAILED.has(auth.dkim)) add("dkim_failed", { result: auth.dkim });
    if (auth.dmarc && FAILED.has(auth.dmarc)) add("dmarc_failed", { result: auth.dmarc, from: from ?? "the sender" });
    const aligned = auth.dkimDomains.some((d) => from && sameOrg(d, from));
    if (auth.dkim === "pass" && auth.dkimDomains.length && from && !aligned) add("dkim_unaligned", { domain: auth.dkimDomains[0], from });
    if (!auth.receiverConfirmed) add("recorder_unconfirmed", { server: auth.recordedBy === "unknown" ? "a mail server that didn't name itself" : auth.recordedBy });
  } else if (t.received.length) {
    add("no_auth_recorded", {});
  }
  const shown = /[^\s<>"(),]+@[^\s<>"(),]+/.exec(t.from?.name ?? "")?.[0];
  if (shown && from && !sameOrg(domainOf(shown), from)) add("display_name_address", { shown, from: t.from?.address ?? from });
  const messageIdDomain = domainOf(t.messageId);
  if (messageIdDomain && from && !sameOrg(messageIdDomain, from) && auth?.dmarc !== "pass") add("message_id_differs", { domain: messageIdDomain, from });
  return out;
}

function capabilitiesFor(level: EmailLevel, via: EmailVia, t: EmailTechnical | null, auth: EmailAuthSummary | null, analysis: EmailAnalysis,
  original: ParsedOriginal | null): CapabilityRow[] {
  const full = !!t && (level === "L3" || level === "L4");
  const rows: CapabilityRow[] = [];
  rows.push(original
    ? capability("email", "original_message", level === "L4" ? "verified" : "observed", `${kb(original.byteLength)} · SHA-256 ${original.sha256.slice(0, 16)}…`,
      level === "L4" ? "ApolloSG retrieved it itself from your connected email account." : "The original you gave ApolloSG, fingerprinted and kept on this phone.")
    : capability("email", "original_message", "unavailable", null, "ApolloSG didn't receive the original message."));
  rows.push(level === "L4"
    ? capability("email", "provider_provenance", "verified", "Your connected email account", "ApolloSG fetched it from the mailbox, so it's the message as your provider holds it.")
    : capability("email", "provider_provenance", "unavailable", null, via === "connected_mailbox" ? "Your mailbox didn't return the original message." : "Only available when ApolloSG fetches the email from your connected account."));
  rows.push(full ? capability("email", "full_headers", "observed", `${t!.headerCount} header fields`) : capability("email", "full_headers", "unavailable", null, WORDS.authNeedsOriginal));

  const fromValue = t?.from ? [t.from.name, t.from.address ? `<${t.from.address}>` : null].filter(Boolean).join(" ") : analysis.parsed.fromAddress;
  rows.push(fromValue
    ? capability("email", "sender_address", "observed", fromValue, "The From line can be written by whoever sends the email; sender authentication shows whether its domain is genuine.")
    : capability("email", "sender_address", "unavailable", null, "No sender address in what ApolloSG received."));
  if (t) rows.push(capability("email", "reply_to", "observed", t.replyTo.length ? t.replyTo.map((r) => r.address ?? r.name).join(", ") : "Not set"));
  else rows.push(analysis.parsed.replyTo ? capability("email", "reply_to", "observed", analysis.parsed.replyTo) : capability("email", "reply_to", "unavailable", null, "Not visible in what ApolloSG received."));
  rows.push(full && t!.returnPath ? capability("email", "return_path", "recorded", t!.returnPath, "Written by the server that delivered the email.") : capability("email", "return_path", "unavailable", null, full ? "Not present in the headers." : WORDS.authNeedsOriginal));
  rows.push(full && t!.messageId ? capability("email", "message_id", "observed", t!.messageId) : capability("email", "message_id", "unavailable", null, full ? "Not present in the headers." : WORDS.authNeedsOriginal));
  rows.push(full && t!.received.length
    ? capability("email", "received_chain", "recorded", `${t!.received.length} server${t!.received.length === 1 ? "" : "s"}; delivered by ${t!.received[0].by ?? "an unnamed server"}`, "Each step is recorded by the server that handled it.")
    : capability("email", "received_chain", "unavailable", null, full ? "No routing headers present." : WORDS.authNeedsOriginal));
  for (const id of ["spf", "dkim", "dmarc", "arc"] as const) rows.push(authRow(id, auth, full));
  rows.push(full ? capability("email", "mime", "observed", `${t!.mime.type}, ${t!.mime.partCount} part${t!.mime.partCount === 1 ? "" : "s"}`) : capability("email", "mime", "unavailable", null, WORDS.authNeedsOriginal));
  if (full) {
    rows.push(capability("email", "attachments", "observed", t!.attachments.length
      ? t!.attachments.map((a) => `${a.name} (${a.type}, ${kb(a.size)}${a.sha256 ? `, SHA-256 ${a.sha256.slice(0, 12)}…` : ""})`).join("; ")
      : "None", t!.attachments.length ? "Read and fingerprinted on this phone." : null));
  } else {
    rows.push(analysis.parsed.attachments.length
      ? capability("email", "attachments", "observed", analysis.parsed.attachments.join(", "), "Names mentioned in the text only — the files themselves weren't received.")
      : capability("email", "attachments", "unavailable", null, "Not visible in what ApolloSG received."));
  }
  const links = t?.urls.length ?? analysis.urls.length;
  rows.push(capability("email", "links", "observed", links ? `${links} link${links === 1 ? "" : "s"}` : "None"));
  return rows;
}

/** Higgins Triage's classification of the email evidence it was given. */
export function buildEmailProfile(args: {
  via: EmailVia; analysis: EmailAnalysis; original?: ParsedOriginal | null; keptOnDevice?: boolean; at?: string;
}): EmailEvidenceProfile {
  const original = args.original ?? null;
  const level = emailLevelFor(args.via, !!original?.fullHeaders);
  const t = original?.technical ?? null;
  const auth = t && (level === "L3" || level === "L4") ? emailAuthSummary(t) : null;
  const base = newProfile({
    type: "email", level, via: args.via, at: args.at,
    capabilities: capabilitiesFor(level, args.via, t, auth, args.analysis, original),
    signals: signalsFor(t && (level === "L3" || level === "L4") ? t : null, auth, args.analysis),
    original: original ? { sha256: original.sha256, bytes: original.byteLength, keptOnDevice: !!args.keptOnDevice } : null,
  });
  const facts: EmailFacts = {
    fromDomain: t?.from?.domain ?? args.analysis.senderDomain,
    replyToDomains: t ? [...new Set(t.replyTo.map((r) => r.domain).filter((d): d is string => !!d))] : args.analysis.replyToDomain ? [args.analysis.replyToDomain] : [],
    returnPathDomain: domainOf(t?.returnPath), messageIdDomain: domainOf(t?.messageId),
    receivedHops: t?.received.length ?? 0, headerCount: t?.headerCount ?? 0,
    mimeType: t?.mime.type ?? null, partCount: t?.mime.partCount ?? 0,
    attachments: t ? t.attachments.map((a) => ({ name: a.name, type: a.type, size: a.size, sha256: a.sha256 })) : [],
    linkDomains: t ? t.domains.filter((d) => t.urls.some((u) => u.toLowerCase().includes(d))).slice(0, 20) : [...new Set(args.analysis.urls.map((u) => u.replace(/^https?:\/\//i, "").split(/[/?#:]/)[0].toLowerCase()))].slice(0, 20),
  };
  return { ...base, type: "email", auth, facts };
}

export function mergeEmailProfiles(previous: EmailEvidenceProfile | null | undefined, next: EmailEvidenceProfile): EmailEvidenceProfile {
  return mergeProfiles(previous, next) as EmailEvidenceProfile;
}

/** "Evidence upgraded from L1 — Visual/Text to L3 — Original Message. …" for the latest upgrade, if any. */
export function upgradeSentence(profile: EvidenceProfile | null | undefined): string | null {
  const last = upgrades(profile).pop();
  return last ? fill(WORDS.upgrade, { from: last.from.label, to: last.to.label }) : null;
}

/** The ONLY part of an email profile that may leave the phone: levels, statuses, domains, recorded results,
 *  counts and fingerprints. Never the subject, body, display names, addresses, header text or the file. */
export function emailFindings(profile: EmailEvidenceProfile): Record<string, unknown> {
  const ext = (name: string) => { const m = /\.([a-z0-9]{1,10})$/i.exec(name); return m ? m[1].toLowerCase() : null; };
  return {
    type: "email", level: profile.level, via: profile.via,
    capabilities: Object.fromEntries(profile.capabilities.map((c) => [c.id, c.status])),
    auth: profile.auth ? {
      recorded_by: profile.auth.recordedBy.toLowerCase(), receiver_confirmed: profile.auth.receiverConfirmed,
      spf: profile.auth.spf, dkim: profile.auth.dkim, dmarc: profile.auth.dmarc, arc: profile.auth.arc,
    } : null,
    from_domain: profile.facts.fromDomain, reply_to_domains: profile.facts.replyToDomains.slice(0, 5),
    return_path_domain: profile.facts.returnPathDomain, message_id_domain: profile.facts.messageIdDomain,
    dkim_domains: (profile.auth?.dkimDomains ?? []).slice(0, 5),
    received_hops: profile.facts.receivedHops, header_count: profile.facts.headerCount,
    attachments: profile.facts.attachments.slice(0, 20).map((a) => ({ type: a.type.slice(0, 100), size: a.size, sha256: a.sha256, ext: ext(a.name) })),
    signals: profile.signals.map((s) => s.id),
    original_sha256: profile.original?.sha256 ?? null, original_bytes: profile.original?.bytes ?? null,
    observed_at: profile.at,
  };
}

/** Same email? Used before upgrading a case's evidence, so an unrelated .eml never rewrites another case. */
export function sameEmail(previous: { sender?: string | null; subject?: string | null; text?: string | null }, next: { sender: string | null; subject: string | null; text: string }): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/^(\s*(re|fwd?|fw)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();
  const address = (s: string | null | undefined) => /[^\s<>"(),]+@[^\s<>"(),]+/.exec(s ?? "")?.[0]?.toLowerCase() ?? null;
  if (norm(previous.subject) && norm(previous.subject) === norm(next.subject)) return true;
  const a = address(previous.sender), b = address(next.sender);
  const prevText = norm(previous.text).replace(/[^a-z0-9 ]/g, ""), nextText = norm(next.text).replace(/[^a-z0-9 ]/g, "");
  const snippet = prevText.split(" ").slice(0, 12).join(" ");
  const bodyMatch = snippet.length >= 20 && nextText.includes(snippet);
  if (a && b) return a === b || bodyMatch;
  return bodyMatch;
}
