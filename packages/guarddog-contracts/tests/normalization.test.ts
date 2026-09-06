import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canonicalizeHost, sanitizeUrl } from "../src/normalization.ts";

const root = new URL("../../../security/test-vectors/normalization/", import.meta.url);
const hostVectors = JSON.parse(readFileSync(new URL("host_vectors.json", root), "utf8")).vectors;
const urlVectors = JSON.parse(readFileSync(new URL("url_vectors.json", root), "utf8")).vectors;

test("host canonicalization parity", () => {
  for (const v of hostVectors) {
    assert.equal(canonicalizeHost(v.input), v.expected, `${v.note}: ${JSON.stringify(v.input)}`);
  }
});

test("url sanitization parity", () => {
  for (const v of urlVectors) {
    const r = sanitizeUrl(v.input);
    assert.equal(r !== null, v.analyzable, v.input);
    assert.equal(r ? r.sanitizedUrl : null, v.sanitizedUrl, v.input);
    assert.equal(r ? r.host : null, v.host, v.input);
  }
});

test("original candidate remains analyzable while sanitizedUrl drops secrets", () => {
  const r = sanitizeUrl("https://user:pw@example.com/login?token=SECRET#frag");
  assert.ok(r);
  assert.equal(r.original, "https://user:pw@example.com/login?token=SECRET#frag");
  assert.equal(r.sanitizedUrl, "https://example.com/login");
  assert.ok(r.hadQuery && r.hadFragment && r.hadUserinfo);
});
