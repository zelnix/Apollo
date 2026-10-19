// Gate 5 scenario benchmark (Q01–Q22, N01–N05 payload-level). Run: yarn test:gate5
import assert from "node:assert/strict";
import { test } from "node:test";

import { assessScan, classifyPayload, type ScanContext } from "../src/domain/scanPayload.ts";

const run = (raw: string, ctx: ScanContext = "other") => { const p = classifyPayload(raw); return { p, a: assessScan(p, ctx) }; };

test("Q01 / acceptance 1: parking sign → unrelated payment domain → growling+", () => { const { a } = run("https://example-parking-payment.test/pay?zone=12", "parking"); assert.ok(["growling", "barking"].includes(a.state)); assert.match(a.why.join(" "), /parking/i); assert.match(a.recommendation, /official app/i); });
test("Q02 / acceptance 2: restaurant menu → resting (false-positive gate)", () => { const { a } = run("https://order.mryum.com/the-local-cafe", "menu"); assert.equal(a.state, "resting"); });
test("Q03 fake Microsoft login → barking (brand mismatch)", () => { const { a } = run("https://microsoft-verify-account.top/login", "email"); assert.equal(a.state, "barking"); assert.equal(a.claimedBrand, "Microsoft"); });
test("Q04 QR in email → ears_up at minimum", () => { const { a } = run("https://some-unknown-site.com/x", "email"); assert.equal(a.state, "ears_up"); });
test("Q05 fake parcel QR → growling", () => { const { a } = run("https://redelivery-fee-pay.top/track", "parcel"); assert.equal(a.state, "growling"); });
test("Q06 fake government QR → growling", () => { const { a } = run("https://refund-portal-au.info/verify", "government"); assert.equal(a.state, "growling"); });
test("Q07 payment QR to plausible business → ears_up, not malicious", () => { const { p, a } = run("https://pay.squareup.com/checkout/abc", "payment"); assert.equal(p.type, "payment"); assert.equal(a.state, "ears_up"); });
test("Q09 crypto address alone → ears_up (never 'malicious' just for being crypto)", () => { const { p, a } = run("bitcoin:bc1qexampleaddress?amount=0.01", "other"); assert.equal(p.type, "crypto"); assert.equal(a.state, "ears_up"); assert.equal(p.amount, "0.01"); });
test("Q10 crypto from a poster/ad → growling", () => { assert.equal(run("ethereum:0xabc", "poster").a.state, "growling"); });
test("Q11 App Store link → resting", () => { assert.equal(run("https://apps.apple.com/au/app/id123", "poster").a.state, "resting"); });
test("Q15 shortener is only a URL (Gate 3 expands it)", () => { const { p, a } = run("https://bit.ly/abc"); assert.equal(p.type, "url"); assert.equal(a.state, "resting"); assert.equal(a.handoff, "web"); });
test("Q16 / acceptance 4: tel: → preview + call handoff, never auto-call", () => { const { p, a } = run("tel:+61400000000"); assert.equal(p.type, "tel"); assert.match(p.preview, /wants to call/); assert.equal(a.handoff, "call"); assert.equal(a.state, "ears_up"); });
test("Q17 sms: → ears_up with body shown", () => { const { p, a } = run("SMSTO:19900001:JOIN"); assert.equal(p.type, "sms"); assert.equal(p.smsBody, "JOIN"); assert.equal(a.state, "ears_up"); });
test("Q18 mailto → resting", () => { const { p, a } = run("mailto:hello@example.com?subject=Hi"); assert.equal(p.type, "mailto"); assert.equal(p.subject, "Hi"); assert.equal(a.state, "resting"); });
test("Q19 / acceptance 5: WPA Wi-Fi → resting with details", () => { const { p, a } = run("WIFI:T:WPA;S:CafeGuest;P:secret;;"); assert.equal(p.type, "wifi"); assert.equal(p.ssid, "CafeGuest"); assert.equal(p.wifiSecurity, "WPA"); assert.equal(a.state, "resting"); });
test("Q19b open Wi-Fi → ears_up", () => { assert.equal(run("WIFI:T:nopass;S:FreeAirport;;").a.state, "ears_up"); });
test("Q20 plain text → resting", () => { const { p, a } = run("Table 12 — thanks for visiting!"); assert.equal(p.type, "text"); assert.equal(a.state, "resting"); });
test("N04 app deep link → ears_up + app handoff", () => { const { p, a } = run("someapp://action?x=1"); assert.equal(p.type, "applink"); assert.equal(a.handoff, "app"); assert.equal(a.state, "ears_up"); });
test("Official domain with parking context is NOT flagged", () => { assert.equal(run("https://www.wilsonparking.com.au/pay", "parking").a.state, "resting"); });
