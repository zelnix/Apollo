// Evidence profiles — what kind of evidence Higgins Triage received for a check, and what it could examine.
//
// Every check records the level of the evidence it was given (source-specific: L1–L4 for email), each
// capability's status (verified by ApolloSG / recorded by the source / observed / unavailable) and the
// investigation signals it raised. The profile lives on the phone with the case; only `findings` — a minimal
// structured summary with no message content — may travel to ApolloSG's servers with an investigation.
// Words come from the catalogue (`evidenceProfiles`). Pure, no Expo imports.

import catalogue from "./catalogue.ts";

export type CapabilityStatus = "verified" | "recorded" | "observed" | "unavailable";

export interface CapabilityRow {
  id: string;
  label: string;
  status: CapabilityStatus;
  value: string | null;
  /** Who recorded it / why it couldn't be examined, in plain English. */
  note: string | null;
}

export interface EvidenceSignal { id: string; text: string }

export interface LevelChange { level: string; label: string; via: string; at: string }

export interface EvidenceProfile {
  version: number;
  type: string;
  level: string;
  label: string;
  rank: number;
  received: string;
  basis: string;
  via: string;
  viaLabel: string;
  classifiedBy: string;
  at: string;
  capabilities: CapabilityRow[];
  signals: EvidenceSignal[];
  /** The original file, when one was received: fingerprinted and kept on this phone, never uploaded. */
  original: { sha256: string; bytes: number; keptOnDevice: boolean } | null;
  /** Every level this case's evidence has had, oldest first. The current one is last. */
  history: LevelChange[];
  /** It came from a preview sample standing in for `via`. It was processed exactly as `via`; this only tags it. */
  simulated?: boolean;
}

interface LevelWords { rank: number; label: string; received: string; basis: string }
/** `viaLevels`: the same level, described for the source it came from (its rank and rules never change). */
interface TypeWords {
  label: string; levels: Record<string, LevelWords>; capabilities: Record<string, string>; via?: Record<string, string>;
  viaLevels?: Record<string, Record<string, Omit<LevelWords, "rank">>>;
}

export const PROFILE_WORDS = (catalogue as unknown as {
  evidenceProfiles: {
    version: number; classifiedBy: string; statuses: Record<CapabilityStatus, string>;
    signalsTitle: string; caution: string; authCaution: string;
    types: Record<string, TypeWords & Record<string, unknown>>;
  };
}).evidenceProfiles;

export function typeWords(type: string): TypeWords {
  const words = PROFILE_WORDS.types[type];
  if (!words) throw new Error(`No evidence profile words for ${type}`);
  return words;
}

export function statusLabel(status: CapabilityStatus): string {
  return PROFILE_WORDS.statuses[status];
}

/** "{server} recorded …" → the template with every {name} filled. Unknown names stay visible. */
export function fill(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

export function capability(type: string, id: string, status: CapabilityStatus, value: string | null = null, note: string | null = null): CapabilityRow {
  return { id, label: typeWords(type).capabilities[id] ?? id, status, value, note };
}

export function newProfile(args: {
  type: string; level: string; via: string; at?: string;
  capabilities: CapabilityRow[]; signals: EvidenceSignal[]; original?: EvidenceProfile["original"]; simulated?: boolean;
}): EvidenceProfile {
  const words = typeWords(args.type);
  const level = { ...words.levels[args.level], ...(words.viaLevels?.[args.via]?.[args.level] ?? {}) };
  const at = args.at ?? new Date().toISOString();
  return {
    version: PROFILE_WORDS.version, type: args.type, level: args.level, label: level.label, rank: level.rank,
    received: level.received, basis: level.basis, via: args.via, viaLabel: words.via?.[args.via] ?? args.via,
    classifiedBy: PROFILE_WORDS.classifiedBy, at, capabilities: args.capabilities, signals: args.signals,
    original: args.original ?? null, history: [{ level: args.level, label: level.label, via: args.via, at }],
    ...(args.simulated ? { simulated: true } : {}),
  };
}

/** New evidence for the same case. The stronger evidence becomes current; nothing earlier is lost — the
 *  history keeps every level the case has had. */
export function mergeProfiles(previous: EvidenceProfile | null | undefined, next: EvidenceProfile): EvidenceProfile {
  if (!previous) return next;
  const history = [...(previous.history?.length ? previous.history : [{ level: previous.level, label: previous.label, via: previous.via, at: previous.at }]),
    ...next.history.filter((h) => !(previous.history ?? []).some((p) => p.at === h.at && p.level === h.level))];
  const simulated = previous.simulated || next.simulated ? { simulated: true } : {};
  return next.rank >= previous.rank ? { ...next, history, ...simulated } : { ...previous, history, ...simulated };
}

/** How strong this evidence is for its kind: its level's rank out of the strongest level that kind can have. */
export function evidenceStrength(profile: Pick<EvidenceProfile, "type" | "rank">): { rank: number; max: number } {
  const levels = PROFILE_WORDS.types[profile.type]?.levels ?? {};
  const max = Math.max(1, ...Object.values(levels).map((l) => l.rank));
  return { rank: Math.min(profile.rank, max), max };
}

/** The level changes worth telling the person about: each move to a stronger level. */
export function upgrades(profile: EvidenceProfile | null | undefined): { from: LevelChange; to: LevelChange }[] {
  const out: { from: LevelChange; to: LevelChange }[] = [];
  const history = profile?.history ?? [];
  let best = history[0];
  for (const entry of history.slice(1)) {
    const rank = (level: string) => typeWords(profile!.type).levels[level]?.rank ?? 0;
    if (best && rank(entry.level) > rank(best.level)) { out.push({ from: best, to: entry }); best = entry; }
  }
  return out;
}
