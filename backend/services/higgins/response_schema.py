"""The response Apollo requires from Gemini, expressed as Gemini's own structured-output schema.

This is the ONLY place the required response shape is stated. It is never repeated or explained in
the prompt: the request sent to Gemini is the person's question, the complete case evidence, and this
schema. Field names are the wire (camelCase) names the validator in `validation.py` accepts, and the
enums are the literal values `contracts.py` defines — a schema drift here fails validation, which is
reported honestly rather than reshaped into a result.
"""
from __future__ import annotations

from google.genai import types

_STRING = types.Schema(type="STRING")
_STRING_LIST = types.Schema(type="ARRAY", items=types.Schema(type="STRING"))


def _enum(values: list[str], description: str) -> types.Schema:
    return types.Schema(type="STRING", enum=values, description=description)


_FINDING = types.Schema(
    type="OBJECT",
    properties={
        "text": types.Schema(type="STRING", description="One fact or inference, stated once. Each finding is a "
                                                        "distinct observation: anything describing the same underlying "
                                                        "issue is merged into one consolidated finding rather than "
                                                        "returned as several near-identical versions. Equivalent "
                                                        "hostnames (example.com and www.example.com) are the same "
                                                        "destination."),
        "basis": _enum(["observation", "user_report", "inference"],
                       "observation: present in the supplied evidence (requires at least one evidenceId). "
                       "user_report: stated by the person. inference: reasoned from the evidence."),
        "confidence": _enum(["low", "medium", "high"], "Confidence in this finding."),
        "evidenceIds": types.Schema(type="ARRAY", items=_STRING,
                                    description="Ids of the supplied evidence items this finding rests on."),
        "sourceIds": types.Schema(type="ARRAY", items=_STRING, description="Ids of registered sources, if any."),
        "supersedesFindingIds": types.Schema(type="ARRAY", items=_STRING,
                                             description="Ids of earlier findings this replaces, if any."),
    },
    required=["text", "basis", "confidence", "evidenceIds", "sourceIds", "supersedesFindingIds"],
)

_ACTION = types.Schema(
    type="OBJECT",
    properties={
        "kind": _enum(["instruction", "open_settings", "request_permission", "recheck", "open_verified_source"],
                      "Use 'instruction' unless a device capabilityId or a registered sourceId is available."),
        "label": types.Schema(type="STRING", description="Short button label."),
        "instruction": types.Schema(type="STRING", description="What the person does — the action only. It does not "
                                                               "restate a finding or re-explain the reasoning."),
        "capabilityId": types.Schema(type="STRING", nullable=True,
                                     description="Only for kinds that act on the device; otherwise null."),
        "sourceIds": types.Schema(type="ARRAY", items=_STRING, description="Required for open_verified_source."),
        "desiredField": types.Schema(type="STRING", nullable=True),
        "desiredValue": types.Schema(type="STRING", nullable=True),
    },
    required=["kind", "label", "instruction", "capabilityId", "sourceIds", "desiredField", "desiredValue"],
)

_QUESTION = types.Schema(
    type="OBJECT",
    nullable=True,
    properties={
        "text": types.Schema(type="STRING", description="The question to put to the person."),
        "reasonNeeded": types.Schema(type="STRING", description="Why the answer is needed."),
        "answerType": _enum(["text", "yes_no", "choice"], "Expected answer form."),
        "choices": types.Schema(type="ARRAY", items=_STRING, description="Choices when answerType is 'choice'."),
    },
    required=["text", "reasonNeeded", "answerType", "choices"],
)

RESPONSE_SCHEMA = types.Schema(
    type="OBJECT",
    properties={
        "overview": types.Schema(type="STRING", description="2-4 plain sentences: what this is and what to do now. "
                                                            "The overall conclusion only — it does not enumerate the "
                                                            "evidence, list the findings or repeat any finding's text."),
        "explanationMarkdown": types.Schema(type="STRING", description="The briefing shown to the person, in Markdown: "
                                                                      "why the findings matter and how they fit "
                                                                      "together. It does not restate the overview and "
                                                                      "does not re-list the findings, uncertainties, "
                                                                      "scope or actions — each of those is returned in "
                                                                      "its own field and is displayed separately."),
        "assessment": _enum(["concern_found", "no_concern_found_within_scope", "uncertain"],
                            "'concern_found' requires at least one finding."),
        "attention": _enum(["none", "review", "action_needed", "urgent"],
                           "'action_needed'/'urgent' require attentionReason and at least one action."),
        "attentionReason": types.Schema(type="STRING", nullable=True, description="One sentence on why this needs the "
                                                                                 "person's attention — the consequence "
                                                                                 "of acting on it. Never a copy of a "
                                                                                 "finding or of the overview. Null when "
                                                                                 "attention is 'none'."),
        "findings": types.Schema(type="ARRAY", items=_FINDING, description="The evidence-backed facts. Compare them "
                                                                           "before answering and merge any that make "
                                                                           "the same point."),
        "uncertainties": types.Schema(type="ARRAY", items=_STRING, description="What could not be established."),
        "scope": types.Schema(type="STRING", description="What this investigation did and did not cover."),
        "sourceIds": types.Schema(type="ARRAY", items=_STRING, description="Registered sourceIds relied on."),
        "remainingEvidenceIds": types.Schema(type="ARRAY", items=_STRING, description="Supplied evidence left unexamined."),
        "actions": types.Schema(type="ARRAY", items=_ACTION),
        "recommendedActionIndex": types.Schema(type="INTEGER", nullable=True,
                                               description="Index of the primary action; required when actions are present."),
        "question": _QUESTION,
        "completion": _enum(["complete", "partial", "waiting_user"],
                            "'waiting_user' requires a question; 'partial' when evidence remains unexamined."),
    },
    required=["overview", "explanationMarkdown", "assessment", "attention", "attentionReason", "findings",
              "uncertainties", "scope", "sourceIds", "remainingEvidenceIds", "actions", "recommendedActionIndex",
              "completion"],
)
