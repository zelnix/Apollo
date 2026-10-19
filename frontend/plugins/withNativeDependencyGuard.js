// Managed native builds run these mods AFTER installing node_modules and BEFORE
// Gradle/Xcode compilation. No manifest or generated native project is changed here.
const { withDangerousMod } = require('@expo/config-plugins');
const { assertNativeDependencies } = require('../scripts/native-dependency-guard.cjs');

module.exports = function withNativeDependencyGuard(config) {
  for (const platform of ['android', 'ios']) {
    config = withDangerousMod(config, [platform, async modConfig => {
      const report = assertNativeDependencies(modConfig.modRequest.projectRoot);
      console.log(`[native-dependency-guard] ${platform} prebuild PASS: ${report.packages.length} native singleton packages.`);
      return modConfig;
    }]);
  }
  return config;
};