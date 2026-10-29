// File evidence — Higgins Triage's classification of what ApolloSG could read of a file: only its name, the start of
// its contents (its true type, from its first bytes), or the whole file read and fingerprinted (SHA-256) on the device.
// Nothing here uploads the file. Pure, no Expo imports.

import type { FileAnalysis } from "../fileAnalysis.ts";
import { capability, fill, newProfile, typeWords, type CapabilityRow, type EvidenceProfile, type EvidenceSignal } from "./evidenceProfile.ts";

export type FileVia = "picked" | "shared" | "name_only";

const WORDS = typeWords("file") as ReturnType<typeof typeWords> & { notes: Record<string, string>; signals: Record<string, string> };
export const FILE_WORDS = WORDS;

const DANGEROUS_EXT = new Set(["exe", "scr", "bat", "cmd", "com", "pif", "msi", "js", "jse", "vbs", "vbe", "ps1", "wsf", "hta", "jar", "sh", "lnk", "dll"]);
const LOOKS_HARMLESS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "odt", "jpg", "jpeg", "png", "gif", "heic", "webp", "bmp", "svg"]);
/** What a risky true type really is, in plain words — and the extensions that honestly say so. */
const RISKY: Record<string, { words: string; ext: string[] }> = {
  exe: { words: "a program", ext: ["exe", "msi", "scr", "com", "pif", "dll", "bin", "app"] },
  script: { words: "a script", ext: ["sh", "js", "jse", "bat", "cmd", "ps1", "vbs", "vbe", "wsf", "hta", "jar", "py"] },
  apk: { words: "an app installer", ext: ["apk"] },
  profile: { words: "a configuration profile", ext: ["mobileconfig", "plist", "xml"] },
  certificate: { words: "a trust certificate", ext: ["cer", "crt", "pem", "der", "p12", "pfx"] },
};

export interface FileEvidenceInput {
  via: FileVia;
  /** A preview sample standing in for `via`: processed exactly as `via`, only tagged. */
  simulated?: boolean;
  name: string;
  size?: number | null;
  mime?: string | null;
  analysis: FileAnalysis;
  /** The first bytes were read on the device. */
  inspected: boolean;
  inspectionError?: string | null;
  /** SHA-256 of the WHOLE file, calculated on the device. */
  sha256?: string | null;
  passwordInMessage?: boolean;
  at?: string;
}

export function fileLevelFor(input: Pick<FileEvidenceInput, "inspected" | "sha256">): string {
  return input.sha256 ? "fingerprinted" : input.inspected ? "contents_read" : "name_only";
}

export function buildFileProfile(input: FileEvidenceInput): EvidenceProfile {
  const a = input.analysis;
  const level = fileLevelFor(input);
  const clean = input.name.replace(/[\u202a-\u202e\u200e\u200f]/g, "");
  const parts = clean.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  const inner = parts.length > 2 ? parts[parts.length - 2] : "";
  const notRead = fill(WORDS.notes.notRead, { reason: input.inspectionError ? ` (${input.inspectionError.replace(/\.$/, "")})` : "" });
  const size = input.size != null ? ` · ${input.size < 1024 ? `${input.size} bytes` : `${Math.round(input.size / 1024)} KB`}` : "";
  const caps: CapabilityRow[] = [
    capability("file", "file_name", "observed", `${clean}${size}`),
    capability("file", "declared_type", "observed", `${a.claimedType}${input.mime ? ` · ${input.mime}` : ""}`, input.mime ? WORDS.notes.byApp : WORDS.notes.byName),
    input.inspected
      ? capability("file", "true_type", "verified", a.realType === "unknown" ? "Not recognised" : a.realType.replace(/_/g, " "), WORDS.notes.trueType)
      : capability("file", "true_type", "unavailable", null, notRead),
    input.sha256
      ? capability("file", "sha256", "verified", input.sha256, WORDS.notes.sha)
      : capability("file", "sha256", "unavailable", null, input.inspected ? WORDS.notes.shaNotWhole : notRead),
    capability("file", "metadata", "unavailable", null, WORDS.notes.metadata),
    capability("file", "signature", "unavailable", null, WORDS.notes.signature),
    input.inspected && a.realType === "office_macro"
      ? capability("file", "macros", "observed", "Macro-enabled format", WORDS.notes.macroFormat)
      : capability("file", "macros", "unavailable", null, input.inspected ? WORDS.notes.noMacroFormat : notRead),
    input.inspected
      ? capability("file", "embedded_links", "observed", a.urls.length ? `${a.urls.length} found` : "None found", WORDS.notes.links)
      : capability("file", "embedded_links", "unavailable", null, notRead),
    capability("file", "threat_indicators", "unavailable", null, WORDS.notes.threats),
  ];
  const signals: EvidenceSignal[] = [];
  const risky = input.inspected ? RISKY[a.realType] : undefined;
  if (risky && ext && !risky.ext.includes(ext)) signals.push({ id: "type_mismatch", text: fill(WORDS.signals.type_mismatch, { claimed: a.claimedType, real: risky.words }) });
  if (parts.length > 2 && LOOKS_HARMLESS.has(inner) && DANGEROUS_EXT.has(ext)) signals.push({ id: "double_extension", text: fill(WORDS.signals.double_extension, { name: clean }) });
  if (/[\u202e\u202b\u200f]/.test(input.name)) signals.push({ id: "hidden_characters", text: WORDS.signals.hidden_characters });
  if (a.realType === "exe" || a.realType === "script") signals.push({ id: "executable", text: WORDS.signals.executable });
  if (a.realType === "apk" || a.realType === "profile" || a.realType === "certificate") signals.push({ id: "installer", text: WORDS.signals.installer });
  if (input.passwordInMessage) signals.push({ id: "archive_password", text: WORDS.signals.archive_password });
  if (a.realType === "office_macro") signals.push({ id: "macros", text: WORDS.signals.macros });
  if (a.urls.length) signals.push({ id: "links_inside", text: fill(WORDS.signals.links_inside, { count: String(a.urls.length), plural: a.urls.length === 1 ? "" : "s" }) });
  return newProfile({
    type: "file", level, via: input.via, at: input.at, capabilities: caps, signals,
    original: input.sha256 && input.size != null ? { sha256: input.sha256, bytes: input.size, keptOnDevice: false } : null,
    simulated: input.simulated,
  });
}
