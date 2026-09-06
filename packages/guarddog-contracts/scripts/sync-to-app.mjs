// Copies the shared contract sources into the Expo app (Metro cannot resolve files
// outside its project root, and metro.config.js is platform-managed). Run after
// editing anything in packages/guarddog-contracts/src.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
const dest = join(here, "..", "..", "..", "apps", "guarddog-mobile", "src", "contracts", "shared");
mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) copyFileSync(join(src, file), join(dest, file));
console.log(`synced ${readdirSync(src).length} files -> ${dest}`);
