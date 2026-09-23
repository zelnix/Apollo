const { withAndroidManifest } = require("expo/config-plugins");

const META_NAME = "app.apollo.guarddog.acceptanceEnabled";

module.exports = function withGuardDogCandidateProfile(config) {
  return withAndroidManifest(config, (mod) => {
    const appEnv = process.env.EXPO_PUBLIC_APP_ENV || "development";
    const engine = process.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE || "legacy";
    if (appEnv === "production" && engine === "guarddog_acceptance") {
      throw new Error("GuardDog acceptance trust cannot be enabled in production");
    }
    const enabled = appEnv !== "production" && engine === "guarddog_acceptance";
    const application = mod.modResults.manifest.application[0];
    const metadata = (application["meta-data"] || []).filter((item) => ![
      META_NAME, "app.apollo.guarddog.acceptanceRootId", "app.apollo.guarddog.acceptanceRootKey",
    ].includes(item.$["android:name"]));
    if (enabled) metadata.push({ $: { "android:name": META_NAME, "android:value": "true" } });
    application["meta-data"] = metadata;
    return mod;
  });
};