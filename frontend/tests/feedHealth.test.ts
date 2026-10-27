// Feed Health presentation: labels, tones, relative times and the summary headline.
// Run: node --test tests/feedHealth.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { contentTypeLabel, FEED_STATUS_LABEL, feedStatusTone, recordCountLabel, relativeAge, relayLabel, summaryHeadline } from "../src/domain/feedHealth.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60000).toISOString();

test("status badges read Healthy / Stale / Failing in resting / growling / barking tones", () => {
  assert.deepEqual(FEED_STATUS_LABEL, { healthy: "Healthy", stale: "Stale", failing: "Failing" });
  assert.equal(feedStatusTone("healthy"), "resting");
  assert.equal(feedStatusTone("stale"), "growling");
  assert.equal(feedStatusTone("failing"), "barking");
});

test("relative age is plain English and never invents a time", () => {
  assert.equal(relativeAge(null, NOW), "Never");
  assert.equal(relativeAge("not a date", NOW), "Never");
  assert.equal(relativeAge(ago(0), NOW), "just now");
  assert.equal(relativeAge(ago(1), NOW), "1 minute ago");
  assert.equal(relativeAge(ago(59), NOW), "59 minutes ago");
  assert.equal(relativeAge(ago(60), NOW), "1 hour ago");
  assert.equal(relativeAge(ago(23 * 60 + 59), NOW), "23 hours ago");
  assert.equal(relativeAge(ago(24 * 60), NOW), "1 day ago");
  assert.equal(relativeAge(ago(3 * 24 * 60), NOW), "3 days ago");
  assert.equal(relativeAge(new Date(NOW + 60000).toISOString(), NOW), "just now", "clock skew never shows a negative age");
  assert.equal(relativeAge(null, NOW, "at an unknown time"), "at an unknown time");
});

test("record counts distinguish 'never loaded' from zero", () => {
  assert.equal(recordCountLabel(null), "No records loaded yet");
  assert.equal(recordCountLabel(0), "0 records in the last sync");
  assert.equal(recordCountLabel(1), "1 record in the last sync");
  assert.equal(recordCountLabel(99), "99 records in the last sync");
});

test("content types are spelled out", () => {
  assert.equal(contentTypeLabel("live_alert"), "Live alerts");
  assert.equal(contentTypeLabel("official_advice"), "Official advice");
  assert.equal(contentTypeLabel("threat_listing"), "Threat list");
  assert.equal(contentTypeLabel("threat_knowledge"), "Threat knowledge");
  assert.equal(contentTypeLabel("something_new"), "Government feed");
});

test("relayed feeds say they are read through the Internet Archive, with the copy's age", () => {
  assert.equal(relayLabel({ relay: null, relayCopyAt: null }, NOW), null);
  assert.equal(relayLabel({ relay: undefined, relayCopyAt: undefined }, NOW), null);
  assert.equal(relayLabel({ relay: "internet_archive", relayCopyAt: null }, NOW), "Read through the Internet Archive");
  assert.equal(relayLabel({ relay: "internet_archive", relayCopyAt: ago(120) }, NOW), "Read through the Internet Archive · copy made 2 hours ago");
});

test("summary headline counts every feed that is not healthy", () => {
  const summary = (healthy: number, stale: number, failing: number) => ({ summary: { healthy, stale, failing, total: healthy + stale + failing } });
  assert.equal(summaryHeadline(summary(0, 0, 0)), "No government feeds are switched on");
  assert.equal(summaryHeadline(summary(1, 0, 0)), "The feed is healthy");
  assert.equal(summaryHeadline(summary(7, 0, 0)), "All 7 feeds are healthy");
  assert.equal(summaryHeadline(summary(5, 0, 2)), "2 of 7 feeds need attention");
  assert.equal(summaryHeadline(summary(6, 1, 0)), "1 of 7 feeds needs attention");
});
