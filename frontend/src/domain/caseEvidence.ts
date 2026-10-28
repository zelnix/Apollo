// The Threat Case Evidence tab, built from the case's own records only:
//   Evidence summary → Evidence from this device → Investigation findings → Evidence trail.
// Source evidence (what this device captured or you submitted) is kept apart from what TC FlyBy and Magnum DI found,
// and the device, TC FlyBy and Magnum DI are never listed as equivalent sources. Each piece carries one status:
//   Verified    — only when the underlying record itself establishes it: a reading this device recorded directly, a
//                 block with an observed packet drop, an email ApolloSG retrieved itself from the connected account,
//                 or a finding observed in the evidence and confirmed by an official source about this case.
//   Supporting  — read in full / observed in the evidence and relied on, but not independently verified.
//   Unconfirmed — inferred, reported, low confidence, not read in full, simulated, or relied on by no finding.
// A finding that points the other way is shown but never counted as support. Findings keep the words of the case
// result (caseBriefing.caseFindings) — Higgins Luddish may say them more simply elsewhere, never differently.
// Pure: no React Native, unit-tested in node.
import type { DeviceInvestigation } from "../investigation/deviceStore";
import type { EvidenceItem, SourceReference } from "../investigation/types";
import { caseFindings, type CaseFinding } from "./caseBriefing.ts";
import { raisedBy, type RaisedFrom } from "./caseHistory.ts";
import { caseShortfalls, completenessLabel, evidenceSourceLabel, hasRecordedFindings, privacyNote, shortfallLine, unrecordedShortfall } from "./caseFacts.ts";
import type { DiTrace, DiTransaction } from "./diTransaction.ts";
import { evidenceModel } from "./evidenceModel.ts";
import { investigatorName, looksLikeInternalCode, settledByFlyby } from "./messageVoice.ts";
import { formatDateTime } from "./threatCase.ts";
import { plainTriageText } from "./triage/contract.ts";
import type { PatrolEvent } from "./types";

export type EvidenceStatus = "verified" | "supporting" | "unconfirmed";
export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = { verified: "Verified", supporting: "Supporting", unconfirmed: "Unconfirmed" };

export type DeviceKind = "message" | "email" | "link" | "call" | "file" | "image" | "app" | "wifi" | "device" | "block";

/** One piece of evidence captured on this device, or submitted from it. */
export interface DevicePiece {
  id: string;
  kind: DeviceKind;
  name: string;
  description: string;
  status: EvidenceStatus;
  /** Why it has that status, in one plain sentence from the record. */
  why: string;
  source: string;
  at: string | null;
  /** The investigation's evidence IDs this piece stands for (findings cite these). */
  evidenceIds: string[];
  /** The item the case is about: its full original opens from here. */
  primary: boolean;
  /** Recorded details shown when the piece is opened. */
  details: { label: string; value: string }[];
}

/** One finding TC FlyBy or Magnum DI recorded. */
export interface FindingPiece {
  id: string;
  by: "TC FlyBy" | "Magnum DI";
  text: string;
  /** Null when it points the other way: shown, never counted as support. */
  status: EvidenceStatus | null;
  why: string;
  /** The evidence it rests on, by name ("SMS you submitted (above)"). */
  basedOn: string[];
  at: string | null;
  basis: string;
  confidence: string | null;
  /** The related history that raised its confidence, in its own words (context, never evidence). */
  raisedBy: { from: RaisedFrom; text: string }[];
  sources: { title: string; url: string; authority: string }[];
}

export interface TrailStage {
  id: "triage" | "flyby" | "magnum";
  name: string;
  /** "Completed", "Escalated to Magnum DI", "Didn't finish", "In progress"… as recorded. */
  status: string;
  tone: "done" | "escalated" | "failed" | "pending";
  at: string | null;
}

export interface CaseEvidence {
  device: DevicePiece[];
  findings: FindingPiece[];
  trail: TrailStage[];
  counts: Record<EvidenceStatus, number>;
  total: number;
  /** "Collected from this device and the investigation." */
  collectedFrom: string;
}

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cap = (v: string) => (v ? `${v[0].toUpperCase()}${v.slice(1)}` : v);

// ── Evidence from this device ────────────────────────────────────────────────

const SUBMITTED_NOUN: Record<string, string> = { email: "Email", call: "Call details", file: "File", app: "App details" };

