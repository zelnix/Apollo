// Australian carriers' scam blocking: one Device Protection row, only on phones set to Australia.
// Run: node --test tests/auCarrierProtection.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_SECURITY_READ, previewProtectionRows, securityProtectionRows } from "../src/domain/deviceSecurityCatalogue.ts";
import { groupDeviceProtections } from "../src/domain/deviceProtectionTypes.ts";

const NOW = Date.parse("2026-10-26T00:00:00.000Z");
const phone = (country?: string | null) => ({ manufacturer: "samsung", osVersion: "15", model: "SM-S921B", country });
const carrierRow = (platform: "android" | "ios", country?: string | null) =>
  securityProtectionRows(platform, EMPTY_SECURITY_READ, NOW, phone(country)).find((r) => r.id === "au_carrier_scam_blocking");

test("Australian phones get one row covering Telstra, Optus and Vodafone", () => {
  for (const platform of ["android", "ios"] as const) {
    const row = carrierRow(platform, "AU");
    assert.ok(row, platform);
    assert.equal(row!.title, "Your mobile carrier’s scam blocking");
    const steps = row!.guidance!.steps.join(" ");
    for (const carrier of ["Telstra", "Optus", "Vodafone"]) assert.match(steps, new RegExp(carrier));
    assert.match(steps, /Warning: Potential Fraud/);
    assert.match(steps, /scamwatch\.gov\.au/);
  }
});

test("phones outside Australia, or with no region, don't get it", () => {
  assert.equal(carrierRow("android", "US"), undefined);
  assert.equal(carrierRow("ios", "NZ"), undefined);
  assert.equal(carrierRow("android", null), undefined);
  assert.equal(carrierRow("android"), undefined);
});

test("it never claims a state, never says 'Needs checking', and has nothing to open in settings", () => {
  const row = carrierRow("android", "AU")!;
  assert.equal(row.state, "not_verifiable");
  assert.equal(row.optional, true);
  assert.equal(row.guidance!.action, undefined);
  assert.match(row.detail, /inside its network/);
  const groups = groupDeviceProtections([row]);
  assert.deepEqual(groups.needsChecking, []);
  assert.equal(groups.optional[0].id, "au_carrier_scam_blocking");
});

test("the browser preview still lists it, saying it couldn't be read there", () => {
  const row = previewProtectionRows().find((r) => r.id === "au_carrier_scam_blocking");
  assert.ok(row && row.state === "not_readable_here");
});
