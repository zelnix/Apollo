// Native singletons: multiple physical JS copies can register the same native view even
// when their version strings agree. Symlinks to ONE physical installation are not duplicates.
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_SINGLETONS = Object.freeze([
  'react-native',
  'react-native-svg',
  'react-native-reanimated',
  'react-native-screens',
  'react-native-gesture-handler',
  'react-native-safe-area-context',
  'react-native-webview',
  'react-native-worklets',
  'react-native-keyboard-controller',
  '@react-native-async-storage/async-storage',
  'expo',
  'expo-modules-core',
]);

function nativeReasons(directory, manifest) {
  const reasons = [];
  if (REQUIRED_SINGLETONS.includes(manifest.name)) reasons.push('required singleton');
  for (const filename of ['expo-module.config.json', 'unimodule.json']) {
    const file = path.join(directory, filename);
    if (!fs.existsSync(file)) continue;
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    const platforms = config.platforms;
    if (!platforms || platforms.some(p => ['android', 'ios', 'apple'].includes(p))) {
      reasons.push(filename);
    }
  }
  if (fs.readdirSync(directory).some(name => name.endsWith('.podspec'))) reasons.push('podspec');
  if (['android/build.gradle', 'android/build.gradle.kts'].some(file => fs.existsSync(path.join(directory, file)))) {
    reasons.push('Android library');
  }
  return reasons;
}

module.exports = { REQUIRED_SINGLETONS, nativeReasons };