function submittedKind(item: EvidenceItem, category: string): DeviceKind {
  if (item.kind === "url") return "link";
  if (item.kind === "image") return "image";
  if (item.kind === "document" || item.kind === "attachment" || item.kind === "audio") return "file";
  return category === "email" ? "email" : category === "call" ? "call" : category === "app" ? "app" : category === "file" ? "file" : "message";
}

function fullyRead(item: EvidenceItem): boolean {
  const c = item.coverage as EvidenceItem["coverage"] & { permanentGap?: boolean };
  return item.availability === "available" && c?.status === "examined" && !c.materialGap && !c.permanentGap;
}

const reading = (label: string) => clean(label.replace(/^observation:\s*/i, "").replace(/[._]+/g, " "));

function itemPiece(item: EvidenceItem, event: PatrolEvent, cited: Set<string>, primary: boolean): DevicePiece {
  const observation = item.origin === "device_observation";
  const simulated = !!item.simulation;
  const read = fullyRead(item);
  const relied = cited.has(item.id);
  const kind: DeviceKind = observation ? (/wi-?fi|ssid|network/i.test(item.label) ? "wifi" : "device") : submittedKind(item, event.category);
  const unit = item.coverage?.unit === "characters" ? "characters" : item.coverage?.unit ?? "items";
  const total = item.coverage?.total;

  let status: EvidenceStatus;
  let why: string;
  if (simulated) { status = "unconfirmed"; why = "A preview sample, not a real reading from this device."; }
  else if (!read) { status = "unconfirmed"; why = `Not read in full${item.coverage?.reason ? `: ${clean(item.coverage.reason).replace(/_/g, " ")}` : ""}.`; }
  else if (observation) { status = "verified"; why = "Recorded directly by this device."; }
  else if (relied) { status = "supporting"; why = "Read in full and relied on by the findings. Apollo can't verify who sent it."; }
  else { status = "unconfirmed"; why = "No finding relies on it."; }

  const noun = SUBMITTED_NOUN[event.category] ?? (kind === "link" ? "Link" : kind === "image" ? "Picture" : kind === "file" ? "File" : "Message");
  // A link taken out of something you submitted is named by where it came from, never as something you sent on its own.
  const inside = !!item.parentId;
  const name = observation ? `${cap(reading(item.label)) || "Device"} record`
    : kind === "link" ? (inside ? `Link in the ${(SUBMITTED_NOUN[event.category] ?? "message").toLowerCase()}` : "Link you submitted")
      : `${kind === "image" ? "Picture" : noun} you submitted`;
  const description = observation
    ? `This device recorded ${reading(item.label) || "this reading"} directly when Apollo asked.`
    : kind === "link" ? (inside ? `A link found in the ${(SUBMITTED_NOUN[event.category] ?? "message").toLowerCase()} you sent Apollo to check.` : "The link you sent Apollo to check.")
      : kind === "image" ? "The picture you sent. Apollo checked the copy with any codes blacked out."
        : `The ${noun.toLowerCase()} you sent Apollo to check${total ? ` — ${total} ${unit}${read ? ", read in full" : ""}` : ""}.`;
  const source = observation ? "This device"
    : evidenceModel(event).source === "connected_mailbox" ? evidenceSourceLabel(event) : "You, from this device";
  return {
    id: `item:${item.id}`, kind, name, description, status, why, source, at: item.collectedAt ?? event.occurred_at,
    evidenceIds: [item.id], primary,
    details: [
      { label: "Evidence ID", value: item.displayId || item.id.slice(0, 8) },
      ...(total != null ? [{ label: "Read", value: `${item.coverage.examined} of ${total} ${unit}` }] : []),
      ...(item.transformations?.length ? [{ label: "Privacy", value: item.transformations.map((t) => t.description).join("; ") }] : []),
    ],
  };
}

const NOUN: Record<string, string> = { email: "Email", message: "Message", call: "Call", link: "Link", website: "Website", known_threat: "Website",
  protection: "Website", file: "File", app: "App", account: "Account", connection: "Connection", network: "Connection", system: "Device", device: "Device" };
const DEVICE_READINGS = new Set(["device", "network", "connection", "system"]);

function eventKind(e: PatrolEvent): DeviceKind {
  switch (e.category) {
    case "email": return "email";
    case "call": return "call";
    case "file": return "file";
    case "app": return "app";
    case "link": case "website": case "known_threat": case "protection": return "link";
    case "message": return "message";
    default: return "device";
  }
}

