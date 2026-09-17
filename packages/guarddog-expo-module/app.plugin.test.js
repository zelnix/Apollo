// Regression test for ensureHttpsBrowsableQuery() in app.plugin.js -- verifies the generated
// AndroidManifest.xml <queries> declaration required for GuardDogExpoModule.listHttpsCapableBrowsers()
// (2026-06 TENTH fix round) without needing the Android SDK/Gradle or a full `expo prebuild`. Run
// with plain `node --test` (same convention as frontend/src/diagnostics/dnsWizardProbeGate.test.ts).
const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureHttpsBrowsableQuery } = require("./app.plugin.js");

test("ensureHttpsBrowsableQuery: adds the https ACTION_VIEW/BROWSABLE query when the manifest has no <queries> at all", () => {
  const manifest = {};
  ensureHttpsBrowsableQuery(manifest);
  assert.equal(manifest.queries.length, 1);
  const intent = manifest.queries[0].intent[0];
  assert.equal(intent.action[0].$["android:name"], "android.intent.action.VIEW");
  assert.equal(intent.category[0].$["android:name"], "android.intent.category.BROWSABLE");
  assert.equal(intent.data[0].$["android:scheme"], "https");
});

test("ensureHttpsBrowsableQuery: is idempotent -- calling twice never duplicates the query", () => {
  const manifest = {};
  ensureHttpsBrowsableQuery(manifest);
  ensureHttpsBrowsableQuery(manifest);
  ensureHttpsBrowsableQuery(manifest);
  assert.equal(manifest.queries.length, 1);
});

test("ensureHttpsBrowsableQuery: detects an already-equivalent query and does not add a duplicate", () => {
  const manifest = {
    queries: [
      {
        intent: [
          {
            action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
            category: [{ $: { "android:name": "android.intent.category.BROWSABLE" } }],
            data: [{ $: { "android:scheme": "https" } }],
          },
        ],
      },
    ],
  };
  ensureHttpsBrowsableQuery(manifest);
  assert.equal(manifest.queries.length, 1);
});

test("ensureHttpsBrowsableQuery: preserves other pre-existing <queries> entries untouched", () => {
  const otherEntry = { package: [{ $: { "android:name": "com.example.other" } }] };
  const manifest = { queries: [otherEntry] };
  ensureHttpsBrowsableQuery(manifest);
  assert.equal(manifest.queries.length, 2);
  assert.deepEqual(manifest.queries[0], otherEntry);
});

test("ensureHttpsBrowsableQuery: never requests the broad QUERY_ALL_PACKAGES permission or a bare <package> query -- scoped narrowly to https ACTION_VIEW/BROWSABLE only", () => {
  const manifest = {};
  ensureHttpsBrowsableQuery(manifest);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /QUERY_ALL_PACKAGES/);
  assert.equal(manifest.queries[0].package, undefined);
});
