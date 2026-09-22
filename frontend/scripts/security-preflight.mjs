#!/usr/bin/env node
// Build-time security and installed-native-dependency preflight. Production native
// requirements follow securityConfig.ts. Wired to the EAS "eas-build-pre-install" hook in
// package.json and runnable locally: `node scripts/security-preflight.mjs`.
//
// Environment resolution (first match wins): process.env → .env.<APP_ENV or NODE_ENV> → .env

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import nativeGuard from "./native-dependency-guard.cjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ANDROID_PACKAGE = "app.apollo.hwg";
const IOS_BUNDLE_IDENTIFIER = "app.apollo.hwg";
const KEYS = ["EXPO_PUBLIC_APP_ENV", "EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS", "EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE"];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [p] : [];
  });
}

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
const profileDefaults = profile ? {
  EXPO_PUBLIC_APP_ENV: ["device-test", "guarddog-acceptance", "staging"].includes(profile) ? "staging" : "production",
  EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS: "off",
  EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE: profile === "guarddog-acceptance" ? "guarddog_acceptance" : "legacy",
} : {};
const guessedEnv = process.env.EXPO_PUBLIC_APP_ENV || profileDefaults.EXPO_PUBLIC_APP_ENV || (process.env.NODE_ENV === "production" ? "production" : "development");
const baseFile = readDotenv(path.join(root, ".env"));
const environmentFile = readDotenv(path.join(root, `.env.${guessedEnv}`));
// Native EAS profiles never inherit development-web defaults from `.env`. Explicit profile env wins, then the
// matching environment file, then fail-safe native defaults. Local web development still reads `.env` normally.
const cfg = Object.fromEntries(KEYS.map((k) => [k, process.env[k] ?? environmentFile[k] ?? (profile ? profileDefaults[k] : baseFile[k])]));
if (!cfg.EXPO_PUBLIC_APP_ENV && profile) cfg.EXPO_PUBLIC_APP_ENV = guessedEnv;

const errors = [];
const resolvedAppConfig = require(path.join(root, "app.config.js"))();
if (resolvedAppConfig.android?.package !== ANDROID_PACKAGE) errors.push(`Android package must be ${ANDROID_PACKAGE}.`);
if (resolvedAppConfig.ios?.bundleIdentifier !== IOS_BUNDLE_IDENTIFIER) errors.push(`iOS bundle identifier must be ${IOS_BUNDLE_IDENTIFIER}.`);
const nativeGradle = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
if (!nativeGradle.includes(`namespace '${ANDROID_PACKAGE}'`) || !nativeGradle.includes(`applicationId '${ANDROID_PACKAGE}'`)) {
  errors.push(`Native Android namespace and applicationId must both be ${ANDROID_PACKAGE}.`);
}
if (!["development", "staging", "production"].includes(cfg.EXPO_PUBLIC_APP_ENV)) errors.push(`EXPO_PUBLIC_APP_ENV is missing or invalid (got "${cfg.EXPO_PUBLIC_APP_ENV}").`);
const harness = cfg.EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS;
if (harness !== undefined && harness !== "" && harness !== "off" && harness !== "enabled") errors.push(`EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS="${harness}" is invalid.`);
if (harness === "enabled" && cfg.EXPO_PUBLIC_APP_ENV !== "development") errors.push("The device-preview harness (simulated device inputs) is only permitted in development builds.");
if (harness === "enabled" && profile) errors.push("The device-preview harness is web-only and can never be part of an EAS native build profile.");
const engine = cfg.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE ?? "legacy";
if (!["legacy", "guarddog_acceptance"].includes(engine)) errors.push(`EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE="${engine}" is invalid.`);
if (cfg.EXPO_PUBLIC_APP_ENV === "production" && engine !== "legacy") errors.push("The GuardDog Stage 1D candidate is test-only and cannot be selected in production.");
// Runtime-mock exclusion: no mock adapter/selector may exist in application source, and the preview harness may only be
// referenced from the web-only host selector (never from a native or shared module).
const appSources = ["src", "app", "modules/apollo-security/src"].flatMap((dir) => walk(path.join(root, dir)));
for (const file of appSources) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  if (/tools\/preview-device-harness/.test(text) && rel !== "src/security/hostAdapter.web.ts") errors.push(`${rel} references the preview harness; only src/security/hostAdapter.web.ts may.`);
  if (/EXPO_PUBLIC_SECURITY_MODE|EXPO_PUBLIC_SECURECORE_MODE|MockSecurityAdapter|MockSecureCore/.test(text)) errors.push(`${rel} references a removed runtime mock selector.`);
}

console.log(`[security-preflight] profile=${profile ?? "local"} env=${cfg.EXPO_PUBLIC_APP_ENV} engine=${engine} preview-harness=${harness || "off"} app-sources-scanned=${appSources.length}`);
if (errors.length) {
  console.error("SECURITY CONFIGURATION ERROR:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("[security-preflight] OK");

// EAS invokes this lifecycle BEFORE dependency installation: there is no truthful tree
// to inspect yet. Managed Android/iOS prebuild enforces the guard AFTER installation via
// withNativeDependencyGuard. Manual/CI security:preflight never takes this deferral.
if (process.env.npm_lifecycle_event === "eas-build-pre-install") {
  console.log("[native-dependency-guard] DEFERRED: EAS pre-install; mandatory Android/iOS prebuild check runs after dependency installation.");
} else {
  const report = nativeGuard.auditNativeDependencies(root);
  console.log(nativeGuard.formatReport(report));
  if (report.status !== "pass") process.exit(report.status === "error" ? 2 : 1);
}