/** The case's own item, for a case no investigation answered (Higgins Triage, or Apollo's own detection). */
function eventPiece(e: PatrolEvent, facts: string[]): DevicePiece {
  const model = evidenceModel(e);
  const profile = e.evidence_profile;
  const simulated = !!(profile?.simulated || e.investigation_simulated);
  const full = model.representation === "full_record" && model.completeness !== "partial";
  const submitted = e.origin === "user" || model.source === "device_submission";
  const ownReading = !submitted && (model.source === "dns_observation" || (model.source === "local_device" && DEVICE_READINGS.has(e.category)));
  const providerEmail = profile?.type === "email" && profile.rank >= 4;
  const recorded = hasRecordedFindings(e) && facts.length > 0;

  let status: EvidenceStatus;
  let why: string;
  if (simulated) { status = "unconfirmed"; why = "A preview sample, not a real reading from this device."; }
  else if (!full) { status = "unconfirmed"; why = model.completeness === "partial" ? "Part of this record wasn't kept." : "Only a summary of this check is kept, not what was checked."; }
  else if (ownReading) { status = "verified"; why = "Recorded directly by Apollo on this device."; }
  else if (providerEmail) { status = "verified"; why = "ApolloSG retrieved this email itself from your connected account."; }
  else if (recorded) { status = "supporting"; why = "Apollo recorded what it found in it. Apollo can't verify who sent it."; }
  else { status = "unconfirmed"; why = "No finding was recorded from it."; }

  const noun = NOUN[e.category] ?? "Item";
  const headline = clean(e.headline);
  const description = plainTriageText(clean(e.what_happened)) || (headline && !looksLikeInternalCode(headline) ? headline : `${noun} Apollo recorded.`);
  return {
    id: "event", kind: eventKind(e), name: submitted ? `${noun} you checked` : `${noun} Apollo detected`,
    description, status, why, source: submitted ? "You, from this device" : evidenceSourceLabel(e), at: e.occurred_at,
    evidenceIds: [], primary: true,
    details: profile ? [{ label: "Evidence level", value: profile.label }] : [],
  };
}

function blockPiece(e: PatrolEvent): DevicePiece | null {
  const ev = e.enforcement_evidence;
  if (!ev) return null;
  const proved = !!e.verified_block;
  const action = clean(ev.enforced_action.replace(/_/g, " "));
  return {
    id: "block", kind: "block", name: "Block record",
    description: `Apollo ${action || "acted"}${ev.destination_domain ? ` on ${ev.destination_domain}` : ""} — ${clean(ev.result.replace(/_/g, " "))}.`,
    status: proved ? "verified" : "unconfirmed",
    why: proved ? "This device observed the blocked connection and matched it to this case." : "The record doesn't contain a packet drop Apollo observed and matched to this event.",
    source: "This device", at: ev.observed_at, evidenceIds: [], primary: false,
    details: [
      { label: "Mechanism", value: clean(ev.mechanism.replace(/_/g, " ")) },
      { label: "Confidence", value: ev.confidence },
    ],
  };
}

// ── Investigation findings ───────────────────────────────────────────────────

/** What the case's record says about its item, as detail rows: what was recorded about it (sender, subject, address,
 *  links), how complete the record is, the privacy step, unfinished checks and the guidance Apollo linked. */
function recordDetails(e: PatrolEvent): { label: string; value: string }[] {
  const m = e.source_metadata;
  const rows: { label: string; value: string }[] = [];
  if (clean(m?.sender)) rows.push({ label: "From", value: clean(m?.sender) });
  if (clean(m?.subject)) rows.push({ label: "Subject", value: clean(m?.subject) });
  if (m?.received_at) rows.push({ label: "Received", value: formatDateTime(m.received_at) });
  const address = clean(m?.url ?? e.local_indicator ?? e.indicator_host);
  if (address) rows.push({ label: "Address", value: address });
  if (m?.link_count != null) rows.push({ label: "Links found", value: String(m.link_count) });
  rows.push({ label: "Record", value: completenessLabel(e) });
  const privacy = privacyNote(e);
  if (privacy) rows.push({ label: "Privacy", value: privacy });
  for (const row of [...caseShortfalls(e), ...[unrecordedShortfall(e)].filter((r): r is NonNullable<typeof r> => !!r)]) {
    rows.push({ label: "Not checked", value: shortfallLine(row) });
  }
  for (const ref of e.supporting_references ?? []) rows.push({ label: "Guidance", value: `${ref.label} — ${ref.url}` });
  return rows;
}

