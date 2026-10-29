// Evidence levels for messages, calls, files, apps and images — what each check had, what it could examine, and the
// signals it raised. Run: node --test tests/sourceEvidence.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyseFile } from "../src/domain/fileAnalysis.ts";
import { buildAppProfile } from "../src/domain/triage/appEvidence.ts";
import { buildCallProfile, callLevelFor } from "../src/domain/triage/callEvidence.ts";
import { evidenceStrength, mergeProfiles, upgrades } from "../src/domain/triage/evidenceProfile.ts";
import { buildFileProfile, fileLevelFor } from "../src/domain/triage/fileEvidence.ts";
import { buildImageProfile } from "../src/domain/triage/imageEvidence.ts";
import { buildMessageProfile } from "../src/domain/triage/messageEvidence.ts";

const cap = (p: { capabilities: { id: string; status: string; value: string | null; note: string | null }[] }, id: string) => p.capabilities.find((c) => c.id === id)!;
const ids = (p: { signals: { id: string }[] }) => p.signals.map((s) => s.id);

test("message levels follow how it reached ApolloSG; who really sent it is never verified", () => {
  const base = { sender: "AusPost", signals: {}, urls: [], phones: [] };
  assert.equal(buildMessageProfile({ ...base, via: "pasted" }).label, "Pasted text");
  assert.equal(buildMessageProfile({ ...base, via: "screenshot" }).label, "Screenshot");
  assert.equal(buildMessageProfile({ ...base, via: "shared" }).rank, 2);
  const inbox = buildMessageProfile({ ...base, via: "inbox", receivedAt: "2026-06-14T10:00:00.000Z" });
  assert.equal(inbox.label, "Read from your messages");
  assert.equal(inbox.rank, 3);
  assert.equal(cap(inbox, "sender").status, "recorded");
  assert.equal(cap(inbox, "timestamp").status, "recorded");
  const pasted = buildMessageProfile({ ...base, via: "pasted" });
  assert.equal(cap(pasted, "sender").status, "observed");
  assert.equal(cap(pasted, "timestamp").status, "unavailable");
  for (const p of [pasted, inbox]) {
    assert.equal(cap(p, "platform_provenance").status, "unavailable");
    assert.equal(cap(p, "attachments").status, "unavailable");
  }
});

test("a preview sample is processed exactly as the source it stands in for — only tagged Simulated", () => {
  const base = { sender: "AusPost", signals: {}, urls: [], phones: [] };
  const { simulated, ...sample } = buildMessageProfile({ ...base, via: "inbox", simulated: true });
  const { at: _a, history: _h, ...live } = buildMessageProfile({ ...base, via: "inbox" });
  assert.equal(simulated, true);
  assert.deepEqual({ ...sample, at: undefined, history: undefined }, { ...live, at: undefined, history: undefined });
  assert.equal(sample.label, "Read from your messages");
  assert.equal(buildMessageProfile({ ...base, via: "inbox" }).simulated, undefined, "a real input is never tagged");
  // The tag survives a merge either way round.
  assert.equal(mergeProfiles(buildMessageProfile({ ...base, via: "inbox", simulated: true }), buildMessageProfile({ ...base, via: "pasted" })).simulated, true);
  const a = analyseFile({ name: "Invoice.pdf", size: 10, mime: "application/pdf", headBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), textSample: "", source: "email" });
  const file = buildFileProfile({ via: "picked", simulated: true, name: "Invoice.pdf", analysis: a, inspected: true });
  assert.equal(file.label, buildFileProfile({ via: "picked", name: "Invoice.pdf", analysis: a, inspected: true }).label);
  assert.equal(file.viaLabel, "File chosen on this device");
  assert.equal(file.simulated, true);
});

