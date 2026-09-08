// Copies the shared contract sources into the Expo app (Metro cannot resolve files
// outside its project root, and metro.config.js is platform-managed). Run after
// editing anything in packages/guarddog-contracts/src.
//
// Destination is the actual Expo app at /app/frontend (fixed in Gate Guard M2.1 Phase 5 --
// this previously pointed at a stale apps/guarddog-mobile path that hasn't existed since the
// app was restructured; every prior sync had to be done by hand, file-for-file, into
// frontend/src/contracts/shared instead). Keep this script as the ONLY way contracts are
// synced going forward.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
const dest = join(here, "..", "..", "..", "frontend", "src", "contracts", "shared");
mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) copyFileSync(join(src, file), join(dest, file));
console.log(`synced ${readdirSync(src).length} files -> ${dest}`);