/** A source counts as confirming only when it is an official source that was actually read — never ApolloSG's
 *  Knowledge Base or any other general knowledge, which is background, not evidence about this case. */
function confirming(ref: SourceReference): boolean {
  return ref.authority === "official" && ref.retrieval === "fetched" && !/general knowledge|not evidence about this case/i.test(ref.authorityBasis ?? "");
}

const BASIS_WORDS: Record<string, string> = {
  observation: "Seen in the evidence", observed: "Seen in the evidence",
  inference: "Worked out from the evidence", inferred: "Worked out from the evidence",
  user_report: "What you told Apollo", reported: "What you told Apollo",
};

function findingStatus(f: CaseFinding, refs: SourceReference[]): { status: EvidenceStatus | null; why: string } {
  if (f.stance === "contrary") return { status: null, why: "Points the other way, so it isn't counted as support." };
  const observed = f.basis === "observation" || f.basis === "observed";
  const confirm = refs.find(confirming);
  if (observed && f.confidence === "high" && confirm) return { status: "verified", why: `Seen in the evidence and confirmed by ${clean(confirm.title) || "an official source"}.` };
  if (f.basis === "inference" || f.basis === "inferred") return { status: "unconfirmed", why: "Worked out from the evidence, not seen in it directly." };
  if (f.basis === "user_report" || f.basis === "reported") return { status: "unconfirmed", why: "Based on what you told Apollo, not checked independently." };
  if (f.confidence === "low") return { status: "unconfirmed", why: "Recorded with low confidence." };
  return { status: "supporting", why: `Seen in the evidence${f.confidence ? ` (${f.confidence} confidence)` : ""}. Not independently verified.` };
}

// ── Evidence trail ───────────────────────────────────────────────────────────

/** Only the stages that actually happened, each with what it recorded. */
export function evidenceTrail(input: { event: PatrolEvent; trace: DiTrace | null; records: DiTransaction[] }): TrailStage[] {
  const { event, trace, records } = input;
  const out: TrailStage[] = [];
  const triage = trace?.triage ?? event.triage_investigation ?? null;
  const flyby = trace?.flyby ?? null;
  const hasCase = !!(event.investigation_case_id ?? event.patrol_record?.investigationCaseId);
  if (triage || flyby) out.push({ id: "triage", name: "Higgins Triage", status: "Completed", tone: "done", at: triage?.evaluatedAt ?? flyby?.ranAt ?? null });
  if (flyby) {
    out.push({ id: "flyby", name: "TC FlyBy", status: flyby.resolved ? "Completed" : "Escalated to Magnum DI", tone: flyby.resolved ? "done" : "escalated", at: flyby.ranAt });
  } else if (hasCase && event.investigation_completed_at && settledByFlyby(event.investigation_answered_by)) {
    out.push({ id: "flyby", name: "TC FlyBy", status: "Completed", tone: "done", at: event.investigation_completed_at });
  }
  if (records.length) {
    const last = records[records.length - 1];
    const failed = !!last.failureCode || (last.status ?? "success") !== "success";
    out.push({ id: "magnum", name: "Magnum DI", status: failed ? "Didn't finish" : last.simulated ? "Completed (simulated)" : "Completed",
      tone: failed ? "failed" : "done", at: trace?.magnum?.at ?? last.occurredAt ?? null });
  } else if (trace?.magnum) {
    out.push({ id: "magnum", name: "Magnum DI", status: "Completed", tone: "done", at: trace.magnum.at });
  } else if (!flyby && hasCase && event.investigation_completed_at && event.investigation_answered_by && !settledByFlyby(event.investigation_answered_by)) {
    out.push({ id: "magnum", name: "Magnum DI", status: "Completed", tone: "done", at: event.investigation_completed_at });
  }
  if (hasCase && !event.investigation_completed_at && !out.some((s) => s.id !== "triage")) {
    out.push({ id: "flyby", name: "TC FlyBy", status: "In progress", tone: "pending", at: null });
  }
  return out;
}

// ── The whole tab ────────────────────────────────────────────────────────────

