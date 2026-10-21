// Preview simulators must never reach a shipped build.
// Run: cd /app/frontend && node --test tests/previewGating.test.ts
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const SOURCES = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "src"))];

test("sample data is only ever reached through the preview gate", () => {
  const offenders = SOURCES.filter((f) => !f.endsWith("src/preview/samples.ts") && !f.includes("/src/preview/simulated"))
    .filter((f) => {
      const code = readFileSync(f, "utf8");
      // A value import of the raw sample modules bypasses the gate; `import type` is erased and fine.
      return /(?<!import type )\{[^}]*\}\s*from\s*["'][^"']*preview\/simulated(Items|Inbox)["']/.test(code);
    });
  assert.deepEqual(offenders, [], `These files import preview sample data directly instead of @/src/preview/samples:\n${offenders.join("\n")}`);
});

test("the gate is tied to the dev bundle, not to an env var alone", () => {
  const gate = readFileSync(join(ROOT, "src/preview/samples.ts"), "utf8");
  const line = gate.split("\n").find((l) => l.includes("PREVIEW_SAMPLES_ENABLED ="));
  assert.ok(line, "PREVIEW_SAMPLES_ENABLED must be defined in src/preview/samples.ts");
  assert.match(line!, /__DEV__/, "the gate must be false in every shipped build");
  assert.match(line!, /EXPO_PUBLIC_PREVIEW_SAMPLES/, "the kill switch must remain available in the preview");
});

test("every simulated input surface is behind the gate", () => {
  const picker = readFileSync(join(ROOT, "src/components/SimulatedPicker.tsx"), "utf8");
  assert.match(picker, /export const PREVIEW_SIMULATION = PREVIEW_SAMPLES_ENABLED &&/);
  assert.match(picker, /if \(!PREVIEW_SIMULATION \|\| items\.length === 0\) return null;/);

  const email = readFileSync(join(ROOT, "app/email.tsx"), "utf8");
  assert.match(email, /const showSimulatedInbox = PREVIEW_SAMPLES_ENABLED &&/);
});

test("a simulated DI record is called out in a shipped build", () => {
  const report = readFileSync(join(ROOT, "src/components/DiReport.tsx"), "utf8");
  assert.match(report, /record\.simulated && !__DEV__/);
});
