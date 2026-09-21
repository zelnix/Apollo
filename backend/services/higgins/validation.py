"""Interface validation of Gemini's structured response (spec §7/§9): references, actions, completion.

No keyword/style filters. Violations are returned to the model for one targeted repair.
"""
from __future__ import annotations

import uuid
from typing import Optional

from pydantic import ValidationError

from services.higgins.contracts import ActionProposal, Finding, HigginsResponse, ModelResponse, Question

CAPABILITY_ACTIONS = {"open_settings", "request_permission", "recheck"}


def validate(data: dict, *, revision: int, evidence_ids: set[str], source_ids: set[str], capability_ids: set[str],
             pending_question: Optional[dict], provider_complete: bool) -> tuple[Optional[HigginsResponse], list[str]]:
    errors: list[str] = []
    try:
        model = ModelResponse.model_validate(data)
    except ValidationError as exc:
        return None, [f"schema: {e['loc']} {e['msg']}" for e in exc.errors()[:8]]
    if not provider_complete:
        errors.append("provider finish was not normal termination; the response is incomplete")
    for idx, finding in enumerate(model.findings):
        unknown = [e for e in finding.evidence_ids if e not in evidence_ids] + [s for s in finding.source_ids if s not in source_ids]
        if unknown:
            errors.append(f"findings[{idx}] references unknown ids {unknown[:3]}; use only registered evidenceIds/sourceIds or leave the lists empty")
        if finding.basis == "observation" and not finding.evidence_ids:
            errors.append(f"findings[{idx}] basis 'observation' requires at least one evidenceId; otherwise label it 'inference'")
    unknown_sources = [s for s in model.source_ids if s not in source_ids]
    if unknown_sources:
        errors.append(f"sourceIds contains unknown ids {unknown_sources[:3]}")
    unknown_remaining = [e for e in model.remaining_evidence_ids if e not in evidence_ids]
    if unknown_remaining:
        errors.append(f"remainingEvidenceIds contains unknown ids {unknown_remaining[:3]}")
    for idx, action in enumerate(model.actions):
        if action.kind in CAPABILITY_ACTIONS and (not action.capability_id or action.capability_id not in capability_ids):
            errors.append(f"actions[{idx}] kind '{action.kind}' needs a capabilityId advertised by the device profile {sorted(capability_ids)[:6]}; otherwise use kind 'instruction'")
        if action.kind == "open_verified_source" and not all(s in source_ids for s in action.source_ids):
            errors.append(f"actions[{idx}] open_verified_source must cite registered sourceIds")
        if action.kind == "open_verified_source" and not action.source_ids:
            errors.append(f"actions[{idx}] open_verified_source requires a sourceId")
    if model.recommended_action_index is not None and not (0 <= model.recommended_action_index < len(model.actions)):
        errors.append("recommendedActionIndex is out of range")
    if model.completion == "waiting_user" and not (model.question or pending_question):
        errors.append("completion 'waiting_user' requires a question")
    if model.question and model.completion != "waiting_user":
        errors.append("a question requires completion 'waiting_user'")
    if model.attention in ("action_needed", "urgent") and not model.attention_reason:
        errors.append("attention 'action_needed'/'urgent' requires attentionReason tied to findings")
    if errors:
        return None, errors
    actions = [ActionProposal(id=str(uuid.uuid4()), kind=a.kind, label=a.label[:120], instruction=a.instruction, capability_id=a.capability_id,
                              execution_descriptor_id=None, requires_user_gesture=a.kind != "instruction", source_ids=a.source_ids) for a in model.actions]
    question = None
    if model.question:
        question = Question(id=(pending_question or {}).get("id", str(uuid.uuid4())), text=model.question.text, reason_needed=model.question.reason_needed,
                            answer_type=model.question.answer_type, choices=model.question.choices)
    elif model.completion == "waiting_user" and pending_question:
        question = Question.model_validate(pending_question)
    response = HigginsResponse(revision=revision, overview=model.overview, explanation_markdown=model.explanation_markdown, assessment=model.assessment,
                               attention=model.attention, attention_reason=model.attention_reason,
                               findings=[Finding(id=str(uuid.uuid4()), **f.model_dump()) for f in model.findings], uncertainties=model.uncertainties,
                               scope=model.scope, source_ids=model.source_ids, remaining_evidence_ids=model.remaining_evidence_ids, actions=actions,
                               recommended_action_id=actions[model.recommended_action_index].id if model.recommended_action_index is not None and actions else None,
                               question=question, completion=model.completion)
    return response, []
