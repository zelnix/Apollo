// Gate 4 scenario benchmark (C01–C20). Run: yarn test:gate4
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyseCall, type CallAsk, type CallClaim } from "../src/domain/callAnalysis.ts";

const run = (asks: CallAsk[], claim: CallClaim, transcript?: string) => analyseCall({ asks, claim, transcript });
const cases: { id: string; asks: CallAsk[]; claim: CallClaim; t?: string; expect: string[]; scenario?: string }[] = [
  { id: "C01 bank fraud dept, nothing asked yet", asks: ["nothing"], claim: "bank", expect: ["ears_up"], scenario: "C20" },
  { id: "C02 safe account transfer (acceptance 1)", asks: ["transfer"], claim: "bank", expect: ["barking"], scenario: "C02" },
  { id: "C03 read back verification code", asks: ["code"], claim: "bank", expect: ["barking"], scenario: "C03" },
  { id: "C04 password/PIN", asks: ["password"], claim: "telco", expect: ["barking"], scenario: "C04" },
  { id: "C05 remote access (acceptance 4)", asks: ["install", "remote"], claim: "techsupport", expect: ["barking"], scenario: "C05" },
  { id: "C06 tech support, nothing asked", asks: ["nothing"], claim: "techsupport", expect: ["growling"], scenario: "C06" },
  { id: "C07 ATO warrant + pay", asks: ["transfer"], claim: "government", expect: ["barking"], scenario: "C07" },
  { id: "C08 gift cards", asks: ["giftcards"], claim: "government", expect: ["barking"], scenario: "C08" },
  { id: "C09 crypto for safety", asks: ["crypto"], claim: "bank", expect: ["barking", "growling"], scenario: "C09" },
  { id: "C10 grandchild emergency money", asks: ["transfer"], claim: "family", expect: ["ears_up"], scenario: "C10" },
  { id: "C11 family call, nothing asked", asks: ["nothing"], claim: "family", expect: ["ears_up"], scenario: "C11" },
  { id: "C12 investment cold call", asks: ["nothing"], claim: "investment", expect: ["growling"], scenario: "C12" },
  { id: "C13 online relationship money", asks: ["transfer"], claim: "relationship", expect: ["ears_up", "growling"], scenario: "C13" },
  { id: "C14 don't hang up / tell no one", asks: ["dont_hangup"], claim: "bank", expect: ["barking"], scenario: "C14" },
  { id: "C15 share screen", asks: ["screen"], claim: "bank", expect: ["barking"], scenario: "C15" },
  { id: "C16 refund needs bank details", asks: ["refund", "bankdetails"], claim: "business", expect: ["growling"], scenario: "C16" },
  { id: "C17 subscription renewal", asks: ["subscription"], claim: "techsupport", expect: ["growling"], scenario: "C17" },
  { id: "C18 callback", asks: ["callback"], claim: "unknown", expect: ["ears_up"], scenario: "C18" },
  { id: "C19 legit unknown caller (acceptance 3)", asks: ["nothing"], claim: "business", expect: ["resting"], scenario: "C19" },
  { id: "C20 genuine bank security call", asks: ["nothing"], claim: "bank", expect: ["ears_up"], scenario: "C20" },
  { id: "Voicemail transcript drives rules", asks: ["other"], claim: "unknown", t: "This is the ATO. A warrant has been issued. Call us immediately or legal proceedings will begin.", expect: ["ears_up", "growling", "barking"] },
  { id: "Transcript with code request → bark", asks: ["other"], claim: "unknown", t: "I've sent you a six-digit security code, read it back to me so I can fix your account.", expect: ["barking"], scenario: "C03" },
];
for (const c of cases) test(c.id, () => { const r = run(c.asks, c.claim, c.t); assert.ok(c.expect.includes(r.state), `${c.id}: expected ${c.expect.join("/")} got ${r.state} (${r.scenario})`); if (c.scenario) assert.equal(r.scenario, c.scenario); assert.ok(r.why.length >= 2 && r.verifyCaller.length > 10); });
test("Acceptance 1 wording", () => { const r = run(["transfer"], "bank"); assert.match(r.verdict, /Do not transfer the money/); assert.match(r.recommendation, /Hang up and contact your bank independently/); });
test("Verify Caller never relies on caller-supplied details", () => { for (const claim of ["bank", "government", "family", "unknown"] as CallClaim[]) assert.match(run(["nothing"], claim).verifyCaller, /yourself|already|saved|find|official/i); });
test("Unknown number alone is not a scam", () => { assert.equal(analyseCall({ asks: ["nothing"], claim: "unknown", number: "+61 400 000 000" }).state, "resting"); });
