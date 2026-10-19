import assert from "node:assert/strict";
import test from "node:test";
import { captureControlFor, helperCanView, nativeCaptureDecision } from "../src/family-help/stateMachine.ts";

test("native consent and active observations advance only the current generation", () => {
  assert.equal(nativeCaptureDecision("awaiting_capture_consent", "requesting_consent", true), "ignore");
  assert.equal(nativeCaptureDecision("awaiting_capture_consent", "starting", true), "connecting");
  assert.equal(nativeCaptureDecision("connecting", "active", true), "active");
  assert.equal(nativeCaptureDecision("connecting", "active", false), "ignore");
});

test("native failure and stop remain authoritative", () => {
  assert.equal(nativeCaptureDecision("active", "failed", true), "failed");
  assert.equal(nativeCaptureDecision("paused", "stopped", true), "ended");
  assert.equal(nativeCaptureDecision("ended", "active", true), "ignore");
});

test("pause resume and helper viewing are state fenced", () => {
  assert.equal(captureControlFor("active"), "pause"); assert.equal(captureControlFor("paused"), "resume");
  assert.equal(captureControlFor("connecting"), null); assert.equal(helperCanView("helper", "active"), true);
  assert.equal(helperCanView("sharer", "active"), false); assert.equal(helperCanView("helper", "ended"), false);
});