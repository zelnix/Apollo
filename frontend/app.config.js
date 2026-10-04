const base = require("./app.json");
const acceptance = require("./guarddog-acceptance.config.json");
const ANDROID_PACKAGE = "app.apollo.hwg";
const IOS_BUNDLE_IDENTIFIER = "app.apollo.hwg";

// ── Expo project identity ──────────────────────────────────────────────────
// Canonical values for the owner's Expo project. app.json carries the same
// slug and projectId but this explicit override prevents any pipeline
// regeneration of app.json from silently reverting to stale values.
//
// Emergent (or any other build route that targets a *different* Expo project)
// can override all three atomically via environment variables:
//   EAS_PROJECT_OWNER   – Expo account that owns the build project
//   EAS_PROJECT_SLUG    – project slug registered under that account
//   EAS_PROJECT_ID      – the project's UUID (extra.eas.projectId)
const CANONICAL_OWNER      = "zelnixs-team";
const CANONICAL_SLUG       = "apollo-cyber-guard-dog";
const CANONICAL_PROJECT_ID = "b2eb337d-2687-46bf-b1cc-292d30c0b601";

const EAS_OWNER      = process.env.EAS_PROJECT_OWNER || CANONICAL_OWNER;
const EAS_SLUG       = process.env.EAS_PROJECT_SLUG  || CANONICAL_SLUG;
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID    || CANONICAL_PROJECT_ID;

module.exports = () => {
  const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV || "development";
  const engine = process.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE || (appEnvironment === "production" ? "guarddog_production" : "legacy");
  const candidate = engine === "guarddog_acceptance" ? acceptance : {};
  return ({
  ...base.expo,
  // ── identity (always wins over the app.json spread) ──────────────────
  owner: EAS_OWNER,
  slug: EAS_SLUG,
  android: {
    ...(base.expo.android || {}),
    package: ANDROID_PACKAGE,
  },
  ios: {
    ...(base.expo.ios || {}),
    bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
  },
  extra: {
    ...(base.expo.extra || {}),
    // Explicit eas block — always wins over the app.json spread above.
    eas: {
      ...(base.expo.extra?.eas || {}),
      projectId: EAS_PROJECT_ID,
    },
    guardDogCandidate: {
      engine,
      profile: "guarddog-stage1d-acceptance",
      controlledHost: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_HOST || candidate.controlledHost || "",
      controlledIpv4: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_IPV4 || candidate.controlledIpv4 || "",
      controlledUrl: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_URL || candidate.controlledUrl || "",
      rulesetId: process.env.EXPO_PUBLIC_GUARDDOG_RULESET_ID || candidate.rulesetId || "",
      signedBundleB64: process.env.EXPO_PUBLIC_GUARDDOG_SIGNED_BUNDLE_B64 || candidate.signedBundleB64 || "",
    },
    guardDogProduction: {
      manifestUrl: process.env.EXPO_PUBLIC_GUARDDOG_TRUST_MANIFEST_URL || "",
      ruleBundleUrl: process.env.EXPO_PUBLIC_GUARDDOG_RULE_BUNDLE_URL || "",
      controlledHost: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_HOST || "",
      controlledIpv4: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_IPV4 || "",
      controlledUrl: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_URL || "",
      rulesetId: process.env.EXPO_PUBLIC_GUARDDOG_RULESET_ID || "",
      dedupeWindowMs: Number(process.env.EXPO_PUBLIC_GUARDDOG_DEDUPE_WINDOW_MS || "2000"),
    },
  },
  });
};