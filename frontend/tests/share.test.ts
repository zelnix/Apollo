// Share Into Apollo routing + Incident Timeline plan. Run: yarn test:share
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildIncidentPlan, inferRecoveryKinds } from "../src/domain/incidentPlan.ts";
import type { PatrolEvent } from "../src/domain/types";
import { alternativeRoutes, classifyShare } from "../src/share/classifyShare.ts";

test("bare link → /check", () => { const r = classifyShare({ webUrl: "https://example.com/x" }); assert.equal(r.kind, "link"); assert.equal(r.pathname, "/check"); assert.equal(r.params.url, "https://example.com/x"); });
test("bare domain in text → /check with https", () => { assert.equal(classifyShare({ text: "commbank-verify.top/login" }).params.url, "https://commbank-verify.top/login"); });
test("SMS with link → /message", () => { const r = classifyShare({ text: "CommBank: your account is locked. Verify at https://cb-verify.top/x" }); assert.equal(r.kind, "message"); assert.equal(r.pathname, "/message"); });
test("forwarded email with headers → /email", () => { const r = classifyShare({ text: "From: CommBank <a@b.top>\nSubject: Restricted\n\nDear customer, verify now https://x.top" }); assert.equal(r.kind, "email"); assert.equal(r.pathname, "/email"); });
test("long email-like body without headers → /email", () => { const r = classifyShare({ text: `Dear customer, ${"we noticed unusual activity on your account and need you to confirm your details. ".repeat(8)} Kind regards, The Team` }); assert.equal(r.kind, "email"); });
test("MFA / login alert → /account", () => {
  assert.equal(classifyShare({ text: "Microsoft: Approve this sign-in request? If this wasn't you, deny." }).kind, "account");
  assert.equal(classifyShare({ text: "Your Google password was reset. If this wasn't you, secure your account." }).kind, "account");
  assert.equal(classifyShare({ text: "Your verification code is 482913" }).kind, "account");
});
test("image file → /message screenshot; other file → /file", () => {
  const img = classifyShare({ files: [{ path: "file:///tmp/shot.png", mimeType: "image/png", fileName: "shot.png" }] }); assert.equal(img.kind, "screenshot"); assert.equal(img.params.imageUri, "file:///tmp/shot.png");
  const f = classifyShare({ files: [{ path: "file:///tmp/Invoice.pdf.exe", mimeType: "application/octet-stream", fileName: "Invoice.pdf.exe", size: 1200 }] }); assert.equal(f.kind, "file"); assert.equal(f.pathname, "/file"); assert.equal(f.params.name, "Invoice.pdf.exe"); assert.equal(f.params.size, "1200");
});
test("alternatives exclude the chosen kind and cover the others", () => {
  const p = { text: "Hi https://a.b/c" }; const alts = alternativeRoutes(p, "message").map((r) => r.kind);
  assert.deepEqual(alts, ["link", "email", "account"]);
  assert.deepEqual(alternativeRoutes({ files: [{ path: "f", mimeType: "application/pdf" }] }, "file").map((r) => r.kind), ["screenshot"]);
});

const ev = (over: Partial<PatrolEvent>): PatrolEvent => ({ event_id: Math.random().toString(36).slice(2), device_id: "d", category: "message", state: "growling", status: "active", headline: "x", what_happened: "y", why: [], what_to_do: "z", indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: "t", occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: null, scent_id: "S1", ...over } as PatrolEvent);

test("incident plan orders the timeline and takes the highest state", () => {
  const t0 = Date.now();
  const plan = buildIncidentPlan([ev({ category: "account", state: "barking", occurred_at: new Date(t0 + 3000).toISOString(), scenario: "AC01" }), ev({ category: "email", state: "growling", occurred_at: new Date(t0).toISOString(), claimed_brand: "CommBank", scenario: "E01" }), ev({ category: "link", state: "barking", occurred_at: new Date(t0 + 1000).toISOString() })]);
  assert.deepEqual(plan.timeline.map((e) => e.category), ["email", "link", "account"]); assert.equal(plan.state, "barking"); assert.match(plan.headline, /CommBank impersonation — email → link checked → account alert/i);
  assert.ok(plan.kinds.includes("mfa_approved")); assert.match(plan.steps[0].text, /sign out of all other devices/i); assert.equal(plan.allResolved, false);
});
test("recoveries the user recorded are read back from why and ordered by urgency; steps are deduplicated", () => {
  const kinds = inferRecoveryKinds([ev({ why: ["You told Apollo: entered a password."] }), ev({ why: ["You told Apollo: shared a verification code."] }), ev({ scenario: "A01", state: "barking", category: "app" })]);
  assert.deepEqual(kinds, ["remote", "code", "password"]);
  const plan = buildIncidentPlan([ev({ why: ["You told Apollo: entered a password."] }), ev({ why: ["You told Apollo: entered a password."] })]);
  const texts = plan.steps.map((s) => s.text); assert.equal(new Set(texts).size, texts.length); assert.match(plan.exposure.join(), /password was entered/);
});
test("no exposure → generic don't-act plan, contact the brand yourself", () => {
  const plan = buildIncidentPlan([ev({ claimed_brand: "ANZ" }), ev({ category: "call", claimed_brand: "ANZ" })]);
  assert.equal(plan.kinds.length, 0); assert.match(plan.steps[0].text, /Don't act/); assert.match(plan.steps[1].text, /Contact ANZ yourself/);
});

// ---- Weekly digest incidents ----
import { buildWeeklyDigest } from "../src/domain/digest.ts";
test("weekly digest groups 2+ linked events into incidents with stopped / still-open split", () => {
  const t0 = Date.now() - 3600_000;
  const d = buildWeeklyDigest([
    ev({ scent_id: "S9", category: "message", state: "growling", occurred_at: new Date(t0).toISOString(), claimed_brand: "ANZ", status: "resolved", headline: "ANZ SMS" }),
    ev({ scent_id: "S9", category: "account", state: "barking", occurred_at: new Date(t0 + 60_000).toISOString(), headline: "Account: Login prompt", status: "active" }),
    ev({ scent_id: "solo", category: "link", state: "growling", status: "active" }),
  ]);
  assert.equal(d.incidents.length, 1); assert.equal(d.openIncidents, 1); assert.equal(d.handledIncidents, 0); assert.equal(d.openSingles, 1);
  const inc = d.incidents[0]; assert.match(inc.headline, /ANZ impersonation/); assert.equal(inc.events, 2); assert.equal(inc.stopped.length, 1); assert.equal(inc.stillOpen.length, 1); assert.match(inc.stillOpen[0], /Login prompt/);
});
