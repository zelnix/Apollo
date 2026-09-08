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


# --------------------------------------------------------------------------- Enforcement evidence
# Cross-Platform Architecture Directive — mirrors frontend/src/security/PlatformCapabilityProfile.ts
# EnforcementEvidence field-for-field (flattened; destination/attribution are nested there, flat here
# to match this module's existing flat convention). This is the ONLY thing the server may consult
# to decide verified_block — see _derive_verified_block in routers/patrol.py. The client's own
# verified_block boolean is NEVER trusted directly.
EnforcementMechanism = Literal["dns_filter", "content_blocker", "network_extension", "vpn_service", "packet_filter", "none", "simulated"]
EnforcementResult = Literal["verified", "unverified", "failed"]


class EnforcementEvidenceIn(BaseModel):
    evidence_id: str = Field(min_length=1, max_length=64)
    event_id: Optional[str] = Field(default=None, max_length=64)
    device_id: Optional[str] = Field(default=None, max_length=64)
    platform: Literal["android", "ios", "windows", "macos", "mock"]
    os_version: Optional[str] = Field(default=None, max_length=64)
    sdk_version: Optional[str] = Field(default=None, max_length=32)
    observed_at: datetime
    mechanism: EnforcementMechanism
    direction: Literal["outbound", "inbound", "unknown"]
    protocol: Literal["tcp", "udp", "dns", "http", "https", "unknown"]
    destination_ip: Optional[str] = Field(default=None, max_length=64)
    destination_domain: Optional[str] = Field(default=None, max_length=253)
    destination_port: Optional[int] = Field(default=None, ge=0, le=65535)
    app_id: Optional[str] = Field(default=None, max_length=128)
    process_name: Optional[str] = Field(default=None, max_length=128)
    attribution_confidence: Literal["high", "medium", "low", "unavailable"] = "unavailable"
    matched_rule_id: Optional[str] = Field(default=None, max_length=253)
    threat_id: Optional[str] = Field(default=None, max_length=64)
    requested_action: Literal["block", "allow", "monitor"]
    enforced_action: Literal["blocked", "allowed", "monitored", "none"]
    result: EnforcementResult
    rule_source: Literal["local_blocklist", "cloud_intel", "heuristic", "user_override", "unknown"]
    confidence: Literal["high", "medium", "low"]
    correlation_id: Optional[str] = Field(default=None, max_length=64)


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
    # Cross-Platform Architecture Directive: the raw evidence the client's adapter observed, if any.
    # Presence alone proves nothing — see _derive_verified_block in routers/patrol.py, the only place
    # allowed to turn this into verified_block=True.
    enforcement_evidence: Optional[EnforcementEvidenceIn] = None


class PatrolEvent(PatrolEventIn, BaseDocument):
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None


class PatrolEventPatch(BaseModel):
    status: Optional[EventStatus] = None
    state: Optional[ApolloState] = None
    # verified_block is deliberately NOT patchable here: the only legitimate way to set it is via
    # POST /patrol/events with enforcement_evidence attached, re-derived server-side every time
    # (see _derive_verified_block in routers/patrol.py). A bare PATCH must never flip it.
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
