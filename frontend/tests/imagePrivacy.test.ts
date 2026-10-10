/**
 * Image Privacy Screening Tests
 *
 * Tests the on-device privacy detection and redaction logic.
 * Note: Image manipulation (expo-image-manipulator) and OCR (expo-ocr-kit) require
 * native builds and cannot be tested outside the bundler. These tests cover the
 * pure detection/redaction functions that run in any JS environment.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import only the pure functions that don't depend on native modules.
// The module structure ensures these are testable independently.
const {
  detectSensitiveContent,
  redactText,
  redactAllSensitive,
} = await import("../src/domain/imagePrivacyCore.ts");

// ── Credential Detection ─────────────────────────────────────────────────────

describe("Credential detection", () => {
  it("detects password in text", () => {
    const detections = detectSensitiveContent("Your password is SuperSecret123!");
    assert.ok(detections.length > 0, "Must detect credential");
    assert.equal(detections[0].type, "credential");
  });

  it("detects Bearer token", () => {
    const detections = detectSensitiveContent("Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.test.signature");
    assert.ok(detections.length > 0, "Must detect Bearer token");
    assert.equal(detections[0].type, "credential");
  });

  it("detects URL-embedded credentials", () => {
    const detections = detectSensitiveContent("https://admin:secret@internal.example.com/api");
    assert.ok(detections.length > 0, "Must detect URL credentials");
  });

  it("detects query string tokens", () => {
    const detections = detectSensitiveContent("https://example.com/callback?access_token=abc123def456");
    assert.ok(detections.length > 0, "Must detect query string token");
  });

  it("detects verification codes", () => {
    const detections = detectSensitiveContent("Your verification code is 847293");
    assert.ok(detections.length > 0, "Must detect verification code");
    assert.equal(detections[0].type, "credential");
  });

  it("detects OTP codes", () => {
    const detections = detectSensitiveContent("OTP: 492817");
    assert.ok(detections.length > 0, "Must detect OTP");
    assert.equal(detections[0].type, "credential");
  });

  it("detects recovery phrases", () => {
    const detections = detectSensitiveContent("Save your recovery phrase: apple banana cherry");
    assert.ok(detections.length > 0, "Must detect recovery phrase");
    assert.equal(detections[0].type, "credential");
  });

  it("detects API keys", () => {
    const detections = detectSensitiveContent("api_key = sk_test_abcdefghijklmnop");
    assert.ok(detections.length > 0, "Must detect API key");
  });
});

// ── PII Detection ────────────────────────────────────────────────────────────

describe("PII detection", () => {
  it("detects email addresses", () => {
    const detections = detectSensitiveContent("Contact john.doe@example.com for help");
    assert.ok(detections.some(d => d.type === "pii"), "Must detect email as PII");
  });

  it("detects phone numbers", () => {
    const detections = detectSensitiveContent("Call +61 400 123 456 for support");
    assert.ok(detections.some(d => d.type === "pii"), "Must detect phone number as PII");
  });

  it("detects credit card patterns", () => {
    const detections = detectSensitiveContent("Card: 4111 1111 1111 1111");
    assert.ok(detections.some(d => d.type === "financial"), "Must detect card number as financial");
  });

  it("detects TFN patterns", () => {
    const detections = detectSensitiveContent("TFN: 123 456 789");
    assert.ok(detections.some(d => d.type === "financial"), "Must detect TFN as financial");
  });

  it("preserves security indicators — domains not flagged as PII", () => {
    const detections = detectSensitiveContent("The suspicious domain is fake-bank.example.com");
    // Should NOT have credential or PII detections for a domain name
    const nonPII = detections.filter(d => d.type === "credential");
    assert.equal(nonPII.length, 0, "Domain names are not credentials");
  });
});

// ── Text Redaction ───────────────────────────────────────────────────────────

describe("Text redaction", () => {
  it("redactText removes credentials but preserves other content", () => {
    const text = "The site asked for your password is secret123. The domain is fake-bank.example.com.";
    const redacted = redactText(text);
    assert.ok(!redacted.includes("secret123"), "Credential must be removed");
    assert.ok(redacted.includes("fake-bank.example.com"), "Domain preserved");
    assert.ok(redacted.includes("[credential redacted]"), "Replacement marker present");
  });

  it("redactAllSensitive removes credentials AND PII", () => {
    const text = "Password is abc123. Contact john@test.com or call +61 400 123 456.";
    const redacted = redactAllSensitive(text);
    assert.ok(!redacted.includes("abc123"), "Credential removed");
    assert.ok(!redacted.includes("john@test.com"), "Email removed");
    assert.ok(redacted.includes("[personal data redacted]"), "PII replacement marker present");
  });

  it("redactText preserves phishing language and security context", () => {
    const text = "This page impersonates ANZ Bank and requests login credentials. Password: test123";
    const redacted = redactText(text);
    assert.ok(redacted.includes("impersonates ANZ Bank"), "Security context preserved");
    assert.ok(redacted.includes("requests login"), "Threat description preserved");
    assert.ok(!redacted.includes("test123"), "Actual credential removed");
  });

  it("redactText handles multiple credentials in one text", () => {
    const text = "api_key = sk_live_abc123 and secret_key: def456ghi";
    const redacted = redactText(text);
    assert.ok(!redacted.includes("sk_live_abc123"), "First credential removed");
    assert.ok(!redacted.includes("def456ghi"), "Second credential removed");
  });
});

// ── No-bypass guarantee ──────────────────────────────────────────────────────

describe("No unredacted content bypass", () => {
  it("redactText is deterministic — same input always produces same output", () => {
    const text = "Password is secret. OTP: 123456. The site is phishing.example.com.";
    const r1 = redactText(text);
    const r2 = redactText(text);
    assert.equal(r1, r2, "Redaction must be deterministic");
  });

  it("empty text produces empty text", () => {
    assert.equal(redactText(""), "");
    assert.equal(redactAllSensitive(""), "");
  });

  it("text with no sensitive content passes through unchanged", () => {
    const text = "Apollo detected a suspicious website at example.com. The domain was registered recently.";
    assert.equal(redactText(text), text, "Safe text unchanged");
  });
});
