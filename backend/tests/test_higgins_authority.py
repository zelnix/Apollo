"""Package 5 — Evidence Integrity & Higgins Investigative Authority tests.

Exercises the actual production validate() function with structured test cases.
Tests the INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY standard:

1. INVESTIGATE: Evidence reference integrity, fabricated observations rejected
2. ASSESS: Assessment must be supported by findings, no contradictions
3. DIRECT: Action-needed requires actions with instructions, no empty actions
4. GUIDE: Recommended action must be set when actions exist
5. VERIFY: Completion must match examination state, unexamined evidence blocks 'complete'
6. Evidence integrity: no fabricated IDs, provenance preserved
7. Ordinary chat vs investigation permissions
"""
import pytest
from services.higgins.validation import validate


def _base_response(**overrides):
    """Build a minimal valid response dict for testing."""
    base = {
        "overview": "Test overview of the security assessment.",
        "explanationMarkdown": "# Explanation\nDetailed markdown explanation.",
        "assessment": "no_concern_found_within_scope",
        "attention": "none",
        "attentionReason": None,
        "findings": [],
        "uncertainties": [],
        "scope": "Tested the submitted evidence.",
        "sourceIds": [],
        "remainingEvidenceIds": [],
        "actions": [],
        "recommendedActionIndex": None,
        "question": None,
        "completion": "complete",
    }
    base.update(overrides)
    return base

EVIDENCE = {"ev-1", "ev-2", "ev-3"}
SOURCES = {"src-1", "src-2"}
CAPS = {"cap.settings.notifications"}


# ── 1. INVESTIGATE: Evidence Reference Integrity ────────────────────────────

