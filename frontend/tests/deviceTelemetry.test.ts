import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { connectionStatus } from "../src/family-help/connection.ts";
import { enforceEgress } from "../src/domain/privacy.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("registration and heartbeat may carry what the device is, and nothing else new", () => {
  const payload = enforceEgress("device_register", {
    platform: "android", adapter_mode: "native", app_version: "1.1.0", tz_offset_minutes: 600, locale: "en-AU",
    manufacturer: "Samsung", model: "SM-S921B", os_name: "Android", os_version: "14", country: "AU", installed_at: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(payload.model, "SM-S921B");
  assert.throws(() => enforceEgress("device_register", { ...payload, serial: "R5CX" }));
});

test("a feature-use report carries only which feature and which article or alert", () => {
  assert.deepEqual(enforceEgress("device_activity", { kind: "learn_read", item: "romance-scams" }), { kind: "learn_read", item: "romance-scams" });
  assert.throws(() => enforceEgress("device_activity", { kind: "learn_read", item: "x", title: "Romance scams" }));
});

test("the country is the region setting's two-letter code, never a numeric region", () => {
  const source = read("../src/telemetry/deviceInfo.ts");
  assert.match(source, /\/\^\[A-Z\]\{2\}\$\//);
  assert.match(source, /getLocales\(\)\[0\]\?\.regionCode/);
  assert.match(source, /Platform\.OS === "web"\) return undefined/);
});

test("each feature reports its use: Device Check, Learn article, scam alert", () => {
  assert.match(read("../app/recheck.tsx"), /reportActivity\("device_check"\)/);
  assert.match(read("../app/first-check.tsx"), /reportActivity\("device_check"\)/);
  assert.match(read("../app/higgins/learning/[slug].tsx"), /reportActivity\("learn_read", String\(slug\)\)/);
  assert.match(read("../app/higgins/scam/[id].tsx"), /reportActivity\("scam_alert_read", a\.url\)/);
});

test("Family Help shows how the picture travels, on both phones", () => {
  assert.equal(connectionStatus("direct")?.label, "Direct connection");
  assert.equal(connectionStatus("relayed")?.label, "Relayed connection");
  assert.equal(connectionStatus("reconnecting")?.label, "Reconnecting");
  assert.equal(connectionStatus(null), null);
  for (const screen of ["../app/family/help/active.tsx", "../app/family/help/view.tsx"]) {
    assert.match(read(screen), /<FamilyHelpConnectionStatus sessionId=\{session\?\.sessionId\} generation=\{session\?\.generation\} \/>/);
  }
});
