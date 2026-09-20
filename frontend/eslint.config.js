// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    // Expo's current flat preset enables experimental React Compiler diagnostics as hard errors.
    // Apollo uses valid React Native adapter patterns (effect-driven SDK state and mutable refs)
    // that those diagnostics currently misclassify. Keep Rules of Hooks enabled; disable only
    // these compiler-advisory rules until the Expo preset supports the adapter pattern.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
    },
  },
]);
