import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { findRuleForHost, jcsCanonicalize, unsignedEnvelope, validateSignedBundleShape } from "../src/ruleBundle.ts";

const root = new URL("../../../security/test-vectors/", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

test("TS canonical bytes are identical to the RFC 8785 reference fixture", () => {
  const envelope = read("jcs/unsigned_envelope.json");
  const expectedHex = readFileSync(new URL("jcs/canonical_bytes.hex", root), "utf8").trim();
  assert.equal(Buffer.from(jcsCanonicalize(envelope), "utf8").toString("hex"), expectedHex);
});

test("payloadHash equals sha256 of canonical payload", () => {
  const bundle = validateSignedBundleShape(read("signing/valid_bundle.json"));
  assert.ok(bundle);
  const hash = createHash("sha256").update(Buffer.from(jcsCanonicalize(bundle.payload), "utf8")).digest("hex");
  assert.equal(hash, bundle.payloadHash);
  const tampered = validateSignedBundleShape(read("signing/tampered_payload_bundle.json"));
  assert.ok(tampered);
  const badHash = createHash("sha256").update(Buffer.from(jcsCanonicalize(tampered.payload), "utf8")).digest("hex");
  assert.notEqual(badHash, tampered.payloadHash);
});

test("unsigned envelope excludes signature and canonicalizes identically", () => {
  const bundle = validateSignedBundleShape(read("signing/valid_bundle.json"));
  assert.ok(bundle);
  assert.equal(jcsCanonicalize(unsignedEnvelope(bundle)), jcsCanonicalize(read("jcs/unsigned_envelope.json")));
});

test("strict schema rejects extras, wrong types and floats", () => {
  const valid = read("signing/valid_bundle.json");
  assert.ok(validateSignedBundleShape(valid));
  assert.equal(validateSignedBundleShape({ ...valid, extra: 1 }), null);
  assert.equal(validateSignedBundleShape({ ...valid, bundleVersion: "3" }), null);
  assert.equal(validateSignedBundleShape({ ...valid, bundleVersion: 3.5 }), null);
  assert.equal(validateSignedBundleShape({ ...valid, payloadHash: "abc" }), null);
  assert.throws(() => jcsCanonicalize({ a: 1.5 }));
});

test("rule match is exact-host against accepted bundle", () => {
  const bundle = validateSignedBundleShape(read("signing/valid_bundle.json"))!;
  assert.equal(findRuleForHost(bundle, "m1-block-test.guarddog.example")?.action, "block");
  assert.equal(findRuleForHost(bundle, "sub.m1-block-test.guarddog.example"), null);
});

test("JCS edge cases: escaping and UTF-16 key order", () => {
  assert.equal(jcsCanonicalize({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(jcsCanonicalize({ s: 'ü\n"\\' }), '{"s":"ü\\n\\"\\\\"}');
  assert.equal(jcsCanonicalize({ "\u{1F600}": 1, "\uFB01": 2 }), '{"\u{1F600}":1,"\uFB01":2}');
});