export function caseEvidence(input: {
  event: PatrolEvent; investigation: DeviceInvestigation | null; trace: DiTrace | null; records: DiTransaction[];
  /** What Higgins Triage / Apollo recorded about the item (its met rules' evidence and recorded details). */
  facts: string[];
}): CaseEvidence {
  const { event, investigation, trace, records, facts } = input;
  const response = investigation?.response ?? null;
  const found = response ? caseFindings(response) : [];
  const items = investigation?.evidenceItems ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));

  // What the findings rest on: each cited item, and the item a cited clue was taken from.
  const cited = new Set<string>();
  for (const f of found.filter((x) => x.stance !== "contrary")) {
    for (const id of f.evidenceIds) {
      cited.add(id);
      const parent = byId.get(id)?.parentId;
      if (parent) cited.add(parent);
    }
  }

  const own = items.filter((i) => i.origin === "user_submission" || i.origin === "device_observation");
  const firstSubmitted = own.find((i) => i.origin === "user_submission" && !i.parentId) ?? own[0];
  const device: DevicePiece[] = own.length
    ? own.map((i) => itemPiece(i, event, cited, i === firstSubmitted))
    : [eventPiece(event, facts)];
  // The record's own facts about the item: what it holds, any privacy step, and every check that didn't finish with
  // its recorded reason — on the item, never as sources of their own.
  const primary = device.find((p) => p.primary);
  if (primary) primary.details.push(...recordDetails(event));
  const block = blockPiece(event);
  if (block) device.push(block);

  // Names for "Based on": device evidence is named as listed above; a clue by the item it came from.
  const pieceOf = new Map<string, DevicePiece>();
  for (const p of device) for (const id of p.evidenceIds) pieceOf.set(id, p);
  const by = investigatorName(investigation?.answeredBy);
  const nameOf = (id: string): string | null => {
    const direct = pieceOf.get(id);
    if (direct) return `${direct.name} (above)`;
    const item = byId.get(id);
    if (!item) return null;
    const parent = item.parentId ? pieceOf.get(item.parentId) : undefined;
    if (parent) return `${parent.name} (above)`;
    if (item.origin === "apollo_inference") return /fly-?by|checks/i.test(item.label) ? `${by}'s checks` : clean(item.label) || null;
    return clean(item.label) || null;
  };

  const refs = new Map((investigation?.sources ?? []).map((r) => [r.id, r]));
  const findings: FindingPiece[] = found.map((f) => {
    const cites = f.sourceIds.map((id) => refs.get(id)).filter((r): r is SourceReference => !!r);
    const { status, why } = findingStatus(f, cites);
    return {
      id: f.id, by, text: f.text, status, why,
      basedOn: [...new Set(f.evidenceIds.map(nameOf).filter((n): n is string => !!n))],
      at: investigation?.committedAt ?? investigation?.completedAt ?? null,
      basis: BASIS_WORDS[f.basis] ?? cap(f.basis.replace(/_/g, " ")), confidence: f.confidence,
      raisedBy: raisedBy(investigation?.response, f.id),
      sources: cites.map((r) => ({ title: clean(r.title) || r.url, url: r.url, authority: r.authority })),
    };
  });

  const counts: Record<EvidenceStatus, number> = { verified: 0, supporting: 0, unconfirmed: 0 };
  for (const p of device) counts[p.status] += 1;
  const counted = findings.filter((f) => f.status);
  for (const f of counted) counts[f.status!] += 1;
  const total = counts.verified + counts.supporting + counts.unconfirmed;
  const collectedFrom = device.length && counted.length ? "Collected from this device and the investigation."
    : device.length ? "Collected from this device." : "From the investigation.";

  return { device, findings, trail: evidenceTrail({ event, trace, records }), counts, total, collectedFrom };
}

/** "2 pieces of evidence support this finding": only Verified and Supporting pieces are said to support it —
 *  an Unconfirmed piece is counted in its own pill, never as support. */
export function evidenceSummaryLine(e: Pick<CaseEvidence, "total" | "counts">): string {
  const support = e.counts.verified + e.counts.supporting;
  if (support) return `${plural(support, "piece")} of evidence ${support === 1 ? "supports" : "support"} this finding`;
  return e.total ? `${plural(e.total, "piece")} of evidence recorded, none of it confirmed` : "No evidence was recorded for this finding";
}