test("message links and numbers: checked, partly checked or not checked — and gaps become signals", () => {
  const p = buildMessageProfile({
    via: "pasted", sender: "", signals: { platformSwitch: true, callbackNumber: "1300 000 000" },
    urls: [{ coverage: "full", verdict: "malicious" }, { coverage: "none", failure: "timeout" }], phones: [{ decision: "unknown" }],
  });
  assert.equal(cap(p, "sender").status, "unavailable");
  assert.equal(cap(p, "links").status, "recorded");
  assert.equal(cap(p, "links").value, "1 link checked, 1 flagged");
  assert.match(cap(p, "links").note!, /1 of 2 links couldn't be checked/);
  assert.equal(cap(p, "numbers").status, "unavailable");
  assert.deepEqual(ids(p), ["platform_switch", "callback_number", "links_unchecked", "numbers_unchecked"]);
  assert.equal(cap(buildMessageProfile({ via: "pasted", sender: "x", signals: {}, urls: [], phones: [] }), "links").value, "None");
});

test("a re-check keeps the case's message level and records itself in the history", () => {
  const first = buildMessageProfile({ via: "inbox", sender: "+61400000000", receivedAt: "2026-06-14T10:00:00.000Z", signals: {}, urls: [], phones: [], at: "2026-06-14T10:00:00.000Z" });
  const again = buildMessageProfile({ via: "recheck", level: first.level, sender: "+61400000000", signals: {}, urls: [], phones: [], at: "2026-06-14T11:00:00.000Z" });
  const merged = mergeProfiles(first, again);
  assert.equal(merged.level, "inbox");
  assert.equal(merged.history.length, 2);
  assert.equal(upgrades(merged).length, 0);
});

test("call levels: described → number only (lookup failed) → number checked → screened call", () => {
  const rep = { decision: "avoid" as const, fraud_score: 92, recent_abuse: true, voip: true, valid: true, line_type: "VOIP", carrier: "Example Telecom" };
  assert.equal(callLevelFor({ via: "described", reputation: null }), "described");
  assert.equal(callLevelFor({ via: "entered", reputation: { ...rep, decision: "unknown" } }), "number_only");
  assert.equal(callLevelFor({ via: "entered", reputation: rep }), "number_checked");
  assert.equal(callLevelFor({ via: "screened", reputation: rep, screenedAt: "2026-06-14T10:00:00.000Z" }), "screened_call");
  const p = buildCallProfile({ via: "screened", number: "+61 2 0000 0000", reputation: rep, screenedAt: "2026-06-14T10:00:00.000Z", carrierWarning: true });
  assert.equal(cap(p, "caller_id").status, "unavailable", "caller ID is never verified");
  assert.equal(cap(p, "timestamp").status, "verified");
  assert.equal(cap(p, "screening_result").status, "verified");
  assert.equal(cap(p, "reputation").status, "recorded");
  assert.match(cap(p, "reputation").value!, /strong fraud signals · fraud score 92\/100 · recent abuse reported/);
  assert.deepEqual(ids(p), ["voip", "recent_abuse", "carrier_warning"]);
});

test("a described call says what the caller asked for and never claims a lookup", () => {
  const p = buildCallProfile({ via: "described", number: null, reputation: null, asks: ["remote", "code"], brand: "Telstra" });
  assert.equal(p.label, "Described by you");
  assert.equal(cap(p, "number").status, "unavailable");
  assert.match(cap(p, "reputation").note!, /doesn't look the number up for a described call/);
  assert.deepEqual(ids(p), ["remote_ask", "secret_ask", "brand_claim"]);
});

test("a screened call stays the case's level when a later re-check only gets the number checked", () => {
  const rep = { decision: "review" as const, fraud_score: 60, recent_abuse: false, voip: false, line_type: "mobile", carrier: "X" };
  const screened = buildCallProfile({ via: "screened", number: "+61400000000", reputation: rep, screenedAt: "2026-06-14T10:00:00.000Z", at: "2026-06-14T10:00:00.000Z" });
  const recheck = buildCallProfile({ via: "recheck", number: "+61400000000", reputation: rep, at: "2026-06-14T11:00:00.000Z" });
  assert.equal(mergeProfiles(screened, recheck).level, "screened_call");
});

test("file levels: name only → contents read → fingerprinted; a disguised program raises its signals", () => {
  const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);
  const a = analyseFile({ name: "Invoice.pdf.exe", size: 2048, mime: "application/pdf", headBytes: bytes, textSample: "", source: "email" });
  assert.equal(fileLevelFor({ inspected: false }), "name_only");
  assert.equal(fileLevelFor({ inspected: true }), "contents_read");
  const sha = "c".repeat(64);
  const p = buildFileProfile({ via: "picked", name: "Invoice.pdf.exe", size: 2048, mime: "application/pdf", analysis: a, inspected: true, sha256: sha });
  assert.equal(p.label, "Contents read and fingerprinted");
  assert.equal(cap(p, "true_type").status, "verified");
  assert.equal(cap(p, "sha256").value, sha);
  assert.equal(cap(p, "declared_type").status, "observed");
  assert.equal(cap(p, "threat_indicators").status, "unavailable");
  assert.deepEqual(ids(p).slice(0, 2), ["double_extension", "executable"]);
  assert.deepEqual(p.original, { sha256: sha, bytes: 2048, keptOnDevice: false });
  const disguised = buildFileProfile({ via: "shared", name: "Invoice.pdf", analysis: analyseFile({ name: "Invoice.pdf", headBytes: bytes, textSample: "", source: "email" }), inspected: true });
  assert.equal(disguised.label, "Contents read");
  assert.equal(disguised.signals[0].text, "Its name says PDF, but it's really a program.");
  const nameOnly = buildFileProfile({ via: "name_only", name: "Statement.pdf", analysis: analyseFile({ name: "Statement.pdf", source: "unknown" }), inspected: false });
  assert.equal(nameOnly.label, "File name only");
  assert.equal(cap(nameOnly, "true_type").status, "unavailable");
  assert.equal(cap(nameOnly, "sha256").status, "unavailable");
});

test("app levels: what you entered vs read from this device; signing and store checks are never claimed", () => {
  const analysis = { remoteCapable: false, claimedBrand: null };
  const typed = buildAppProfile({ via: "typed", name: "QuickSupport", source: "not_sure", ticked: ["accessibility"], device: null, analysis });
  assert.equal(typed.label, "Described by you");
  assert.equal(cap(typed, "package_id").status, "unavailable");
  assert.equal(cap(typed, "permissions").status, "observed");
  const read = buildAppProfile({
    via: "picked", name: "QuickSupport", source: "not_sure", ticked: [], analysis: { remoteCapable: true, claimedBrand: null }, badDestinations: 1,
    device: { packageId: "com.example.qs", appName: "QuickSupport", developer: null, installSource: "browser", requestedPermissions: ["a", "b"], grantedPermissions: ["a"], remoteAccessCapability: true,
      specialAccessStates: [{ access: "accessibility_service", granted: true }, { access: "notification_listener", granted: false }] },
  });
  assert.equal(read.label, "Read from this device");
  assert.equal(cap(read, "package_id").status, "verified");
  assert.equal(cap(read, "install_source").status, "recorded");
  assert.equal(cap(read, "permissions").value, "2 requested, 1 granted");
  assert.equal(cap(read, "signing").status, "unavailable");
  assert.equal(cap(read, "store_security").status, "unavailable");
  assert.deepEqual(ids(read), ["sideloaded", "remote_access", "accessibility", "bad_destination"]);
});

test("images: one level; metadata is never used as evidence; flagged identifiers are signals", () => {
  const p = buildImageProfile({ via: "photo", textRead: true, identifiers: 3, flagged: 1, redacted: true });
  assert.equal(p.label, "Image");
  assert.equal(p.viaLabel, "Photo taken on this device");
  assert.equal(cap(p, "metadata").status, "unavailable");
  assert.equal(cap(p, "embedded_identifiers").value, "3 found, 1 flagged");
  assert.deepEqual(ids(p), ["redacted", "flagged"]);
});

test("evidence strength is the level's rank out of the strongest its kind can have", () => {
  assert.deepEqual(evidenceStrength({ type: "email", rank: 3 }), { rank: 3, max: 4 });
  assert.deepEqual(evidenceStrength({ type: "call", rank: 1 }), { rank: 1, max: 3 });
  assert.deepEqual(evidenceStrength({ type: "image", rank: 1 }), { rank: 1, max: 1 });
});
