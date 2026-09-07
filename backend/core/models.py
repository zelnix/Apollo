"""Shared pydantic models (device, intel, patrol, trust, ask)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from core.db import BaseDocument

Verdict = Literal["clean", "malicious", "unknown"]
ApolloState = Literal["sniffing", "resting", "ears_up", "growling", "barking", "biting"]
EventStatus = Literal["active", "trusted", "blocked", "resolved"]


class DeviceRegister(BaseModel):
    platform: str = Field(max_length=16)
    adapter_mode: str = Field(max_length=16)
    app_version: str = Field(default="1.0.0", max_length=16)
    tz_offset_minutes: int = Field(default=0, ge=-840, le=840)  # coarse UTC offset; times the Sunday family check-in


class Device(BaseDocument):
    device_id: str
    platform: str
    adapter_mode: str
    app_version: str
    tz_offset_minutes: int = 0
    created_at: datetime
    last_seen_at: datetime


class IntelCheckRequest(BaseModel):
    indicator_type: Literal["url", "domain"]
    value: str = Field(min_length=1, max_length=2048)
    device_id: Optional[str] = Field(default=None, max_length=64)
    # Gate 3: follow shorteners/redirects and judge the FINAL destination (W04/W05). Shortened ≠ malicious.
    expand: bool = False

    @field_validator("value")
    @classmethod
    def validate_value(cls, v: str) -> str:
        return v.strip()


class IntelSource(BaseModel):
    name: str
    status: Literal["match", "clear", "unavailable", "not_configured"]
    detail: str
    threat_types: list[str] = []


class IntelCheckResponse(BaseModel):
    verdict: Verdict
    threat_types: list[str]
    sources: list[IntelSource]
    indicator_digest: str
    checked_at: datetime
    cached: bool
    coverage: Literal["full", "partial", "none"]
    redirect_chain: list[str] = Field(default_factory=list)  # hosts visited, first → final (only when expand=True and redirects occurred)
    final_url: Optional[str] = None


class ReputationCache(BaseDocument):
    indicator_digest: str
    verdict: Verdict
    threat_types: list[str]
    sources: list[dict[str, Any]]
    coverage: str
    checked_at: datetime
    expires_at: datetime


class BlocklistEntry(BaseDocument):
    host: str
    threat_type: str
    reason: str
    added_at: datetime
    deleted_at: Optional[datetime] = None


class PatrolEventIn(BaseModel):
    """Minimal event summary synced from device. Full link stays on-device."""

    event_id: str = Field(min_length=8, max_length=64)
    device_id: str = Field(min_length=8, max_length=64)
    category: Literal["link", "website", "connection", "known_threat", "protection", "system", "message", "call", "app", "device", "account", "email"]
    state: ApolloState
    status: EventStatus
    headline: str = Field(max_length=160)
    what_happened: str = Field(max_length=600)
    why: list[str] = Field(default_factory=list, max_length=12)
    what_to_do: str = Field(max_length=400)
    indicator_host: Optional[str] = Field(default=None, max_length=253)
    indicator_digest: Optional[str] = Field(default=None, max_length=64)
    verified_block: bool = False
    adapter_label: str = Field(max_length=64)
    occurred_at: datetime
    resolved_at: Optional[datetime] = None
    # True when the native Site Guard raised this while the app was closed → owner gets a push.
    background: bool = False
    # Gate 2 (messages): extracted security signals only — never the conversation.
    claimed_brand: Optional[str] = Field(default=None, max_length=60)
    scenario: Optional[str] = Field(default=None, max_length=40)
    scent_id: Optional[str] = Field(default=None, max_length=64)


class PatrolEvent(PatrolEventIn, BaseDocument):
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None


class PatrolEventPatch(BaseModel):
    status: Optional[EventStatus] = None
    state: Optional[ApolloState] = None
    verified_block: Optional[bool] = None
    what_to_do: Optional[str] = Field(default=None, max_length=400)
    resolved_at: Optional[datetime] = None


class TrustIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    indicator_type: Literal["url", "domain"]
    indicator_digest: str = Field(min_length=16, max_length=64)
    indicator_host: str = Field(max_length=253)
    event_id: Optional[str] = None
    trust_id: str = Field(min_length=8, max_length=64)


class TrustEntry(TrustIn, BaseDocument):
    created_at: datetime
    deleted_at: Optional[datetime] = None


class AskRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    message: str = Field(min_length=1, max_length=2000)
    context: Optional[str] = Field(default=None, max_length=1200)


class AskMessage(BaseDocument):
    device_id: str
    role: Literal["user", "apollo"]
    content: str
    created_at: datetime
