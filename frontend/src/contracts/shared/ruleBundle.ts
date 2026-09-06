// Signed rule bundle contract (TypeScript). Mirrors backend/app/domain/models/rule_bundle.py.
//
// Cryptographic verification (Ed25519, SHA-256) is performed natively (Kotlin/Swift);
// the TS side validates the strict shape and provides a canonicalizer used by the
// parity test suite to prove byte identity with the RFC 8785 reference output.
//
// JCS note: bundles are constrained to strings, integers (|n| < 2^53), booleans,
// null, arrays and objects. Within that domain RFC 8785 reduces to: sort keys by
// UTF-16 code units, minimal escaping, no whitespace, integers verbatim.

export type RuleAction = "block" | "allow";

export interface RuleEntry {
  ruleId: string;
  host: string;
  action: RuleAction;
  matchType: "exact";
  category: string;
}

export interface UnsignedRuleBundle {
  schemaVersion: "1.0";
  rulesetId: string;
  bundleVersion: number;
  issuedAt: string;
  expiresAt: string;
  keyId: string;
  payload: { rules: RuleEntry[] };
  payloadHash: string;
}

export interface SignedRuleBundle extends UnsignedRuleBundle {
  signature: string;
}

export type BundleRejectReason =
  | "SCHEMA_INVALID"
  | "PAYLOAD_HASH_MISMATCH"
  | "UNKNOWN_KEY"
  | "SIGNATURE_INVALID"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "ROLLBACK";

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ID_RE = /^[a-z0-9-]+$/;
const RULE_ID_RE = /^[A-Za-z0-9._:-]+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ENVELOPE_KEYS = ["schemaVersion", "rulesetId", "bundleVersion", "issuedAt", "expiresAt", "keyId", "payload", "payloadHash", "signature"];
const RULE_KEYS = ["ruleId", "host", "action", "matchType", "category"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strict schema validation (extra fields forbidden, exact types). */
export function validateSignedBundleShape(input: unknown): SignedRuleBundle | null {
  if (!isRecord(input)) return null;
  if (Object.keys(input).some((k) => !ENVELOPE_KEYS.includes(k))) return null;
  const b = input;
  if (b.schemaVersion !== "1.0") return null;
  if (typeof b.rulesetId !== "string" || !ID_RE.test(b.rulesetId)) return null;
  if (typeof b.bundleVersion !== "number" || !Number.isInteger(b.bundleVersion) || b.bundleVersion < 1) return null;
  if (typeof b.issuedAt !== "string" || !ISO_Z.test(b.issuedAt)) return null;
  if (typeof b.expiresAt !== "string" || !ISO_Z.test(b.expiresAt)) return null;
  if (typeof b.keyId !== "string" || !ID_RE.test(b.keyId)) return null;
  if (typeof b.payloadHash !== "string" || !HEX64.test(b.payloadHash)) return null;
  if (typeof b.signature !== "string" || b.signature.length !== 88) return null;
  if (!isRecord(b.payload) || Object.keys(b.payload).some((k) => k !== "rules") || !Array.isArray(b.payload.rules)) return null;
  if (b.payload.rules.length === 0) return null;
  for (const r of b.payload.rules) {
    if (!isRecord(r) || Object.keys(r).some((k) => !RULE_KEYS.includes(k))) return null;
    if (typeof r.ruleId !== "string" || !RULE_ID_RE.test(r.ruleId)) return null;
    if (typeof r.host !== "string" || r.host.length === 0) return null;
    if (r.action !== "block" && r.action !== "allow") return null;
    if (r.matchType !== "exact") return null;
    if (typeof r.category !== "string" || r.category.length === 0) return null;
  }
  return b as unknown as SignedRuleBundle;
}

export function unsignedEnvelope(bundle: SignedRuleBundle): UnsignedRuleBundle {
  const { signature: _signature, ...rest } = bundle;
  return rest;
}

// ---- RFC 8785 canonicalization for the constrained bundle domain ----------
function utf16Compare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function escapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (code === 0x08) out += "\\b";
    else if (code === 0x09) out += "\\t";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0c) out += "\\f";
    else if (code === 0x0d) out += "\\r";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

export function jcsCanonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return escapeString(value);
  if (typeof value === "number") {
    if (!Number.isInteger(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new Error("rule bundle canonicalization only supports safe integers");
    }
    return value === 0 ? "0" : String(value);
  }
  if (Array.isArray(value)) return "[" + value.map(jcsCanonicalize).join(",") + "]";
  if (isRecord(value)) {
    const keys = Object.keys(value).sort(utf16Compare);
    return "{" + keys.map((k) => escapeString(k) + ":" + jcsCanonicalize(value[k])).join(",") + "}";
  }
  throw new Error("unsupported JSON value");
}

/** Exact-host match against an accepted bundle. Host must already be canonical. */
export function findRuleForHost(bundle: SignedRuleBundle, canonicalHost: string): RuleEntry | null {
  return bundle.payload.rules.find((r) => r.matchType === "exact" && r.host === canonicalHost) ?? null;
}
