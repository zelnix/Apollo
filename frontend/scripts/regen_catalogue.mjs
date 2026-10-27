// Regenerates src/domain/triage/catalogue.ts from backend/content/triage_catalogue.json (the source of truth).
// Run: cd /app/frontend && node scripts/regen_catalogue.mjs
import { readFileSync, writeFileSync } from "node:fs";

const json = JSON.parse(readFileSync(new URL("../../backend/content/triage_catalogue.json", import.meta.url), "utf8"));
const header = `// GENERATED from backend/content/triage_catalogue.json — the single source of truth for Apollo's
// deterministic Triage rules. Do not hand-edit: change the backend catalogue and re-copy.
// tests/triage.test.ts fails if this drifts from the backend file.

`;
writeFileSync(new URL("../src/domain/triage/catalogue.ts", import.meta.url),
  `${header}const CATALOGUE = ${JSON.stringify(json, null, 2)} as const;\n\nexport default CATALOGUE;\n`);
