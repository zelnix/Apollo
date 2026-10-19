// Screenshot Privacy + Redacted Image Submission Regression Tests
//
// Tests the 8 required regression scenarios. Validates PURE LOGIC in
// imagePrivacyCore.ts — the single screenshot engine shared by all paths.

import {
  detectSensitiveContent,
  redactText,
  redactAllSensitive,
  classifyRegions,
  extractSenderFromText,
} from "../src/domain/imagePrivacyCore.ts";

let passed = 0;
let failed = 0;

function assert(ok, name, detail = "") {
  if (ok) { console.log("  PASS: " + name); passed++; }
  else    { console.log("  FAIL: " + name + " — " + detail); failed++; }
}

// TEST 1: WhatsApp screenshot — sender number preserved
console.log("\n[Test 1] WhatsApp screenshot — sender number preserved");
{
  const blocks = [
    { text: "+61 400 123 456", frame: { x: 10, y: 5, width: 200, height: 30 } },
    { text: "Hey, I need you to transfer $500 urgently", frame: { x: 10, y: 40, width: 300, height: 50 } },
    { text: "Send to 4532 0123 4567 8901", frame: { x: 10, y: 100, width: 300, height: 30 } },
  ];
  const regions = classifyRegions(blocks, { purpose: "message_screenshot" });
  assert(!regions[0].isSensitive, "Sender phone NOT sensitive", "type=" + regions[0].sensitiveType);
  assert(!regions[2].isSensitive, "Payment details are kept as scam evidence (only credentials are redacted)");
  const allText = blocks.map(b => b.text).join("\n");
  const sender = extractSenderFromText(allText);
  assert(sender === "+61 400 123 456", "Sender extracted correctly", "got: " + sender);
}

// TEST 2: SMS with OTP — OTP redacted, sender retained
console.log("\n[Test 2] SMS with OTP — OTP redacted, sender retained");
{
  const blocks = [
    { text: "+1 555 987 6543", frame: { x: 10, y: 5, width: 200, height: 30 } },
    { text: "Your verification code is 482193. Do not share this code.", frame: { x: 10, y: 40, width: 300, height: 50 } },
  ];
  const regions = classifyRegions(blocks, { purpose: "message_screenshot" });
  assert(!regions[0].isSensitive, "SMS sender NOT sensitive");
  assert(regions[1].isSensitive && regions[1].sensitiveType === "credential", "OTP IS credential");
  const allText = blocks.map(b => b.text).join("\n");
  const redacted = redactAllSensitive(allText, { purpose: "message_screenshot" });
  assert(redacted.includes("+1 555 987 6543"), "Sender preserved in redacted text");
  assert(!redacted.includes("482193"), "OTP removed from redacted text");
}

// TEST 3: Email screenshot — sender retained, password redacted
console.log("\n[Test 3] Email screenshot — sender retained, password redacted");
{
  const blocks = [
    { text: "From: scammer@fake-bank.com", frame: { x: 10, y: 5, width: 300, height: 25 } },
    { text: "Subject: Urgent account issue", frame: { x: 10, y: 35, width: 300, height: 25 } },
    { text: "Your temporary password: Abc123secret", frame: { x: 10, y: 70, width: 300, height: 30 } },
  ];
  const regions = classifyRegions(blocks, { purpose: "message_screenshot" });
  assert(!regions[0].isSensitive, "Sender email NOT sensitive", "type=" + regions[0].sensitiveType);
  assert(regions[2].isSensitive && regions[2].sensitiveType === "credential", "Password IS credential");
  const allText = blocks.map(b => b.text).join("\n");
  const sender = extractSenderFromText(allText);
  assert(sender === "scammer@fake-bank.com", "Sender email extracted", "got: " + sender);
  const redacted = redactAllSensitive(allText, { purpose: "message_screenshot" });
  assert(redacted.includes("scammer@fake-bank.com"), "Sender preserved in redacted text");
  assert(!redacted.includes("Abc123secret"), "Password redacted");
}

// TEST 4: Egress boundary — message_extract
console.log("\n[Test 4] Egress boundary — message_extract needs no approval metadata");
{
  const { enforceEgress } = await import("../src/domain/privacy.ts");
  const payload = { device_id: "dev-123" };
  let threwError = false;
  let egressed;
  try { egressed = enforceEgress("message_extract", payload); }
  catch (e) { threwError = true; console.log("    Error: " + e.message); }
  assert(!threwError && egressed?.device_id === "dev-123", "message_extract accepts a plain image submission");
}