class TestInvestigateReferences:

    def test_valid_finding_references_pass(self):
        data = _base_response(findings=[
            {"text": "Suspicious domain found", "basis": "observation", "confidence": "high",
             "evidenceIds": ["ev-1"], "sourceIds": ["src-1"], "supersedesFindingIds": []},
        ], sourceIds=["src-1"], assessment="concern_found", attention="action_needed",
           attentionReason="Phishing domain", actions=[{"kind": "instruction", "label": "Block",
           "instruction": "Block this domain.", "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
           recommendedActionIndex=0)
        response, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                                     capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert response is not None, f"Valid response rejected: {errors}"

    def test_unknown_evidence_id_rejected(self):
        data = _base_response(findings=[
            {"text": "Something found", "basis": "inference", "confidence": "medium",
             "evidenceIds": ["FAKE-ID"], "sourceIds": [], "supersedesFindingIds": []},
        ])
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("unknown ids" in e for e in errors)

    def test_unknown_source_id_rejected(self):
        data = _base_response(sourceIds=["FAKE-SOURCE"])
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("unknown ids" in e for e in errors)

    def test_fabricated_observation_without_evidence_rejected(self):
        """Observation basis without evidence IDs = fabricated observation."""
        data = _base_response(findings=[
            {"text": "I observed something", "basis": "observation", "confidence": "high",
             "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []},
        ])
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("observation" in e and "evidenceId" in e for e in errors)

    def test_inference_without_evidence_allowed(self):
        """Inference basis doesn't require evidence IDs."""
        data = _base_response(findings=[
            {"text": "Likely phishing", "basis": "inference", "confidence": "medium",
             "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []},
        ])
        response, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                                     capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert response is not None, f"Inference rejected: {errors}"


# ── 2. ASSESS: Assessment Must Be Supported ─────────────────────────────────

class TestAssessSupported:

    def test_concern_found_without_findings_rejected(self):
        """Assessment 'concern_found' requires at least one finding."""
        data = _base_response(assessment="concern_found", findings=[],
                               attention="action_needed", attentionReason="Something bad",
                               actions=[{"kind": "instruction", "label": "Fix", "instruction": "Fix it.",
                                         "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                               recommendedActionIndex=0)
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("concern_found" in e and "finding" in e for e in errors)

    def test_concern_found_with_findings_passes(self):
        data = _base_response(assessment="concern_found",
                               findings=[{"text": "Phishing detected", "basis": "observation", "confidence": "high",
                                          "evidenceIds": ["ev-1"], "sourceIds": [], "supersedesFindingIds": []}],
                               attention="action_needed", attentionReason="Phishing",
                               actions=[{"kind": "instruction", "label": "Block", "instruction": "Block the domain.",
                                         "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                               recommendedActionIndex=0)
        response, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                                     capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert response is not None, f"Valid concern rejected: {errors}"

    def test_no_concern_with_urgent_attention_contradicted(self):
        """no_concern + action_needed is a contradiction."""
        data = _base_response(assessment="no_concern_found_within_scope",
                               attention="action_needed", attentionReason="Something needs action",
                               actions=[{"kind": "instruction", "label": "Do", "instruction": "Do something.",
                                         "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                               recommendedActionIndex=0)
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("contradicted" in e for e in errors)


# ── 3. DIRECT: Actions Must Be Specific ─────────────────────────────────────

class TestDirectSpecific:

    def test_action_needed_without_actions_rejected(self):
        data = _base_response(attention="action_needed", attentionReason="Threat found",
                               assessment="concern_found",
                               findings=[{"text": "Bad thing", "basis": "inference", "confidence": "high",
                                          "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []}],
                               actions=[])
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("action" in e.lower() and "telling" in e.lower() for e in errors)

    def test_urgent_without_actions_rejected(self):
        data = _base_response(attention="urgent", attentionReason="Immediate threat",
                               assessment="concern_found",
                               findings=[{"text": "Critical", "basis": "inference", "confidence": "high",
                                          "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []}],
                               actions=[])
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("action" in e.lower() for e in errors)

    def test_empty_instruction_rejected(self):
        data = _base_response(attention="action_needed", attentionReason="Fix needed",
                               assessment="concern_found",
                               findings=[{"text": "Issue", "basis": "inference", "confidence": "high",
                                          "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []}],
                               actions=[{"kind": "instruction", "label": "Fix", "instruction": "",
                                         "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                               recommendedActionIndex=0)
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("non-empty instruction" in e for e in errors)

    def test_empty_label_rejected(self):
        data = _base_response(attention="action_needed", attentionReason="Fix needed",
                               assessment="concern_found",
                               findings=[{"text": "Issue", "basis": "inference", "confidence": "high",
                                          "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []}],
                               actions=[{"kind": "instruction", "label": "", "instruction": "Do this.",
                                         "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                               recommendedActionIndex=0)
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("non-empty label" in e for e in errors)

    def test_valid_action_passes(self):
        data = _base_response(attention="action_needed", attentionReason="Phishing detected",
                               assessment="concern_found",
                               findings=[{"text": "Phishing", "basis": "observation", "confidence": "high",
                                          "evidenceIds": ["ev-1"], "sourceIds": [], "supersedesFindingIds": []}],
                               actions=[{"kind": "instruction", "label": "Block domain",
                                         "instruction": "Go to Settings > Security > Block List and add evil.com.",
                                         "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                               recommendedActionIndex=0)
        response, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                                     capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert response is not None, f"Valid action rejected: {errors}"


# ── 4. GUIDE: Recommended Action Must Be Set ────────────────────────────────

class TestGuideRecommended:

    def test_actions_without_recommended_rejected(self):
        data = _base_response(attention="action_needed", attentionReason="Fix",
                               assessment="concern_found",
                               findings=[{"text": "Issue", "basis": "inference", "confidence": "high",
                                          "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []}],
                               actions=[{"kind": "instruction", "label": "Fix",
                                         "instruction": "Fix the thing.",
                                         "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                               recommendedActionIndex=None)
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("recommendedActionIndex" in e for e in errors)

    def test_out_of_range_recommended_rejected(self):
        data = _base_response(actions=[{"kind": "instruction", "label": "Fix",
                                         "instruction": "Fix it.",
                                         "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                               recommendedActionIndex=5)
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("out of range" in e for e in errors)

    def test_no_actions_no_recommended_passes(self):
        data = _base_response(actions=[], recommendedActionIndex=None)
        response, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                                     capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert response is not None, f"No-action response rejected: {errors}"


# ── 5. VERIFY: Completion Must Match Examination ────────────────────────────

class TestVerifyCompletion:

    def test_complete_with_unexamined_evidence_rejected(self):
        """Case 1: Gaps NOT in remainingEvidenceIds — completion='complete' rejected."""
        data = _base_response(completion="complete", remainingEvidenceIds=[])
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True,
                              material_gaps={"ev-2"})
        assert any("complete" in e and "unexamined" in e for e in errors)

    def test_complete_with_listed_gaps_also_rejected(self):
        """Case 2: Gaps listed in remainingEvidenceIds but completion still 'complete' — rejected.
        Material unexamined evidence blocks 'complete' regardless of listing."""
        data = _base_response(completion="complete", remainingEvidenceIds=["ev-2"])
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True,
                              material_gaps={"ev-2"})
        assert any("complete" in e for e in errors), \
            "completion='complete' must be rejected even when gaps are in remainingEvidenceIds"

    def test_partial_with_remaining_evidence_passes(self):
        data = _base_response(completion="partial", remainingEvidenceIds=["ev-2"])
        response, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                                     capability_ids=CAPS, pending_question=None, provider_complete=True,
                                     material_gaps={"ev-2"})
        assert response is not None, f"Partial rejected: {errors}"

    def test_waiting_user_without_question_rejected(self):
        data = _base_response(completion="waiting_user", question=None)
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("question" in e for e in errors)

    def test_waiting_user_with_question_passes(self):
        data = _base_response(completion="waiting_user",
                               question={"text": "Can you confirm?", "reasonNeeded": "Need consent",
                                         "answerType": "yes_no", "choices": []})
        response, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                                     capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert response is not None, f"Waiting with question rejected: {errors}"

    def test_incomplete_provider_output_flagged(self):
        data = _base_response()
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=False)
        assert any("incomplete" in e for e in errors)


# ── 6. Evidence Integrity ───────────────────────────────────────────────────

class TestEvidenceIntegrity:

    def test_unknown_remaining_evidence_rejected(self):
        data = _base_response(completion="partial", remainingEvidenceIds=["FAKE-EV"])
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("unknown ids" in e for e in errors)

    def test_capability_action_needs_valid_id(self):
        data = _base_response(attention="action_needed", attentionReason="Settings change",
                               assessment="concern_found",
                               findings=[{"text": "Issue", "basis": "inference", "confidence": "high",
                                          "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []}],
                               actions=[{"kind": "open_settings", "label": "Open Settings",
                                         "instruction": "Turn on notifications.",
                                         "capabilityId": "FAKE-CAP", "sourceIds": [],
                                         "desiredField": "enabled", "desiredValue": True}],
                               recommendedActionIndex=0)
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("capabilityId" in e for e in errors)

    def test_valid_capability_action_passes(self):
        data = _base_response(attention="action_needed", attentionReason="Enable notifications",
                               assessment="concern_found",
                               findings=[{"text": "Notifications disabled", "basis": "observation", "confidence": "high",
                                          "evidenceIds": ["ev-1"], "sourceIds": [], "supersedesFindingIds": []}],
                               actions=[{"kind": "open_settings", "label": "Enable Notifications",
                                         "instruction": "Turn on notification access.",
                                         "capabilityId": "cap.settings.notifications", "sourceIds": [],
                                         "desiredField": "enabled", "desiredValue": True}],
                               recommendedActionIndex=0)
        response, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                                     capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert response is not None, f"Valid capability action rejected: {errors}"


# ── 7. System Prompt Verification ───────────────────────────────────────────

class TestSystemPromptStandard:
    """Verify system prompts contain the INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY standard."""

    def test_coordinator_system_prompt(self):
        from services.higgins.coordinator import SYSTEM
        for section in ["INVESTIGATE:", "ASSESS:", "DIRECT:", "GUIDE:", "VERIFY:"]:
            assert section in SYSTEM, f"Coordinator system prompt must contain {section}"

    def test_chat_system_prompt(self):
        from services.higgins.chat import SYSTEM
        assert "INVESTIGATE" in SYSTEM
        assert "ASSESS" in SYSTEM
        assert "DIRECT" in SYSTEM
        assert "GUIDE" in SYSTEM
        assert "VERIFY" in SYSTEM

    def test_coordinator_prohibits_fabrication(self):
        from services.higgins.coordinator import SYSTEM
        assert "cannot invent" in SYSTEM or "fabricat" in SYSTEM.lower() or "never say Apollo blocked" in SYSTEM

    def test_coordinator_requires_directive_language(self):
        from services.higgins.coordinator import SYSTEM
        assert "you may want to" in SYSTEM.lower() or "Never use vague" in SYSTEM

    def test_chat_read_only_restrictions(self):
        from services.higgins.chat import SYSTEM
        assert "cannot start an investigation" in SYSTEM or "cannot browse" in SYSTEM


# ── 8. Response Structure Verification ──────────────────────────────────────

class TestResponseStructure:
    """Verify the HigginsResponse model enforces the required structure."""

    def test_finding_has_required_fields(self):
        from services.higgins.contracts import Finding
        f = Finding(id="f1", text="test", basis="inference", confidence="medium")
        assert f.evidence_ids == []
        assert f.source_ids == []

    def test_action_has_required_fields(self):
        from services.higgins.contracts import ActionProposal
        a = ActionProposal(id="a1", kind="instruction", label="Do this", instruction="Step 1")
        assert a.requires_user_gesture is True
        assert a.capability_id is None

    def test_response_completion_is_required(self):
        from services.higgins.contracts import HigginsResponse
        import pydantic
        with pytest.raises(pydantic.ValidationError):
            HigginsResponse(revision=1, overview="", explanation_markdown="",
                           assessment="uncertain", attention="none")  # Missing completion

    def test_attention_reason_required_for_action_needed(self):
        """validate() must reject action_needed without attentionReason."""
        data = _base_response(attention="action_needed", attentionReason=None,
                               assessment="concern_found",
                               findings=[{"text": "Issue", "basis": "inference", "confidence": "high",
                                          "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []}],
                               actions=[{"kind": "instruction", "label": "Fix", "instruction": "Fix it.",
                                         "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                               recommendedActionIndex=0)
        _, errors = validate(data, revision=1, evidence_ids=EVIDENCE, source_ids=SOURCES,
                              capability_ids=CAPS, pending_question=None, provider_complete=True)
        assert any("attentionReason" in e for e in errors)
