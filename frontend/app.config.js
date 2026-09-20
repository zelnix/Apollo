const base = require("./app.json");

module.exports = () => ({
  ...base.expo,
  extra: {
    ...(base.expo.extra || {}),
    guardDogCandidate: {
      engine: process.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE || "legacy",
      profile: "guarddog-stage1d-acceptance",
      controlledHost: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_HOST || "",
      controlledIpv4: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_IPV4 || "",
      controlledUrl: process.env.EXPO_PUBLIC_GUARDDOG_CONTROLLED_URL || "",
      rulesetId: process.env.EXPO_PUBLIC_GUARDDOG_RULESET_ID || "",
      signedBundleB64: process.env.EXPO_PUBLIC_GUARDDOG_SIGNED_BUNDLE_B64 || "",
    },
  },
});