// TEST 5: Egress boundary — page_extract
console.log("\n[Test 5] Egress boundary — page_extract needs no approval metadata");
{
  const { enforceEgress } = await import("../src/domain/privacy.ts");
  const payload = { device_id: "dev-456", url_hint: "https://example.com" };
  let threwError = false;
  let egressed;
  try { egressed = enforceEgress("page_extract", payload); }
  catch (e) { threwError = true; console.log("    Error: " + e.message); }
  assert(!threwError && egressed?.url_hint === "https://example.com", "page_extract accepts a plain image submission");
}

// TEST 6: Credential handling remains strict
console.log("\n[Test 6] Credential handling — always strict");
{
  const cases = [
    ["password is MySecret123", "password", true],
    ["PIN is 4829", "PIN", true],
    ["OTP is 738291", "OTP", true],
    ["Your verification code is 123456", "verification code", true],
    ["recovery phrase is: apple banana cherry", "recovery phrase", true],
    ["Bearer eyJhbGciOiJIUzI1NiJ9.abc123", "Bearer token", true],
    ["api_key = sk-abc123xyz789", "API key", true],
    ["https://user:pass@example.com", "URL credentials", true],
    ["?token=abc123&session=xyz", "secret query params", true],
    ["code: 7382", "standalone code", true],
  ];
  for (const [input, desc, mustRedact] of cases) {
    const detections = detectSensitiveContent(input);
    const hasCred = detections.some(d => d.type === "credential");
    assert(hasCred === mustRedact, desc + " detected as credential", JSON.stringify(detections.map(d => d.type)));
  }
  const redacted = redactText("Your verification code is 123456. Bearer eyJabc.def.ghi");
  assert(!redacted.includes("123456"), "Verification code redacted");
  assert(!redacted.includes("eyJabc"), "Bearer token redacted");
}

// TEST 7: Sender vs user-private identifier distinction
console.log("\n[Test 7] Sender vs third-party classification (simplified privacy)");
{
  const senderBlock = { text: "From: +61 400 111 222", frame: { x: 0, y: 0, width: 300, height: 30 } };
  const senderRegions = classifyRegions([senderBlock], { purpose: "message_screenshot" });
  assert(!senderRegions[0].isSensitive, "Sender-context phone NOT sensitive");

  // Under simplified privacy: body phone numbers that are NOT in the user's
  // personal data profile are classified as sender_identifier (third-party, preserved).
  const dummyBlocks = Array.from({ length: 8 }, (_, i) => ({
    text: "Line " + i, frame: { x: 0, y: i * 30, width: 300, height: 30 },
  }));
  dummyBlocks.push({ text: "Please call me back on 0412 345 678 to verify", frame: { x: 0, y: 300, width: 300, height: 30 } });
  const bodyRegions = classifyRegions(dummyBlocks, { purpose: "message_screenshot" });
  const last = bodyRegions[bodyRegions.length - 1];
  assert(!last.isSensitive, "Body phone is sender_identifier (third-party, preserved)", "type=" + last.sensitiveType);
}

// TEST 8: Scammer contact details preserved
console.log("\n[Test 8] Scammer contact details preserved");
{
  const blocks = [
    { text: "Message from +44 20 7946 0958", frame: { x: 0, y: 0, width: 300, height: 30 } },
    { text: "HMRC Tax Refund - Call us to claim your refund", frame: { x: 0, y: 40, width: 300, height: 50 } },
  ];
  const regions = classifyRegions(blocks, { purpose: "message_screenshot" });
  assert(!regions[0].isSensitive, "'Message from' sender preserved");
  const sender = extractSenderFromText(blocks.map(b => b.text).join("\n"));
  assert(sender !== null && sender.includes("7946"), "Sender from 'Message from' pattern", "got: " + sender);
}

// Summary
console.log("\n" + "=".repeat(60));
console.log("SCREENSHOT PRIVACY REGRESSION: " + passed + "/" + (passed + failed) + " passed");
console.log("=".repeat(60));
if (failed > 0) process.exit(1);
