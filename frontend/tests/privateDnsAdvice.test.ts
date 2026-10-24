// Private DNS advice: Higgins recommends Automatic; Off and a provider hostname get a prompt.
// Run: node --test tests/privateDnsAdvice.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { privateDnsAdvice, privateDnsMode } from "../src/domain/privateDnsAdvice.ts";
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
