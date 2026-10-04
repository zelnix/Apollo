#!/usr/bin/env node
// EAS "eas-build-post-install" lifecycle hook.
//
// Problem: EAS build workers generate an internal bash script that occasionally
// invokes the bare `expo` command (e.g. for config resolution or prebuild) without
// going through `npx` or the package-manager bin shim. If `node_modules/.bin` is
// not on the system PATH, the shell emits `expo: command not found`.
//
// Fix: After dependency installation (which populates node_modules/.bin/expo),
// create a global symlink so the platform-owned script can resolve `expo`.
// Also symlinks `eas-cli-local-build-plugin` if present, since some EAS workers
// also need that. This runs before the builder resolves Expo config or runs
// prebuild.
//
// This is intentionally a no-op when the binary is already reachable, and never
// fails the build if symlinking is not possible (|| true semantics).

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const binDir = path.join(root, "node_modules", ".bin");

/** Try to make a binary from node_modules/.bin globally reachable. */
function ensureGlobal(name) {
  const localBin = path.join(binDir, name);
  if (!fs.existsSync(localBin)) {
    console.log(`[eas-post-install] ${name} not in node_modules/.bin; skipping.`);
    return;
  }

  // Already reachable?
  try {
    execSync(`which ${name}`, { encoding: "utf8", stdio: "pipe" });
    console.log(`[eas-post-install] ${name} is already on PATH.`);
    return;
  } catch {
    // Not found — proceed to symlink.
  }

  // Try known global bin directories in order.
  for (const dir of ["/usr/local/bin", "/usr/bin"]) {
    if (!fs.existsSync(dir)) continue;
    const target = path.join(dir, name);
    try {
      fs.symlinkSync(localBin, target);
      console.log(`[eas-post-install] Symlinked ${name} → ${target}`);
      return;
    } catch (e) {
      // Directory not writable or name conflict; try next.
      console.log(`[eas-post-install] Could not symlink ${name} to ${dir}: ${e.message}`);
    }
  }

  console.log(`[eas-post-install] WARNING: Could not make ${name} globally reachable. The EAS builder may still resolve it via npx.`);
}

ensureGlobal("expo");
ensureGlobal("expo-cli");

console.log("[eas-post-install] OK");
