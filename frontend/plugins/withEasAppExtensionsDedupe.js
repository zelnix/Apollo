// Expo config plugin: de-duplicates `extra.eas.build.experimental.ios.appExtensions` by targetName.
//
// Why this exists (Stage 1C.1, Step 7 gate): `eas project:init` re-links the project by writing the
// *plugin-evaluated* `extra` back into app.json via @expo/config's modifyConfigAsync, which merges with
// `deepmerge` — and deepmerge CONCATENATES arrays. Any static `appExtensions` array in app.json is
// therefore doubled on write-back (every entry appears twice, including expo-share-intent's injected
// "ShareExtension"). On the very next `expo config --json`, expo-share-intent's compatibility checker
// counts 2 "ShareExtension" entries and throws, exiting 1 — the exact Step 7 failure.
//
// This plugin MUST run before "expo-share-intent" in app.json's plugins list. It keeps the first
// occurrence of each targetName and, because Expo mods execute in reverse registration order,
// performs the final host App Group entitlement de-duplication after all extension plugins.

const { withEntitlementsPlist } = require("@expo/config-plugins");

module.exports = function withEasAppExtensionsDedupe(config) {
  config = withEntitlementsPlist(config, (value) => {
    const key = "com.apple.security.application-groups";
    const groups = Array.isArray(value.modResults[key]) ? value.modResults[key] : [];
    value.modResults[key] = [...new Set(groups)];
    return value;
  });
  const appExtensions = config.extra?.eas?.build?.experimental?.ios?.appExtensions;
  if (!Array.isArray(appExtensions)) return config;
  const seen = new Set();
  config.extra.eas.build.experimental.ios.appExtensions = appExtensions.filter((ext) => {
    if (seen.has(ext.targetName)) return false;
    seen.add(ext.targetName);
    return true;
  });
  return config;
};
