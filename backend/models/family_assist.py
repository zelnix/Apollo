"""Closed FF10 Family Assist contracts. No media-bearing field belongs here."""
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FamilyAssistState(StrEnum):
    CREATED = "created"
    INVITED = "invited"
    HELPER_ACCEPTED = "helper_accepted"
    AWAITING_CAPTURE_CONSENT = "awaiting_capture_consent"
    CONNECTING = "connecting"
    ACTIVE = "active"
    PAUSED = "paused"
    ENDING = "ending"
    ENDED = "ended"
    EXPIRED = "expired"
    REVOKED = "revoked"
    FAILED = "failed"


class CaptureScope(StrEnum):
    APOLLO_APP = "apollo_app"
    SELECTED_APP = "selected_app"
    FULL_DISPLAY = "full_display"


class FamilyAssistEndReason(StrEnum):
    OWNER_STOPPED = "owner_stopped"
    HELPER_LEFT = "helper_left"
    OWNER_LOCKED_DEVICE = "owner_locked_device"
    CAPTURE_REVOKED = "capture_revoked"
    RELATIONSHIP_REVOKED = "relationship_revoked"
    OWNER_SIGNED_OUT = "owner_signed_out"
    HELPER_SIGNED_OUT = "helper_signed_out"
    TIMEOUT = "timeout"
    TRANSPORT_FAILED = "transport_failed"
    OS_TERMINATED = "os_terminated"
    APP_TERMINATED = "app_terminated"
    SUPERSEDED = "superseded"
    POLICY_REJECTED = "policy_rejected"


TERMINAL_STATES = frozenset({FamilyAssistState.ENDED, FamilyAssistState.EXPIRED, FamilyAssistState.REVOKED, FamilyAssistState.FAILED})
LIVE_STATES = frozenset(set(FamilyAssistState) - TERMINAL_STATES)


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=lambda name: "".join(
        word if index == 0 else word.title() for index, word in enumerate(name.split("_"))
    ))


class CreateFamilyAssistSession(CamelModel):
    relationship_id: str = Field(min_length=24, max_length=24, pattern=r"^[0-9a-fA-F]{24}$")
    sharer_device_id: str = Field(min_length=8, max_length=64)
    capture_scope: CaptureScope
    microphone_requested: bool = False
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$")

    @field_validator("microphone_requested")
    @classmethod
    def view_only_release(cls, value: bool) -> bool:
        if value:
            raise ValueError("Live microphone is not supported in this release")
        return False


class RespondFamilyAssistSession(CamelModel):
    decision: Literal["accept", "decline"]
    helper_device_id: str = Field(min_length=8, max_length=64)
    expected_revision: int = Field(ge=1)


class RevisionCommand(CamelModel):
    expected_revision: int = Field(ge=1)


class NativeStateCommand(RevisionCommand):
    generation: str = Field(min_length=16, max_length=128)
    native_state: Literal["connecting", "active", "failed"]
    failure_code: Optional[str] = Field(default=None, max_length=64, pattern=r"^[a-z0-9_]+$")


class SessionView(CamelModel):
    session_id: str
    relationship_id: str
    capture_scope: CaptureScope
    microphone_requested: bool
    state: FamilyAssistState
    revision: int
    generation: str
    created_at: datetime
    invitation_expires_at: datetime
    active_expires_at: Optional[datetime] = None
    activated_at: Optional[datetime] = None
    paused_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    end_reason: Optional[FamilyAssistEndReason] = None
    last_heartbeat_at: Optional[datetime] = None
    helper_display_name: str
    owner_display_name: str
    platform_capability_snapshot: dict[str, Any]
    supported_actions: list[str]


class FamilyAssistCapabilities(CamelModel):
    enabled: bool
    protocol_version: int
    unavailable_reason: Optional[Literal["configuration_missing", "policy_rejected"]] = None
    detail: Optional[str] = None
    supported_scopes: list[CaptureScope] = Field(default_factory=list)
    microphone: Literal["not_supported"] = "not_supported"
    system_audio: Literal["not_supported"] = "not_supported"
    remote_control: Literal["not_supported"] = "not_supported"
    recording: Literal["not_supported"] = "not_supported"