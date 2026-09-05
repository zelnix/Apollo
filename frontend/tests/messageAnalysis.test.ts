// Gate 2 scenario benchmark (M01–M15). Run: cd frontend && yarn test:gate2
// Each spec scenario must land on the expected dog state (or one of the allowed states where the spec says "Growl / Bark").
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyseMessage } from "../src/domain/messageAnalysis.ts";

const cases: { id: string; sender: string; text: string; expect: string[]; scenario?: string }[] = [
  { id: "M01 parcel", sender: "+61 480 000 111", text: "AusPost: Your package could not be delivered. Pay $2.95 to reschedule at auspost-redelivery-au.top/track", expect: ["growling"], scenario: "M01" },
  { id: "M02 bank", sender: "+61 400 000 222", text: "CommBank Alert: A $4,820 payment has been detected. Secure your account immediately at commbank-secure-verify.xyz/login", expect: ["barking"], scenario: "M02" },
  { id: "M03 toll", sender: "Linkt", text: "Your toll payment is overdue. Pay now to avoid additional penalties: linkt-pay-notice.com", expect: ["growling"], scenario: "M03" },
  { id: "M04 ATO refund", sender: "ATO", text: "ATO: Your refund is ready. Verify your identity to receive payment at ato-refund-portal.info", expect: ["growling", "barking"], scenario: "M04" },
  { id: "M05 hi dad", sender: "+61 411 222 333", text: "Hi Dad, I smashed my phone. This is my temporary number. Can you help me pay a bill today?", expect: ["ears_up"], scenario: "M05" },
  { id: "M06 code", sender: "Unknown", text: "Send me the six-digit code that just came through so I can fix your account.", expect: ["barking"], scenario: "M06" },
  { id: "M07 job", sender: "+1 555 010 100", text: "Earn $800 per day working from home. Message our recruiter on Telegram to start.", expect: ["ears_up", "growling"], scenario: "M07" },
  { id: "M08 crypto", sender: "Unknown", text: "I'm helping selected investors earn guaranteed 15% weekly returns. Deposit USDT to start.", expect: ["growling"], scenario: "M08" },
  { id: "M09 romance", sender: "Daniel", text: "My love, I'm stuck at customs and they need $1,200 for the travel fee. Can you send it tonight? I'll pay you back babe.", expect: ["ears_up", "growling"], scenario: "M09" },
  { id: "M10 gift cards", sender: "Boss", text: "I need you to buy $500 in Apple gift cards for a client urgently. Send me photos of the codes and keep this between us.", expect: ["barking"], scenario: "M10" },
  { id: "M11 marketplace", sender: "Buyer", text: "I've already paid for the item. Use this courier link to receive your money and enter your card details: pay-courier-release.site", expect: ["growling", "barking"] },
  { id: "M12 fake refund", sender: "Unknown", text: "You've received $950. Pay a $50 release fee to access the funds.", expect: ["barking"], scenario: "M12" },
  { id: "M13 remote access", sender: "Support", text: "Your account has been compromised. Install this support app (AnyDesk) so we can protect you.", expect: ["barking"], scenario: "M13" },
  { id: "M14 sextortion", sender: "Unknown", text: "I hacked your phone and recorded you. Pay 0.05 Bitcoin or I will send the video to everyone you know.", expect: ["growling", "barking"], scenario: "M14" },
  { id: "M15 legit tradie (false-positive gate)", sender: "+61 412 345 678", text: "Hi, it's Sam the plumber. I can come Thursday between 9 and 11 to look at the hot water system. Does that suit?", expect: ["resting"], scenario: "M15" },
  { id: "M15b school", sender: "St Mary's", text: "Reminder: school photos are on Friday. Please have students in full winter uniform.", expect: ["resting"], scenario: "M15" },
  { id: "M15c appointment", sender: "+61 3 9000 0000", text: "Your dental appointment is confirmed for Tue 12 Jun at 2:30pm. Reply Y to confirm or call us to change.", expect: ["resting"], scenario: "M15" },
];

for (const c of cases) {
  test(c.id, () => {
    const r = analyseMessage(c.sender, c.text);
    assert.ok(c.expect.includes(r.state), `${c.id}: expected ${c.expect.join("/")} got ${r.state} (${r.scenario})`);
    if (c.scenario) assert.equal(r.scenario, c.scenario, `${c.id}: scenario`);
    assert.ok(r.why.length >= 2 && r.recommendation.length > 10 && r.verifySender.length > 10);
  });
}

test("Verify Sender never points at the message's own contact details", () => {
  const r = analyseMessage("+61 400 000 222", "CommBank: call 1800 000 000 now to secure your account");
  assert.ok(!r.verifySender.includes("1800 000 000"));
});

test("M05 must not be declared fraudulent outright", () => {
  const r = analyseMessage("+61 411 222 333", "Hi Mum, new number — dropped my phone in the pool!");
  assert.equal(r.state, "ears_up");
  assert.match(r.verdict, /pattern/i);
});

test("Detection ≥ 90% across threat scenarios, 0 false positives on clean set", () => {
  const threats = cases.filter((c) => !c.expect.includes("resting"));
  const clean = cases.filter((c) => c.expect.includes("resting"));
  const detected = threats.filter((c) => analyseMessage(c.sender, c.text).state !== "resting").length;
  const fps = clean.filter((c) => analyseMessage(c.sender, c.text).state !== "resting").length;
  assert.ok(detected / threats.length >= 0.9, `detection ${detected}/${threats.length}`);
  assert.equal(fps, 0);
});
