#!/usr/bin/env node
// Build-time security preflight. Fails a production build when security modes are
// mock, missing or invalid. Wired to the EAS "eas-build-pre-install" hook in
// package.json and runnable locally: `node scripts/security-preflight.mjs`.
//
// Environment resolution (first match wins): process.env → .env.<APP_ENV or NODE_ENV> → .env

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEYS = ["EXPO_PUBLIC_APP_ENV", "EXPO_PUBLIC_SECURECORE_MODE", "EXPO_PUBLIC_SECURITY_MODE"];

function readDotenv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*(#.*)?$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const profile = process.env.EAS_BUILD_PROFILE;
const guessedEnv = process.env.EXPO_PUBLIC_APP_ENV || (profile === "production" ? "production" : profile === "staging" ? "staging" : process.env.NODE_ENV === "production" ? "production" : "development");
const fromFiles = { ...readDotenv(path.join(root, ".env")), ...readDotenv(path.join(root, `.env.${guessedEnv}`)) };
const cfg = Object.fromEntries(KEYS.map((k) => [k, process.env[k] ?? fromFiles[k]]));
if (!cfg.EXPO_PUBLIC_APP_ENV && profile) cfg.EXPO_PUBLIC_APP_ENV = guessedEnv;

const errors = [];
if (!["development", "staging", "production"].includes(cfg.EXPO_PUBLIC_APP_ENV)) errors.push(`EXPO_PUBLIC_APP_ENV is missing or invalid (got "${cfg.EXPO_PUBLIC_APP_ENV}").`);
for (const k of ["EXPO_PUBLIC_SECURECORE_MODE", "EXPO_PUBLIC_SECURITY_MODE"]) {
  if (!["mock", "native"].includes(cfg[k])) errors.push(`${k} must be "mock" or "native" (got "${cfg[k]}").`);
}
if (cfg.EXPO_PUBLIC_APP_ENV === "production") {
  if (cfg.EXPO_PUBLIC_SECURECORE_MODE !== "native") errors.push("Production builds require native HuCentAI SecureCore (EXPO_PUBLIC_SECURECORE_MODE=native).");
  if (cfg.EXPO_PUBLIC_SECURITY_MODE !== "native") errors.push("Production builds require the native Apollo Security Adapter (EXPO_PUBLIC_SECURITY_MODE=native).");
}

console.log(`[security-preflight] profile=${profile ?? "local"} env=${cfg.EXPO_PUBLIC_APP_ENV} securecore=${cfg.EXPO_PUBLIC_SECURECORE_MODE} adapter=${cfg.EXPO_PUBLIC_SECURITY_MODE}`);
if (errors.length) {
  console.error("SECURITY CONFIGURATION ERROR:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("[security-preflight] OK");
