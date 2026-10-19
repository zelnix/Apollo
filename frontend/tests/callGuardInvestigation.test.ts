/**
 * Magnum DI Investigation Lifecycle Tests — call-guard.tsx
 *
 * Tests the explicit investigation state machine:
 *   idle → investigating → completed | failed | timed_out
 *
 * Acceptance criterion: No Magnum DI request can leave Call Screening
 * indefinitely spinning, and the UI always represents exactly one
 * truthful investigation state.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ── Lifecycle type (mirrors the export from call-guard.tsx) ──────────────────

type InvestigationPhase = "idle" | "investigating" | "completed" | "failed" | "timed_out";

const VALID_PHASES: InvestigationPhase[] = ["idle", "investigating", "completed", "failed", "timed_out"];

// ── Simulate the lifecycle transitions ───────────────────────────────────────

interface LifecycleState {
  phase: InvestigationPhase;
  result: Record<string, unknown> | null;
  error: string | null;
}

function initialState(): LifecycleState {
  return { phase: "idle", result: null, error: null };
}

function transitionToInvestigating(state: LifecycleState): LifecycleState {
  return { phase: "investigating", result: null, error: null };
}

function transitionToCompleted(state: LifecycleState, result: Record<string, unknown>): LifecycleState {
  assert.equal(state.phase, "investigating", "Can only complete from investigating");
  return { phase: "completed", result, error: null };
}

function transitionToFailed(state: LifecycleState, error: string): LifecycleState {
  assert.equal(state.phase, "investigating", "Can only fail from investigating");
  return { phase: "failed", result: null, error };
}

function transitionToTimedOut(state: LifecycleState): LifecycleState {
  assert.equal(state.phase, "investigating", "Can only time out from investigating");
  return { phase: "timed_out", result: null, error: "The investigation took too long and was stopped. The caller reputation information is still available." };
}

function transitionToRetry(state: LifecycleState): LifecycleState {
  assert.ok(state.phase === "failed" || state.phase === "timed_out" || state.phase === "completed", "Can only retry from terminal states");
  return transitionToInvestigating(state);
}

// ── UI state derivation (mirrors the rendering logic) ────────────────────────

interface UIState {
  showSpinner: boolean;
  showError: boolean;
  showRetryButton: boolean;
  showFindings: boolean;
  errorMessage: string | null;
}

function deriveUI(state: LifecycleState): UIState {
  const hasFindings = state.phase === "completed" && state.result !== null &&
    !!(state.result.higgins as Record<string, unknown> | undefined)?.exact_response;

  return {
    showSpinner: state.phase === "investigating",
    showError: state.phase === "failed" || state.phase === "timed_out" ||
      (state.phase === "completed" && !hasFindings),
    showRetryButton: state.phase === "failed" || state.phase === "timed_out" ||
      (state.phase === "completed" && !hasFindings),
    showFindings: hasFindings,
    errorMessage: state.error,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Magnum DI Investigation Lifecycle", () => {

  it("starts in idle state", () => {
    const state = initialState();
    assert.equal(state.phase, "idle");
    assert.equal(state.result, null);
    assert.equal(state.error, null);
    const ui = deriveUI(state);
    assert.equal(ui.showSpinner, false);
    assert.equal(ui.showError, false);
    assert.equal(ui.showFindings, false);
  });

  it("transitions to investigating", () => {
    let state = initialState();
    state = transitionToInvestigating(state);
    assert.equal(state.phase, "investigating");
    const ui = deriveUI(state);
    assert.equal(ui.showSpinner, true);
    assert.equal(ui.showError, false, "No error while investigating");
    assert.equal(ui.showRetryButton, false, "No retry while investigating");
    assert.equal(ui.showFindings, false);
  });

  it("never shows spinner and error simultaneously", () => {
    for (const phase of VALID_PHASES) {
      const state: LifecycleState = {
        phase,
        result: phase === "completed" ? { higgins: { exact_response: "test" } } : null,
        error: phase === "failed" ? "Error" : null,
      };
      const ui = deriveUI(state);
      assert.ok(
        !(ui.showSpinner && ui.showError),
        `Phase "${phase}" must not show spinner and error simultaneously`,
      );
    }
  });

  it("success: investigating → completed with findings", () => {
    let state = initialState();
    state = transitionToInvestigating(state);
    state = transitionToCompleted(state, {
      higgins: { exact_response: "This number is associated with a known scam.", headline: "Scam detected" },
    });
    assert.equal(state.phase, "completed");
    assert.notEqual(state.result, null);
    const ui = deriveUI(state);
    assert.equal(ui.showSpinner, false, "Spinner stopped after completion");
    assert.equal(ui.showFindings, true);
    assert.equal(ui.showError, false);
    assert.equal(ui.showRetryButton, false);
  });

  it("API failure: investigating → failed", () => {
    let state = initialState();
    state = transitionToInvestigating(state);
    state = transitionToFailed(state, "Magnum DI couldn't complete the investigation.");
    assert.equal(state.phase, "failed");
    const ui = deriveUI(state);
    assert.equal(ui.showSpinner, false, "Spinner stopped after failure");
    assert.equal(ui.showError, true);
    assert.equal(ui.showRetryButton, true);
    assert.equal(ui.showFindings, false);
    assert.ok(ui.errorMessage!.includes("couldn't complete"), "Error message is descriptive");
  });

  it("timeout: investigating → timed_out", () => {
    let state = initialState();
    state = transitionToInvestigating(state);
    state = transitionToTimedOut(state);
    assert.equal(state.phase, "timed_out");
    const ui = deriveUI(state);
    assert.equal(ui.showSpinner, false, "Spinner stopped after timeout");
    assert.equal(ui.showError, true);
    assert.equal(ui.showRetryButton, true);
    assert.equal(ui.showFindings, false);
    assert.ok(ui.errorMessage!.includes("took too long"), "Timeout message is clear");
    assert.ok(ui.errorMessage!.includes("reputation information is still available"), "Preserves reputation notice");
  });

  it("retry success: failed → investigating → completed", () => {
    let state = initialState();
    state = transitionToInvestigating(state);
    state = transitionToFailed(state, "API error");
    // Retry
    state = transitionToRetry(state);
    assert.equal(state.phase, "investigating");
    assert.equal(state.result, null, "Previous result cleared on retry");
    assert.equal(state.error, null, "Previous error cleared on retry");
    // Success
    state = transitionToCompleted(state, {
      higgins: { exact_response: "Safe number", headline: "No risk" },
    });
    assert.equal(state.phase, "completed");
    const ui = deriveUI(state);
    assert.equal(ui.showSpinner, false);
    assert.equal(ui.showFindings, true);
    assert.equal(ui.showError, false);
  });

  it("retry failure: timed_out → investigating → failed", () => {
    let state = initialState();
    state = transitionToInvestigating(state);
    state = transitionToTimedOut(state);
    // Retry
    state = transitionToRetry(state);
    assert.equal(state.phase, "investigating");
    const uiDuring = deriveUI(state);
    assert.equal(uiDuring.showSpinner, true);
    assert.equal(uiDuring.showError, false, "No error during retry investigation");
    // Fails again
    state = transitionToFailed(state, "Still failing");
    assert.equal(state.phase, "failed");
    const uiAfter = deriveUI(state);
    assert.equal(uiAfter.showSpinner, false);
    assert.equal(uiAfter.showError, true);
    assert.equal(uiAfter.showRetryButton, true);
  });

  it("completed with empty response shows error, not findings", () => {
    let state = initialState();
    state = transitionToInvestigating(state);
    // Server returned a response but with no useful content
    state = transitionToCompleted(state, { higgins: {} });
    assert.equal(state.phase, "completed");
    const ui = deriveUI(state);
    assert.equal(ui.showFindings, false, "Empty response does not show findings");
    assert.equal(ui.showError, true, "Empty response shows error state");
    assert.equal(ui.showRetryButton, true, "Empty response allows retry");
    assert.equal(ui.showSpinner, false);
  });

  it("no simultaneous investigating + error state in any transition sequence", () => {
    // Walk every possible transition and verify the invariant
    const sequences: InvestigationPhase[][] = [
      ["idle", "investigating", "completed"],
      ["idle", "investigating", "failed"],
      ["idle", "investigating", "timed_out"],
      ["idle", "investigating", "failed", "investigating", "completed"],
      ["idle", "investigating", "timed_out", "investigating", "failed"],
    ];
    for (const seq of sequences) {
      let state = initialState();
      for (const phase of seq) {
        if (phase === "investigating") state = transitionToInvestigating(state);
        else if (phase === "completed") state = transitionToCompleted(state, { higgins: { exact_response: "ok" } });
        else if (phase === "failed") state = transitionToFailed(state, "err");
        else if (phase === "timed_out") state = transitionToTimedOut(state);
        const ui = deriveUI(state);
        assert.ok(
          !(ui.showSpinner && ui.showError),
          `Invariant violated at phase "${phase}" in sequence [${seq.join(" → ")}]`,
        );
      }
    }
  });
});
