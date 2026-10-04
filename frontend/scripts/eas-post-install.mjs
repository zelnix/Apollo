#!/usr/bin/env node
// Yarn "postinstall" + EAS "eas-build-post-install" lifecycle hook.
//
// Problem: The Emergent deployment pipeline and EAS build workers generate
// internal bash scripts that invoke the bare `expo` command (e.g. for config
// resolution or prebuild). After `yarn install`, `expo` lives in
// `node_modules/.bin/expo` which is only on PATH during yarn script execution,
// not when the pipeline's own bash script runs later.
//
// Fix: After dependency installation, create a persistent global symlink so
// `expo` is reachable outside of yarn's script PATH. This runs as a standard
// `postinstall` hook (for the Emergent pipeline) and also as the EAS-specific
// `eas-build-post-install` hook (for cloud builds).
//
// The symlink is always created (idempotent), never fails the build.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const binDir = path.join(root, "node_modules", ".bin");

/** Ensure a binary from node_modules/.bin has a persistent global symlink. */
function ensureGlobal(name) {
  const localBin = path.join(binDir, name);
  if (!fs.existsSync(localBin)) {
    console.log(`[eas-post-install] ${name} not in node_modules/.bin; skipping.`);
    return;
  }

  // Try known global bin directories in order. Always create/refresh the
  // symlink — during yarn lifecycle scripts node_modules/.bin is temporarily
  // on PATH, but that disappears once yarn exits.
  for (const dir of ["/usr/local/bin", "/usr/bin"]) {
    if (!fs.existsSync(dir)) continue;
    const target = path.join(dir, name);
    try {
      // Remove stale symlink if present, then recreate.
      try { fs.unlinkSync(target); } catch { /* absent or not writable — try symlink anyway */ }
      fs.symlinkSync(localBin, target);
      console.log(`[eas-post-install] Symlinked ${name} → ${target}`);
      return;
    } catch (e) {
      console.log(`[eas-post-install] Could not symlink ${name} to ${dir}: ${e.message}`);
    }
  }

  console.log(`[eas-post-install] WARNING: Could not make ${name} globally reachable.`);
}

ensureGlobal("expo");
ensureGlobal("expo-cli");

console.log("[eas-post-install] OK");
