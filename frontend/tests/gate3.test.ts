// Gate 3 scenario benchmark (W01–W20, address-level scenarios). Run: cd frontend && yarn test:gate3
// Page-content scenarios (W08/W09/W10/W12/W16/W18) need a page screenshot and are Phase B.
import assert from "node:assert/strict";
import { test } from "node:test";

import { assessBrand, verifyWebsite } from "../src/domain/brand.ts";
import { decide } from "../src/domain/decision.ts";
import { analyseUrlLocally } from "../src/domain/risk.ts";
import type { IntelResult } from "../src/domain/types.ts";

const clean: IntelResult = { verdict: "clean", threat_types: [], sources: [{ name: "google_safe_browsing", status: "clear", detail: "" }], indicator_digest: "x", checked_at: "", cached: false, coverage: "full" };
const malicious: IntelResult = { ...clean, verdict: "malicious", threat_types: ["SOCIAL_ENGINEERING"], sources: [{ name: "google_safe_browsing", status: "match", detail: "" }] };
const run = (url: string, intel: IntelResult | null = clean, trusted = false) => decide(analyseUrlLocally(url), intel, trusted);

const cases: { id: string; url: string; intel?: IntelResult | null; expect: string[] }[] = [
  { id: "W01 known phishing", url: "http://testsafebrowsing.appspot.com/s/phishing.html", intel: malicious, expect: ["barking"] },
  { id: "W02 fake bank login", url: "https://commbank-secure-login-verify.xyz/account", expect: ["barking"] },
  { id: "W03 fake Microsoft login", url: "https://microsoft-docs-share.top/login", expect: ["barking"] },
  { id: "W04 redirect chain to malicious", url: "https://bit.ly/3abcdef", intel: { ...malicious, redirect_chain: ["bit.ly", "evil-example.top"], final_url: "https://evil-example.top/x" }, expect: ["barking"] },
  { id: "W05 shortener to safe destination", url: "https://bit.ly/3abcdef", intel: { ...clean, redirect_chain: ["bit.ly", "drive.google.com"], final_url: "https://drive.google.com/x" }, expect: ["resting", "ears_up"] },
  { id: "W06 lookalike paypa1", url: "https://paypa1-secure.com/signin", expect: ["barking", "growling", "ears_up"] },
  { id: "W06b homograph micr0soft", url: "https://micr0soft-account.net/verify", expect: ["barking", "growling"] },
  { id: "W07 unknown new site, weak signals", url: "https://my-new-plumbing-biz.online/quote", intel: { ...clean, verdict: "unknown", coverage: "partial" }, expect: ["resting", "ears_up"] },
  { id: "W11 fake payment page (brand in host)", url: "https://auspost-redelivery-fee.top/pay", expect: ["barking", "growling"] },
  { id: "W17 credential harvesting", url: "http://192.168.1.10/paypal-login-verify", expect: ["barking", "growling"] },
  { id: "W19 legit site with tracking params", url: "https://www.abc.net.au/news/story?utm_source=x&utm_campaign=y", expect: ["resting"] },
  { id: "W20 legitimate unfamiliar site", url: "https://www.smallbakerysydney.com.au/menu", expect: ["resting", "ears_up"] },
  { id: "Official bank domain is NOT flagged", url: "https://www.commbank.com.au/netbank", expect: ["resting"] },
  { id: "Official subdomain is NOT flagged", url: "https://login.microsoftonline.com/common/oauth2", expect: ["resting"] },
];

for (const c of cases) {
  test(c.id, () => {
    const d = run(c.url, c.intel === undefined ? clean : c.intel);
    assert.ok(c.expect.includes(d.state), `${c.id}: expected ${c.expect.join("/")} got ${d.state}: ${d.headline}`);
  });
}

test("Brand engine: mismatch + official detection", () => {
  assert.equal(assessBrand("commbank-secure-login-verify.xyz").mismatch, true);
  assert.equal(assessBrand("www.commbank.com.au").isOfficial, true);
  assert.equal(assessBrand("paypa1-secure.com").homograph, true);
  assert.equal(assessBrand("smallbakerysydney.com.au").claimed, null);
});

test("Verify Website never cites the suspicious site as proof and says 'do not match'", () => {
  const v = verifyWebsite("commbank-login-example.test");
  assert.equal(v.matches, false);
  assert.match(v.title, /do not match/i);
  assert.ok(v.lines.some((l) => l.includes("commbank.com.au")));
});

test("Unknown ≠ malicious: no barking without evidence; confirmed threats never downgraded by trust", () => {
  assert.notEqual(run("https://my-new-plumbing-biz.online/quote", { ...clean, verdict: "unknown", coverage: "partial" }).state, "barking");
  assert.equal(run("http://testsafebrowsing.appspot.com/s/phishing.html", malicious, true).state, "barking");
});

test("False-positive gate: 0 barks on clean set; detection ≥ 90% on threat set", () => {
  const cleanSet = cases.filter((c) => c.expect.includes("resting"));
  const threatSet = cases.filter((c) => !c.expect.includes("resting"));
  assert.equal(cleanSet.filter((c) => run(c.url, c.intel === undefined ? clean : c.intel).state === "barking").length, 0);
  const detected = threatSet.filter((c) => run(c.url, c.intel === undefined ? clean : c.intel).state !== "resting").length;
  assert.ok(detected / threatSet.length >= 0.9);
});
