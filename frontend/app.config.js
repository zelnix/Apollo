const base = require("./app.json");
const acceptance = require("./guarddog-acceptance.config.json");
const ANDROID_PACKAGE = "app.apollo.hwg";
const IOS_BUNDLE_IDENTIFIER = "app.apollo.hwg";

module.exports = () => {
  const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV || "development";
  const engine = process.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE || (appEnvironment === "production" ? "guarddog_production" : "legacy");
  const candidate = engine === "guarddog_acceptance" ? acceptance : {};
  return ({
  ...base.expo,
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