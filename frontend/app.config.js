const base = require("./app.json");
const acceptance = require("./guarddog-acceptance.config.json");

module.exports = () => {
  const engine = process.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE || "legacy";
  const candidate = engine === "guarddog_acceptance" ? acceptance : {};
  return ({
  ...base.expo,
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
  },
  });
};