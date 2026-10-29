/**
 * Regression: a screen must never build an InvestigationFlow `submissionId` during render.
 *
 * call-guard.tsx once passed `submissionId={`callguard-…-${Date.now().toString(36)}`}` inline.
 * Every re-render produced a new id, InvestigationFlow treated it as a new submission, and a fresh
 * Magnum DI case was opened every few seconds (15+ cases for one number check).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Tests run from the frontend root (see package.json scripts).
const APP_DIR = "app";
const SRC_COMPONENTS = join("src", "components");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}

describe("submissionId is stable across renders", () => {
  const files = [...tsxFiles(APP_DIR), ...tsxFiles(SRC_COMPONENTS)];

  it("no JSX submissionId prop is computed from Date.now() or Math.random()", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const props = src.split("\n").filter((line) => line.includes("submissionId={"));
      for (const p of props) if (/Date\.now\(|Math\.random\(/.test(p)) offenders.push(`${f}: ${p}`);
    }
    assert.deepEqual(offenders, []);
  });

  it("call-guard.tsx keeps its submissionId in state, set when the check completes", () => {
    const src = readFileSync(join(APP_DIR, "call-guard.tsx"), "utf8");
    assert.match(src, /const \[submissionId, setSubmissionId\] = useState<string \| null>\(null\)/);
    assert.match(src, /setSubmissionId\(sid\)/);
    assert.match(src, /submissionId=\{submissionId\}/);
  });
});
