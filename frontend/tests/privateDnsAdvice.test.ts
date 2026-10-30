// Private DNS advice: Higgins recommends Automatic; Off and a provider hostname get a prompt.
// Run: node --test tests/privateDnsAdvice.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { privateDnsAdvice, privateDnsMode, privateDnsNote } from "../src/domain/privateDnsAdvice.ts";
import { readability } from "../src/domain/luddish/readability.ts";
import type { PrivateDnsStatus } from "../src/domain/types.ts";

const status = (over: Partial<PrivateDnsStatus>): PrivateDnsStatus => ({
  privateDnsActive: false, privateDnsServer: null, bypassLevel: "none", chromeDoH: "unobservable", explanation: "", ...over,
});

test("Off is prompted towards Automatic, without claiming encryption Apollo's tunnel doesn't add", () => {
  const advice = privateDnsAdvice(status({ mode: "off", modeSource: "android_setting" }))!;
  assert.equal(advice.id, "off");
  assert.match(advice.title, /Set Private DNS to Automatic/);
  assert.match(advice.body, /whenever the network supports it/);
  assert.match(advice.body, /website checks keep working/);
  assert.equal(advice.actionLabel, "Open Private DNS settings");
});

test("a provider hostname is named and explained as going around Apollo", () => {
  const advice = privateDnsAdvice(status({ mode: "hostname", privateDnsActive: true, privateDnsServer: "dns.adguard.com", bypassLevel: "confirmed" }))!;
  assert.equal(advice.id, "hostname");
  assert.match(advice.body, /dns\.adguard\.com/);
  assert.match(advice.body, /never see them/);
  assert.match(advice.body, /Choose Automatic/);
});

test("Automatic needs nothing", () => {
  assert.equal(privateDnsAdvice(status({ mode: "automatic", privateDnsActive: true })), null);
  assert.equal(privateDnsNote(status({ mode: "automatic", privateDnsActive: true })), null);
});

test("Android reports Automatic on a network without encrypted lookups: confirm it, explain the network, never ask again", () => {
  const automatic = status({ mode: "automatic", modeSource: "android_setting", privateDnsActive: false });
  assert.equal(privateDnsAdvice(automatic), null);
  const note = privateDnsNote(automatic)!;
  assert.match(note, /^Private DNS is set to Automatic\. This network doesn’t support encrypted website lookups right now/);
  assert.match(note, /You don’t need to change anything\.$/);
  assert.doesNotMatch(note, /(?:^|\. )(?:Set|Choose|Switch)\b/);
  const r = readability(note);
  assert.deepEqual(r.hard, []);
  assert.ok(r.grade <= 8, `grade ${r.grade}`);
  // Every other reading gets no note.
  for (const mode of ["off", "hostname", "not_in_use", "unknown", "unsupported"] as const) assert.equal(privateDnsNote(status({ mode })), null, mode);
  assert.equal(privateDnsNote(null), null);
});

test("a failed read (unobservable) is unknown — never 'not in use', so nobody is told to set Automatic", () => {
  // The shape the adapter returned before it carried a mode, and the shape it returns now.
  const legacyFailure = status({ bypassLevel: "unobservable", explanation: "Apollo couldn't read this device's Private DNS setting." });
  assert.equal(privateDnsMode(legacyFailure), "unknown");
  assert.equal(privateDnsAdvice(legacyFailure), null);
  assert.equal(privateDnsAdvice(status({ mode: "unknown", modeSource: null, bypassLevel: "unobservable" })), null);
});

test("when Android can't tell Off from Automatic, the prompt says exactly that", () => {
  const advice = privateDnsAdvice(status({ mode: "not_in_use", modeSource: "network_state" }))!;
  assert.equal(advice.id, "not_in_use");
  assert.match(advice.body, /either Off, or Automatic on a network that doesn’t support it/);
  assert.doesNotMatch(advice.title, /is Off/);
});

test("nothing read, unreadable or unsupported means no prompt — never a guess", () => {
  assert.equal(privateDnsAdvice(null), null);
  assert.equal(privateDnsAdvice(undefined), null);
  assert.equal(privateDnsAdvice(status({ mode: "unknown", bypassLevel: "unobservable" })), null);
  assert.equal(privateDnsAdvice(status({ mode: "unsupported", bypassLevel: "unobservable" })), null);
});

test("builds that only report active/server still get a truthful mode", () => {
  assert.equal(privateDnsMode(status({ privateDnsServer: "dns.google", privateDnsActive: true })), "hostname");
  assert.equal(privateDnsMode(status({ privateDnsActive: true })), "automatic");
  assert.equal(privateDnsMode(status({ privateDnsActive: false })), "not_in_use");
});
