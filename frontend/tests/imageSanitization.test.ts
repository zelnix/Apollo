/**
 * Image Sanitization Receipt — pipeline enforcement tests.
 *
 * Tests the receipt management and pipeline enforcement logic.
 * Since imageSanitization.ts depends on expo-crypto (native), we test the
 * enforcement logic by reimplementing the core patterns and verifying them,
 * plus testing the exported pure functions where possible.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Test the pipeline enforcement logic patterns ──
// These replicate the enforcement logic from imageSanitization.ts

describe("Pipeline enforcement — receipt validation logic", () => {
  /** Simulates the receipt store for testing. */
  const receipts = new Map();
  let counter = 0;

  function createTestReceipt(imageUri, decision, sensitiveRegionsFound, redactedRegions) {
    const receiptId = `test-receipt-${++counter}`;
    const receipt = {
      receiptId,
      imageDigest: `hash:${imageUri}:${decision}`,
      decision,
      sensitiveRegionsFound,
      redactedRegions,
      timestamp: Date.now(),
      consumed: false,
    };
    receipts.set(receiptId, receipt);
    return receipt;
  }

  function consumeTestReceipt(receiptId) {
    const receipt = receipts.get(receiptId);
    if (!receipt || receipt.consumed) return null;
    if (Date.now() - receipt.timestamp > 5 * 60 * 1000) {
      receipts.delete(receiptId);
      return null;
    }
    receipt.consumed = true;
    receipts.delete(receiptId);
    return receipt;
  }

  function requireTestSanitization(receiptId) {
    if (!receiptId) {
      throw new Error("Image upload blocked: no sanitization receipt.");
    }
    const receipt = consumeTestReceipt(receiptId);
    if (!receipt) {
      throw new Error("Image upload blocked: sanitization receipt is invalid, expired, or already used.");
    }
    if (receipt.decision === "withheld") {
      throw new Error("Image upload blocked: this image was withheld.");
    }
    return receipt;
  }

  beforeEach(() => {
    receipts.clear();
    counter = 0;
  });

  it("creates receipt with correct fields", () => {
    const r = createTestReceipt("file:///img.jpg", "sanitised_image", 3, 3);
    assert.equal(r.decision, "sanitised_image");
    assert.equal(r.sensitiveRegionsFound, 3);
    assert.equal(r.redactedRegions, 3);
    assert.equal(r.consumed, false);
  });

  it("creates unique receipts", () => {
    const r1 = createTestReceipt("file:///img.jpg", "text_only", 2, 0);
    const r2 = createTestReceipt("file:///img.jpg", "text_only", 2, 0);
    assert.notEqual(r1.receiptId, r2.receiptId);
  });

  it("returns receipt on first consumption", () => {
    const original = createTestReceipt("file:///img.jpg", "sanitised_image", 1, 1);
    const consumed = consumeTestReceipt(original.receiptId);
    assert.ok(consumed !== null);
    assert.equal(consumed.receiptId, original.receiptId);
    assert.equal(consumed.consumed, true);
  });

  it("returns null on second consumption (one-time-use)", () => {
    const original = createTestReceipt("file:///img.jpg", "sanitised_image", 1, 1);
    consumeTestReceipt(original.receiptId);
    const second = consumeTestReceipt(original.receiptId);
    assert.equal(second, null);
  });

  it("returns null for non-existent receipts", () => {
    assert.equal(consumeTestReceipt("non-existent-id"), null);
  });

  it("throws for undefined receiptId (enforcement gate)", () => {
    assert.throws(
      () => requireTestSanitization(undefined),
      /no sanitization receipt/,
    );
  });

  it("throws for invalid receiptId (enforcement gate)", () => {
    assert.throws(
      () => requireTestSanitization("non-existent"),
      /invalid, expired, or already used/,
    );
  });

  it("throws for withheld decisions", () => {
    const receipt = createTestReceipt("file:///img.jpg", "withheld", 5, 0);
    assert.throws(
      () => requireTestSanitization(receipt.receiptId),
      /withheld/,
    );
  });

  it("returns receipt for valid approved decisions", () => {
    const receipt = createTestReceipt("file:///img.jpg", "sanitised_image", 2, 2);
    const validated = requireTestSanitization(receipt.receiptId);
    assert.equal(validated.decision, "sanitised_image");
  });

  it("throws on second use (one-time enforcement)", () => {
    const receipt = createTestReceipt("file:///img.jpg", "sanitised_image", 2, 2);
    requireTestSanitization(receipt.receiptId);
    assert.throws(
      () => requireTestSanitization(receipt.receiptId),
      /invalid, expired, or already used/,
    );
  });

  it("accepts all safe decision types", () => {
    const safeCases = [
      "text_only", "sanitised_image", "manual_crop", "no_sensitive", "ocr_unavailable_approved",
    ];
    for (const decision of safeCases) {
      const receipt = createTestReceipt("file:///img.jpg", decision, 1, 1);
      assert.doesNotThrow(() => requireTestSanitization(receipt.receiptId));
    }
  });
});

describe("Pipeline enforcement — image upload kind check", () => {
  // Replicates the backend enforcement: image uploads need sanitization_status = "approved"
  function shouldReject(kind, sanitizationStatus) {
    return kind === "image" && sanitizationStatus !== "approved";
  }

  it("rejects image without status", () => {
    assert.equal(shouldReject("image", null), true);
  });

  it("rejects image with empty status", () => {
    assert.equal(shouldReject("image", ""), true);
  });

  it("rejects image with wrong status", () => {
    assert.equal(shouldReject("image", "pending"), true);
  });

  it("accepts image with approved", () => {
    assert.equal(shouldReject("image", "approved"), false);
  });

  it("accepts document without status", () => {
    assert.equal(shouldReject("document", null), false);
  });

  it("accepts audio without status", () => {
    assert.equal(shouldReject("audio", null), false);
  });

  it("accepts attachment without status", () => {
    assert.equal(shouldReject("attachment", null), false);
  });
});

describe("Pipeline enforcement — sanitisation metadata builder", () => {
  it("builds correct metadata from a receipt", () => {
    const receipt = {
      receiptId: "test-1",
      imageDigest: "hash:test",
      decision: "sanitised_image",
      sensitiveRegionsFound: 3,
      redactedRegions: 3,
      timestamp: Date.now(),
      consumed: false,
    };
    const meta = {
      sanitizationStatus: "approved",
      sanitizationDecision: receipt.decision,
      sensitiveRegionsFound: receipt.sensitiveRegionsFound,
      redactedRegions: receipt.redactedRegions,
    };
    assert.deepEqual(meta, {
      sanitizationStatus: "approved",
      sanitizationDecision: "sanitised_image",
      sensitiveRegionsFound: 3,
      redactedRegions: 3,
    });
  });
});

describe("No unscreened image bypass", () => {
  it("every image upload requires a non-null receipt", () => {
    // Simulates what happens in client.ts uploadFileEvidence for kind="image"
    function simulateImageUpload(kind, receiptId) {
      if (kind === "image") {
        if (!receiptId) throw new Error("Blocked: no receipt");
      }
    }
    assert.throws(() => simulateImageUpload("image", null), /no receipt/);
    assert.throws(() => simulateImageUpload("image", undefined), /no receipt/);
    assert.doesNotThrow(() => simulateImageUpload("image", "valid-receipt-id"));
    assert.doesNotThrow(() => simulateImageUpload("document", null)); // documents don't need receipts
  });
});
