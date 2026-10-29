// Every time Apollo shows is on the 12-hour clock, in the device's own time zone.
import { test } from "node:test";
import assert from "node:assert/strict";

import { installTwelveHourClock, twelveHour } from "../src/utils/twelveHourClock.ts";

test("options gain the 12-hour clock, and a 2-digit hour loses its leading zero", () => {
  assert.deepEqual(twelveHour(undefined), { hour12: true });
  assert.deepEqual(twelveHour({ hour: "2-digit", minute: "2-digit" }), { hour: "numeric", minute: "2-digit", hour12: true });
  assert.deepEqual(twelveHour({ hour12: false }), { hour12: false }, "a call that chooses its own clock keeps it");
  assert.deepEqual(twelveHour({ hourCycle: "h23" }), { hourCycle: "h23" });
});

test("once installed, every Date time reads on the 12-hour clock in the device's time zone", () => {
  installTwelveHourClock();
  installTwelveHourClock(); // a second call changes nothing
  const afternoon = new Date(2026, 9, 25, 15, 16); // local time
  assert.match(afternoon.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), /^3:16\s?pm$/i);
  assert.match(afternoon.toLocaleString("en-GB"), /3:16:00\s?pm/i);
  assert.match(new Date(2026, 9, 25, 9, 5).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" }), /^9:05\s?am$/i);
  assert.equal(afternoon.toLocaleDateString("en-GB"), "25/10/2026", "dates are unchanged");
});
