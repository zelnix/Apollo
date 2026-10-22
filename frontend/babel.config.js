// Apollo build configuration — ONE build decision governs preview simulation.
//
//   EXPO_PUBLIC_PREVIEW_BUILD=included  → the preview build. `@/src/simulation` resolves to the real
//                                        simulation source in src/simulation/, so samples, pickers,
//                                        the simulated image read and the example case all exist.
//   anything else (the default)         → a production build. Every import of `@/src/simulation` is
//                                        rewritten to src/simulationAbsent.ts, a data-free stub.
//                                        Metro therefore never resolves src/simulation/ at all: the
//                                        simulation source is not in the dependency graph and cannot
//                                        appear in the artifact.
//
// A store build is ALWAYS production, whatever the flag says. The deployment pipeline copies the
// sandbox .env into the EAS job, so `included` travels with it; EAS_BUILD / EAS_BUILD_PLATFORM are
// set only inside that job and settle it — a shipped app can never carry the simulation source.
//
// This is deliberately NOT a runtime flag. `__DEV__`, environment checks and tree-shaking are not
// isolation — a production bundle must not contain the code at all. scripts/verify-no-simulation.mjs
// inspects the exported artifact and fails if any of it got through.
const STORE_BUILD = !!process.env.EAS_BUILD || !!process.env.EAS_BUILD_PLATFORM;
const PREVIEW_BUILD = !STORE_BUILD && process.env.EXPO_PUBLIC_PREVIEW_BUILD === "included";

module.exports = function babelConfig(api) {
  // Re-transform when the build kind changes, so a cached preview transform can never leak into a
  // production bundle (or the other way round).
  api.cache.using(() => (PREVIEW_BUILD ? "preview" : "production"));
  return {
    presets: ["babel-preset-expo"],
    plugins: PREVIEW_BUILD ? [] : [
      ["module-resolver", {
        root: ["./"],
        alias: { "^@/src/simulation$": "./src/simulationAbsent" },
      }],
    ],
  };
};
