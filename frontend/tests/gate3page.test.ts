// Gate 3 Phase B — page-content scenarios (W08/W09/W10/W12/W14/W18 + false-positive gates). Run: yarn test:gate3page
import assert from "node:assert/strict";
import { test } from "node:test";

import { analysePage, type PageSignals } from "../src/domain/pageAnalysis.ts";

const base: PageSignals = { visible_url: "", claimed_brand: "", page_type: "other", asks_for: [], virus_or_infection_claim: false, phone_number_to_call: "", remote_access_tool: "", captcha_instructions: "", wallet_connect_request: false, urgency_or_threat_text: "", prices_look_unrealistic: false, payment_methods: [], business_identity: "", os_or_security_branding: "", text_excerpt: "" };
const p = (o: Partial<PageSignals>): PageSignals => ({ ...base, ...o });

const cases: { id: string; sig: PageSignals; expect: string[]; scenario?: string }[] = [
  { id: "W08 fake virus warning", sig: p({ page_type: "security_warning", virus_or_infection_claim: true, os_or_security_branding: "Apple", urgency_or_threat_text: "Your iPhone has 17 viruses! Tap here immediately", asks_for: ["download"] }), expect: ["barking"], scenario: "W08" },
  { id: "W09 fake tech support", sig: p({ page_type: "tech_support", os_or_security_branding: "Microsoft", phone_number_to_call: "1800 000 111", urgency_or_threat_text: "Call immediately", virus_or_infection_claim: true }), expect: ["barking"], scenario: "W09" },
  { id: "W14 remote access prompt", sig: p({ page_type: "tech_support", remote_access_tool: "AnyDesk", asks_for: ["install"], virus_or_infection_claim: true }), expect: ["barking"], scenario: "W14" },
  { id: "W10 fake shop (3 flags)", sig: p({ page_type: "shop", visible_url: "nike-outlet-clearance.top", claimed_brand: "Nike", prices_look_unrealistic: true, payment_methods: ["bank transfer only"], business_identity: "" }), expect: ["growling"], scenario: "W10" },
  { id: "W10 small legit shop", sig: p({ page_type: "shop", visible_url: "www.smallbakerysydney.com.au", claimed_brand: "Small Bakery", payment_methods: ["card", "paypal"], business_identity: "12 Bay St Sydney, ABN 12 345 678 901" }), expect: ["resting", "ears_up"], scenario: "W10" },
  { id: "W12 wallet drainer", sig: p({ page_type: "wallet", visible_url: "claim-airdrop-eth.xyz", wallet_connect_request: true, urgency_or_threat_text: "Claim in the next 10 minutes" }), expect: ["barking"], scenario: "W12" },
  { id: "W18 fake CAPTCHA", sig: p({ page_type: "captcha", captcha_instructions: "Press Win+R, paste the command and press Enter to verify", asks_for: ["download"] }), expect: ["barking"], scenario: "W18" },
  { id: "W02 fake bank login from screenshot", sig: p({ page_type: "login", visible_url: "commbank-netbank-secure.xyz", claimed_brand: "CommBank", asks_for: ["bank_login", "password"] }), expect: ["barking"], scenario: "W02" },
  { id: "W03 fake Microsoft login", sig: p({ page_type: "login", visible_url: "docs-share-secure.top", claimed_brand: "Microsoft", asks_for: ["email", "password"] }), expect: ["barking"], scenario: "W03" },
  { id: "Real CommBank login is NOT flagged", sig: p({ page_type: "login", visible_url: "www.commbank.com.au", claimed_brand: "CommBank", asks_for: ["bank_login", "password"] }), expect: ["resting", "ears_up"] },
  { id: "W15 permission request alone is not malicious", sig: p({ page_type: "article", visible_url: "www.abc.net.au", asks_for: ["permission"] }), expect: ["resting"], scenario: "W20" },
  { id: "W19 legit article with ads", sig: p({ page_type: "article", visible_url: "www.smh.com.au", text_excerpt: "Latest news... Advertisement" }), expect: ["resting"], scenario: "W20" },
  { id: "W11 payment page via message link", sig: p({ page_type: "payment", visible_url: "auspost-fee-pay.top", claimed_brand: "Australia Post", asks_for: ["card"], urgency_or_threat_text: "Pay $2.95 within 24 hours" }), expect: ["barking", "growling"], scenario: "W11" },
];

for (const c of cases) {
  test(c.id, () => {
    const r = analysePage(c.sig);
    assert.ok(c.expect.includes(r.state), `${c.id}: expected ${c.expect.join("/")} got ${r.state} (${r.scenario})`);
    if (c.scenario) assert.equal(r.scenario, c.scenario);
    assert.ok(r.why.length >= 2 && r.recommendation.length > 10);
  });
}

test("Never claims infection or stolen funds as fact", () => {
  const virus = analysePage(cases[0].sig); const wallet = analysePage(cases[5].sig);
  assert.match(virus.recommendation, /nothing on your phone has changed/i);
  assert.match(wallet.recommendation, /no evidence funds were taken/i);
});

test("Phone number handed to recovery (Gate 4)", () => {
  assert.equal(analysePage(cases[1].sig).phoneToAvoid, "1800 000 111");
});
