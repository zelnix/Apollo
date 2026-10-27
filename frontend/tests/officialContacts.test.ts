import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { namedOrganisation, officialContactLines, parseOfficialVerdict, parseOfficialVerdicts } from "../src/domain/officialContacts.ts";
import { parseIntelResult } from "../src/domain/intelContract.ts";
import { enforceEgress } from "../src/domain/privacy.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const NAMES = [{ name: "CommBank", aliases: ["commbank", "commonwealth bank", "netbank"] }, { name: "the ATO", aliases: ["ato"] },
  { name: "AusPost", aliases: ["auspost", "australia post"] }];

test("the listed organisation the material names is found as a whole word, earliest first", () => {
  assert.equal(namedOrganisation("Your Commonwealth Bank account is locked", NAMES), "CommBank");
  assert.equal(namedOrganisation("ATO: you owe tax. Australia Post parcel too", NAMES), "the ATO");
  assert.equal(namedOrganisation("Australia Post: your parcel. Not the ATO.", NAMES), "AusPost");
  assert.equal(namedOrganisation("Tomato season is here", NAMES), null);
  assert.equal(namedOrganisation("the ATO", NAMES), "the ATO");
});

test("a number that isn't the organisation's own is a warning, with its published numbers to use instead", () => {
  const verdicts = parseOfficialVerdicts({ verdicts: [
    { kind: "phone", value: "13 22 21", status: "published", name: "CommBank", label: "General enquiries", source_url: "https://www.commbank.com.au/support/contact-us.html" },
    { kind: "phone", value: "0412 345 678", status: "not_published", name: "CommBank",
      use_instead: [{ value: "13 22 21", label: "General enquiries", source_url: "https://www.commbank.com.au/support/contact-us.html" }] },
    { kind: "bogus", status: "nope" },
  ] });
  assert.ok(verdicts);
  assert.equal(verdicts.length, 2, "an unreadable verdict is dropped");
  const lines = officialContactLines(verdicts);
  assert.equal(lines[0].warning, true, "warnings come first");
  assert.equal(lines[0].title, "Not the official number");
  assert.match(lines[0].text, /This says it's from CommBank, but 0412 345 678 isn't one of CommBank's published numbers/);
  assert.deepEqual(lines[0].useInstead, [{ label: "13 22 21 · General enquiries", url: "tel:132221" }]);
  assert.equal(lines[0].source?.url, "https://www.commbank.com.au/support/contact-us.html");
  assert.equal(lines[1].text, "13 22 21 is CommBank's published number (General enquiries).");
});

test("websites and addresses get their own wording", () => {
  const [look, notOfficial, email] = officialContactLines([
    parseOfficialVerdict({ kind: "site", value: "commbank-alerts.net", status: "lookalike", name: "CommBank", domain: "commbank-alerts.net",
      official_domain: "commbank.com.au", detail: "the name has other words added to it" })!,
    parseOfficialVerdict({ kind: "site", value: "bit.ly", status: "not_official", name: "the ATO", domain: "bit.ly", official_domain: "ato.gov.au" })!,
    parseOfficialVerdict({ kind: "email", value: "ato@gmail.com", status: "not_published", name: "the ATO", domains: ["ato.gov.au"], use_instead: [] })!,
  ]);
  assert.equal(look.text, "commbank-alerts.net uses CommBank's name, but it isn't CommBank's website: the name has other words added to it.");
  assert.deepEqual(look.useInstead, [{ label: "Use commbank.com.au, CommBank's own website", url: "https://commbank.com.au" }]);
  assert.equal(notOfficial.text, "This says it's from the ATO, but bit.ly isn't one of the ATO's websites.");
  assert.equal(email.text, "This says it's from the ATO, but ato@gmail.com isn't one of the ATO's addresses (the ATO uses ato.gov.au).");
  assert.equal(email.source, null);
});

test("a link check keeps the directory's verdict and each list's own page", () => {
  const parsed = parseIntelResult({
    verdict: "malicious", coverage: "full", threat_types: ["phishing"], indicator_digest: "d", checked_at: "2026-10-27T00:00:00Z",
    sources: [{ name: "phishtank", status: "match", detail: "Listed", threat_types: ["phishing"], url: "https://phishtank.org/phish_detail.php?phish_id=1" }],
    official: { status: "lookalike", name: "CommBank", domain: "commbank-alerts.net", official_domain: "commbank.com.au" },
  });
  assert.ok(parsed);
  assert.equal(parsed.sources[0].url, "https://phishtank.org/phish_detail.php?phish_id=1");
  assert.equal(parsed.official?.kind, "site");
  assert.equal(parsed.official?.value, "commbank-alerts.net");
});

test("the directory lookup sends contacts only, and a website as its host", () => {
  const out = enforceEgress("official_contacts", { claimed_org: "CommBank", sites: ["https://user:pw@commbank-alerts.net/login?token=abc#x"],
    phones: ["0412 345 678"], emails: ["a@b.example"] });
  assert.deepEqual(out.sites, ["commbank-alerts.net"]);
  assert.throws(() => enforceEgress("official_contacts", { text: "the whole message" }));
  assert.throws(() => enforceEgress("official_contacts", { phones: [42] }));
});

test("registration may say a phone is one of Google's test phones", () => {
  assert.equal(enforceEgress("device_register", { platform: "android", test_lab: true }).test_lab, true);
  const source = read("../src/telemetry/deviceInfo.ts");
  assert.match(source, /isGoogleTestLab/);
  const kotlin = read("../modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt");
  assert.match(kotlin, /"firebase\.test\.lab"/);
});

test("every check result shows the official contacts card", () => {
  const screen = read("../src/components/CheckResultScreen.tsx");
  assert.match(screen, /<OfficialContactsCard verdicts=\{result\.official\} \/>/);
  for (const adapter of ["linkCheckResultAdapter", "messageCheckResultAdapter", "emailCheckResultAdapter", "callCheckResultAdapter", "callRiskCheckResultAdapter"]) {
    assert.match(read(`../src/domain/${adapter}.ts`), /official/, adapter);
  }
});
