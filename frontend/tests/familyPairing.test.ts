import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const family = read("../app/family.tsx");

test("Family sharing pairs only with a code: no email invitation, no phone number, no intro line", () => {
  assert.doesNotMatch(family, /family\/guardians|Send invitation|family-email-card|Email alerts/);
  assert.doesNotMatch(family, /family-owner-phone|Your device number \(optional\)/);
  assert.doesNotMatch(family, /Share only Barking and Biting alerts/);
  assert.match(family, /apiPost<PairCode>\("\/family\/pair", "family", \{ device_id: deviceId, owner_name: owner\.trim\(\) \}\)/);
});

test("the code is 6 digits, shows when it expires, and disappears when it does", () => {
  assert.match(family, /keyboardType="number-pad" maxLength=\{6\}/);
  assert.match(family, /setCode\(v\.replace\(\/\\D\/g, ""\)\.slice\(0, 6\)\)/);
  assert.match(family, /disabled=\{!\/\^\\d\{6\}\$\/\.test\(code\) \|\| link\.isPending\}/);
  assert.match(family, /Works once\. Expires in 15 minutes, at/);
  assert.match(family, /setTimeout\(expire, left\)/);
});

test("Threats links to family alerts next to patrol history, landing on the alerts section", () => {
  const threats = read("../app/(tabs)/patrol.tsx");
  assert.match(threats, /testID="threats-history-link"[\s\S]*testID="threats-family-alerts-link"/);
  assert.match(threats, /router\.push\("\/family\?focus=alerts"\)/);
  assert.match(family, /focus === "alerts"/);
  assert.match(family, /testID="family-alerts-section"/);
});
