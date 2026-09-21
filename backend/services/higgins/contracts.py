"""Authoritative wire contracts for the shared investigation case (spec §4, §8).

Strict models: unknown fields are rejected. camelCase on the wire, snake_case in code.
IDs are opaque server-issued UUIDs; timestamps are UTC ISO 8601.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Gate = Literal["site", "link", "text", "call", "network", "account", "email", "app", "file", "device"]
CaseStatus = Literal["queued", "investigating", "waiting_device", "waiting_user", "retry_wait", "partial", "complete", "failed", "cancelled", "expired"]
Origin = Literal["user_submission", "device_observation", "external_source", "apollo_inference"]
CoverageStatus = Literal["not_started", "partial", "examined", "unavailable", "out_of_scope"]
Assessment = Literal["concern_found", "no_concern_found_within_scope", "uncertain"]
Attention = Literal["none", "review", "action_needed", "urgent"]
Completion = Literal["complete", "partial", "waiting_user"]
FailureCode = Literal["invalid_input", "unauthenticated", "not_found", "conflict", "provider_configuration", "rate_limited",
                      "provider_unavailable", "transport_interrupted", "incomplete_output", "unsupported_format", "evidence_expired",
                      "budget_exhausted", "device_unavailable", "permission_denied", "response_invalid", "cleanup_failed"]
EvidenceKind = Literal["text", "url", "image", "document", "audio", "attachment", "observation", "source_snapshot"]
Platform = Literal["android", "ios", "windows", "macos", "web"]
UUID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{3,79}$"


class Wire(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json")


class Range(Wire):
    start: int = Field(ge=0)
    end: int = Field(ge=0)


class OmittedRange(Range):
    reason: str


class Coverage(Wire):
    status: CoverageStatus = "not_started"
    unit: Literal["bytes", "characters", "pages", "items"] = "characters"
    total: Optional[int] = None
    examined: int = 0
    examined_ranges: list[Range] = Field(default_factory=list)
    omitted_ranges: list[OmittedRange] = Field(default_factory=list)
    reason: Optional[str] = None
    material_gap: bool = False


class Simulation(Wire):
    kind: Literal["preview_device"] = "preview_device"
    label: str
    fixture_id: str


class Transformation(Wire):
    kind: Literal["secret_redaction", "ocr", "decode", "chunk", "normalise"]
    description: str
    source_start: Optional[int] = None
    source_end: Optional[int] = None


class EvidenceItem(Wire):
    id: str
    case_id: str
    client_item_id: str
    origin: Origin
    kind: EvidenceKind
    parent_id: Optional[str] = None
    related_evidence_ids: list[str] = Field(default_factory=list)
    collected_at: datetime
    observed_at: Optional[datetime] = None
    expires_at: datetime
    availability: Literal["available", "unavailable", "permission_required", "purged"] = "available"
    media_type: Optional[str] = None
    byte_length: Optional[int] = None
    coverage: Coverage = Field(default_factory=Coverage)
    simulation: Optional[Simulation] = None
    transformations: list[Transformation] = Field(default_factory=list)
    label: str = ""  # short non-secret display label (filename kind, host, "observation: x")


class SourceReference(Wire):
    id: str
    url: str
    title: str
    retrieved_at: datetime
    retrieval: Literal["fetched", "search_result", "unavailable"]
    authority: Literal["official", "independent", "self_claimed", "unknown"] = "unknown"
    authority_basis: str = ""
    published_at: Optional[datetime] = None
    evidence_ids: list[str] = Field(default_factory=list)


class Finding(Wire):
    id: str
    text: str
    basis: Literal["observation", "user_report", "inference"]
    confidence: Literal["low", "medium", "high"]
    evidence_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    supersedes_finding_ids: list[str] = Field(default_factory=list)


class Question(Wire):
    id: str
    text: str
    reason_needed: str
    answer_type: Literal["text", "yes_no", "choice"] = "text"
    choices: list[str] = Field(default_factory=list)


ActionKind = Literal["instruction", "open_settings", "request_permission", "recheck", "open_verified_source"]


class ActionProposal(Wire):
    id: str
    kind: ActionKind
    label: str
    instruction: str
    capability_id: Optional[str] = None
    execution_descriptor_id: Optional[str] = None
    requires_user_gesture: bool = True
    source_ids: list[str] = Field(default_factory=list)
    # Structured intent for open_settings/request_permission actions, supplied by Higgins — the client binds a
    # SettingsPlan to exactly this field/value and NEVER infers a direction from the label/instruction wording.
    # Both are null when there is no single observable target (the plan is then left unresolvable by design).
    desired_field: Optional[str] = None
    desired_value: Union[bool, str, None] = None


class HigginsResponse(Wire):
    revision: int
    overview: str
    explanation_markdown: str
    assessment: Assessment
    attention: Attention
    attention_reason: Optional[str] = None
    findings: list[Finding] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    scope: str = ""
    source_ids: list[str] = Field(default_factory=list)
    remaining_evidence_ids: list[str] = Field(default_factory=list)
    actions: list[ActionProposal] = Field(default_factory=list)
    recommended_action_id: Optional[str] = None
    question: Optional[Question] = None
    completion: Completion


class Inventory(Wire):
    total: int = 0
    examined: int = 0
    partial: int = 0
    unavailable: int = 0
    purged: int = 0


class InvestigationCase(Wire):
    schema_version: Literal[1] = 1
    id: str
    revision: int
    gates: list[Gate]
    status: CaseStatus
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
    response: Optional[HigginsResponse] = None
    active_job_id: Optional[str] = None
    pending_device_request_ids: list[str] = Field(default_factory=list)
    inventory: Inventory = Field(default_factory=Inventory)
    cleanup_status: Literal["not_due", "pending", "complete", "failed"] = "not_due"


class Failure(Wire):
    code: FailureCode
    message: str
    retryable: bool = False
    retry_after_seconds: Optional[int] = None
    missing_evidence_ids: list[str] = Field(default_factory=list)


class Job(Wire):
    id: str
    case_id: str
    turn_id: str
    status: CaseStatus
    started_at: Optional[datetime] = None
    deadline_at: datetime
    retry_at: Optional[datetime] = None
    attempt: int = 0
    last_event_sequence: int = 0
    failure: Optional[Failure] = None


class DeviceProfile(Wire):
    platform: Platform
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    os_version: Optional[str] = None
    form_factor: Literal["phone", "tablet", "desktop", "laptop", "convertible", "unknown"] = "unknown"
    locale: str = "en-AU"
    evidence_origin: Literal["native", "user_reported", "browser"] = "browser"
    capability_ids: list[str] = Field(default_factory=list)


class DeviceRequest(Wire):
    id: str
    case_id: str
    case_revision: int
    capability_id: str
    fields: list[str]
    reason: str
    expires_at: datetime


DeviceValue = Union[str, int, float, bool, list[str], None]


UnavailableReason = Literal["not_implemented", "os_restricted", "hardware_absent", "configuration_missing", "entitlement_missing", "adapter_failed"]


class DeviceResult(Wire):
    request_id: str
    case_revision: int
    capability_id: str
    status: Literal["observed", "unavailable", "permission_required", "denied", "failed"]
    observed_at: Optional[datetime] = None
    values: dict[str, DeviceValue] = Field(default_factory=dict)
    simulation: Optional[Simulation] = None
    # An observed result has no unavailable reason; an unavailable/failed result states its actual reason.
    unavailable_reason: Optional[UnavailableReason] = None


class ExpectedObservation(Wire):
    capability_id: str
    field: str
    expected_value: Union[bool, str]


class SettingsPlan(Wire):
    id: str
    case_id: str
    target: str
    device: DeviceProfile
    match: Literal["exact", "platform_only", "unresolved"]
    mode: Literal["permission_request", "settings_link", "instructions"]
    instructions: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    execution_descriptor_id: Optional[str] = None
    expected_observation: Optional[ExpectedObservation] = None


class RecheckResult(Wire):
    plan_id: str
    checked_at: datetime
    outcome: Literal["correct", "not_yet_correct", "cannot_observe", "failed"]
    evidence_ids: list[str] = Field(default_factory=list)
    explanation: str


class Usage(Wire):
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


class ProviderResult(Wire):
    provider: Literal["gemini"] = "gemini"
    model: str
    api_version: str = "v1beta"
    finish_reason: str
    provider_complete: bool
    usage: Usage = Field(default_factory=Usage)
    source_ids: list[str] = Field(default_factory=list)


class TurnCommit(Wire):
    turn_id: str
    case_id: str
    input_revision: int
    committed_revision: int
    question: str
    answer_to_question_id: Optional[str] = None
    response: HigginsResponse
    provider: ProviderResult
    evidence_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    committed_at: datetime


# ------------------------------------------------------------------ requests
class Submission(Wire):
    client_item_id: str = Field(pattern=UUID_PATTERN)
    kind: Literal["text", "url"]
    value: str = Field(min_length=1)
    label: str = Field(default="", max_length=80)


class CreateCase(Wire):
    gate: Optional[Gate] = None  # None = general Higgins question not tied to one Gate
    question: str = Field(default="", max_length=4000)  # blank = open the case, attach evidence first, then submit the first turn
    submissions: list[Submission] = Field(default_factory=list)
    initial_finding_refs: list[str] = Field(default_factory=list)
    initial_findings: list[str] = Field(default_factory=list)  # Apollo observations (apollo_inference origin), full text
    device_profile: Optional[DeviceProfile] = None


class TextSubmission(Wire):
    expected_revision: int
    client_item_id: str = Field(pattern=UUID_PATTERN)
    parent_id: Optional[str] = None
    kind: Literal["text"]
    text: str = Field(min_length=1)
    label: str = Field(default="", max_length=80)


class UrlSubmission(Wire):
    expected_revision: int
    client_item_id: str = Field(pattern=UUID_PATTERN)
    parent_id: Optional[str] = None
    kind: Literal["url"]
    url: str = Field(min_length=4)
    label: str = Field(default="", max_length=80)


class ObservationSubmission(Wire):
    expected_revision: int
    client_item_id: str = Field(pattern=UUID_PATTERN)
    parent_id: Optional[str] = None
    kind: Literal["observation"]
    device_result: DeviceResult


EvidenceSubmission = Union[TextSubmission, UrlSubmission, ObservationSubmission]


class UploadMetadata(Wire):
    expected_revision: int
    client_item_id: str = Field(pattern=UUID_PATTERN)
    parent_id: Optional[str] = None
    kind: Literal["image", "document", "audio", "attachment"]
    filename: str = Field(min_length=1, max_length=255)
    media_type: str = Field(min_length=3, max_length=120)


class CreateUpload(UploadMetadata):
    declared_bytes: int = Field(ge=1)


class SubmitTurn(Wire):
    expected_revision: int
    turn_id: str = Field(pattern=UUID_PATTERN)
    message: str = Field(min_length=1)
    answer_to_question_id: Optional[str] = None
    evidence_ids: list[str] = Field(default_factory=list)


class ExpectedRevision(Wire):
    expected_revision: int


class SettingsPlanRequest(Wire):
    expected_revision: int
    target: str = Field(min_length=1, max_length=200)
    device: DeviceProfile
    capability_id: Optional[str] = None  # supported action descriptor the plan is bound to (must be advertised by the device)
    expected_field: str = "enabled"
    expected_value: Union[bool, str, None] = None  # intended target value (e.g. False for "disable"); None = cannot be observed


class RecheckRequest(Wire):
    device_result_ids: list[str]


class SpeechRequest(Wire):
    response_revision: int
    section: Literal["overview", "explanation"]


class ReportRequest(Wire):
    response_revision: int


# ------------------------------------------------------------------ model-facing (IDs assigned by coordinator)
class ModelFinding(Wire):
    text: str
    basis: Literal["observation", "user_report", "inference"]
    confidence: Literal["low", "medium", "high"]
    evidence_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    supersedes_finding_ids: list[str] = Field(default_factory=list)


class ModelAction(Wire):
    kind: ActionKind
    label: str
    instruction: str
    capability_id: Optional[str] = None
    source_ids: list[str] = Field(default_factory=list)
    desired_field: Optional[str] = None
    desired_value: Union[bool, str, None] = None


class ModelQuestion(Wire):
    text: str
    reason_needed: str
    answer_type: Literal["text", "yes_no", "choice"] = "text"
    choices: list[str] = Field(default_factory=list)


class ModelResponse(Wire):
    overview: str = Field(min_length=1)
    explanation_markdown: str = Field(min_length=1)
    assessment: Assessment
    attention: Attention
    attention_reason: Optional[str] = None
    findings: list[ModelFinding] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    scope: str = ""
    source_ids: list[str] = Field(default_factory=list)
    remaining_evidence_ids: list[str] = Field(default_factory=list)
    actions: list[ModelAction] = Field(default_factory=list)
    recommended_action_index: Optional[int] = None
    question: Optional[ModelQuestion] = None
    completion: Completion


MODEL_RESPONSE_SCHEMA = ModelResponse.model_json_schema(by_alias=True)


def failure_body(code: FailureCode, message: str, *, retryable: bool = False, retry_after: Optional[int] = None,
                 missing: Optional[list[str]] = None) -> dict:
    return {"error": Failure(code=code, message=message, retryable=retryable, retry_after_seconds=retry_after,
                             missing_evidence_ids=missing or []).wire()}
