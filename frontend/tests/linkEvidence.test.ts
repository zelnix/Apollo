// Link and website evidence — levels, what each lookup let ApolloSG examine, signals, re-checks in the same case.
// Run: node --test tests/linkEvidence.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyseUrlLocally } from "../src/domain/risk.ts";
import { mergeProfiles, upgrades } from "../src/domain/triage/evidenceProfile.ts";
import { buildLinkProfile, buildSiteGateProfile, linkLevelFor, sameLink } from "../src/domain/triage/linkEvidence.ts";

const SB = { name: "google_safe_browsing", status: "clear", check: "reputation" };
const LIST = { name: "apollo_threat_list", status: "clear", check: "reputation" };
const DOMAIN = { domain: "bit.ly", registrar: "Example Registrar", registered_at: "2008-01-01T00:00:00Z", registrant_organization: null, rdap_server: null, age_days: 6500, newly_registered: false, available: true, error: null };
const NEW_DOMAIN = { ...DOMAIN, domain: "commbank-verify.top", age_days: 3, newly_registered: true, registered_at: "2026-06-11T00:00:00Z" };

const status = (p: ReturnType<typeof buildLinkProfile>, id: string) => p.capabilities.find((c) => c.id === id)?.status;

test("levels: nothing answered → as given; answered but not followed → checked; followed → destination followed", () => {
  assert.equal(linkLevelFor(null, true), "as_given");
  assert.equal(linkLevelFor({ verdict: "unknown", coverage: "none", sources: [] }, false), "as_given");
  assert.equal(linkLevelFor({ verdict: "clean", coverage: "partial", sources: [SB, { name: "redirect_expansion", status: "unavailable", check: "final_destination", detail: "timed out" }] }, false), "checked");
  assert.equal(linkLevelFor({ verdict: "clean", coverage: "full", sources: [SB] }, false), "followed");
});

test("a failed lookup claims nothing: every lookup row is 'Couldn't be verified', with why", () => {
  const p = buildLinkProfile({ via: "pasted", local: analyseUrlLocally("https://example.org/a"), intel: null, lookupFailed: true, failureText: "The reputation service took too long to answer." });
  assert.equal(p.level, "as_given");
  assert.equal(p.label, "Link as given");
  for (const id of ["redirect_chain", "final_destination", "domain_registration", "reputation"]) assert.equal(status(p, id), "unavailable", id);
  assert.equal(p.capabilities.find((c) => c.id === "reputation")?.note, "The reputation service took too long to answer.");
  assert.equal(status(p, "original_url"), "observed");
});

test("a preview sample link is checked exactly as a pasted link — only tagged Simulated", () => {
  const args = { via: "pasted" as const, local: analyseUrlLocally("https://www.servicesaustralia.gov.au/mygov"), intel: null, lookupFailed: true };
  const sample = buildLinkProfile({ ...args, simulated: true });
  const live = buildLinkProfile(args);
  assert.equal(sample.simulated, true);
  assert.equal(live.simulated, undefined);
  assert.deepEqual([sample.level, sample.label, sample.viaLabel, sample.capabilities, sample.signals],
    [live.level, live.label, live.viaLabel, live.capabilities, live.signals]);
});

test("followed shortener: redirect chain observed, registry and lists recorded (not verified), signal for a different site", () => {
  const local = analyseUrlLocally("https://bit.ly/x1");
  const intel = { verdict: "clean" as const, coverage: "full", sources: [SB, LIST], redirect_chain: ["bit.ly", "commbank-verify.top"], final_url: "https://commbank-verify.top/login", domain_info: DOMAIN };
  const p = buildLinkProfile({ via: "message", local, intel, lookupFailed: false });
  assert.equal(p.level, "followed");
  assert.equal(p.viaLabel, "Link from a message or email");
  assert.equal(status(p, "redirect_chain"), "observed");
  assert.match(p.capabilities.find((c) => c.id === "redirect_chain")!.value!, /bit\.ly → commbank-verify\.top/);
  assert.equal(status(p, "domain_registration"), "recorded");
  assert.equal(status(p, "reputation"), "recorded");
  assert.equal(p.capabilities.find((c) => c.id === "reputation")!.value, "No match on 2 lists that answered");
  assert.equal(status(p, "tls_certificate"), "unavailable");
  const ids = p.signals.map((s) => s.id);
  assert.ok(ids.includes("redirects_elsewhere"));
  assert.ok(!ids.includes("shortener"), "once followed, a shortener no longer hides where it leads");
});

test("a newly registered lookalike raises signals from the address and the registry — never a verdict on their own", () => {
  const local = analyseUrlLocally("https://commbank-verify.top/login");
  const p = buildLinkProfile({ via: "pasted", local, intel: { verdict: "clean", coverage: "full", sources: [SB], domain_info: NEW_DOMAIN }, lookupFailed: false });
  const ids = p.signals.map((s) => s.id);
  assert.ok(ids.includes("brand_lookalike") && ids.includes("risky_tld") && ids.includes("newly_registered"));
  assert.match(p.signals.find((s) => s.id === "newly_registered")!.text, /commbank-verify\.top was registered 3 days ago/);
});

test("a listed link says how many lists listed it", () => {
  const p = buildLinkProfile({ via: "pasted", local: analyseUrlLocally("http://testsafebrowsing.appspot.com/s/phishing.html"),
    intel: { verdict: "malicious", threat_types: ["SOCIAL_ENGINEERING"], coverage: "full", sources: [{ ...SB, status: "match" }, LIST] }, lookupFailed: false });
  assert.equal(p.capabilities.find((c) => c.id === "reputation")!.value, "Listed as social engineering by 1 of 2 lists");
});

test("re-check: a stronger result upgrades the case and keeps the history; sameLink guards the case", () => {
  const local = analyseUrlLocally("https://example.org/a");
  const first = buildLinkProfile({ via: "pasted", local, intel: null, lookupFailed: true, at: "2026-06-14T10:00:00.000Z" });
  const again = buildLinkProfile({ via: "recheck", local, intel: { verdict: "clean", coverage: "full", sources: [SB] }, lookupFailed: false, at: "2026-06-14T11:00:00.000Z" });
  const merged = mergeProfiles(first, again);
  assert.equal(merged.level, "followed");
  assert.deepEqual(merged.history.map((h) => h.level), ["as_given", "followed"]);
  assert.equal(upgrades(merged).pop()?.to.label, "Destination followed");
  assert.equal(sameLink({ local_indicator: "https://example.org/a" }, "https://example.org/a", "example.org"), true);
  assert.equal(sameLink({ indicator_host: "www.example.org" }, "https://example.org/b", "example.org"), true);
  assert.equal(sameLink({ indicator_host: "other.com" }, "https://example.org/a", "example.org"), false);
});

test("Site Gate: the connection is ApolloSG's own observation; the page and its path were never seen", () => {
  const p = buildSiteGateProfile({ domain: "phishing.apollo.test", observedAt: "2026-06-14T10:00:00.000Z", confirmed: true });
  assert.equal(p.label, "Connection seen by Site Gate");
  assert.equal(p.viaLabel, "Site Gate on this phone");
  assert.equal(p.capabilities.find((c) => c.id === "connection")?.status, "verified");
  assert.equal(p.capabilities.find((c) => c.id === "block")?.status, "verified");
  assert.equal(p.capabilities.find((c) => c.id === "final_destination")?.status, "unavailable");
  assert.equal(buildSiteGateProfile({ domain: "x.test", observedAt: "2026-06-14T10:00:00.000Z", confirmed: false }).capabilities.find((c) => c.id === "block")?.status, "recorded");
});
