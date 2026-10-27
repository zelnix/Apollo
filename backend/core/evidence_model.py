"""Threat Case evidence model — five facts kept apart, none inferred from another (Apollo's origin rule).

origin          — `device_id`: the device that detected the case. Nothing below moves it.
evidence source — `evidence_provenance`: what supplied the evidence. Never a server: processing is not a source.
processing      — `processing_source`: where Apollo's checks on this record ran ("this_device" / "apollosg_servers").
completeness    — `evidence_completeness`: "partial" when part of the evidence the checks needed is missing.
representation  — `evidence_representation`: the privacy state of what the record holds ("full_record" /
                  "privacy_protected_copy" / "privacy_summary").

Records written before this model stored `evidence_provenance: "server_projected"` (server processing written as if it
were the evidence source) or "incomplete" (completeness written as the source). `evidence_model()` reads them into the
separated model at read time; stored records are never rewritten, and nothing new carries either value.
Mirror: frontend/src/domain/evidenceModel.ts.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

EvidenceSource = Literal["local_device", "dns_observation", "native_protection", "device_submission", "connected_mailbox"]
ProcessingSource = Literal["this_device", "apollosg_servers"]
EvidenceCompleteness = Literal["complete", "partial"]
EvidenceRepresentation = Literal["full_record", "privacy_protected_copy", "privacy_summary"]

EVIDENCE_SOURCES = ("local_device", "dns_observation", "native_protection", "device_submission", "connected_mailbox")
# The sources a device records for itself — the only ones a device sync may carry.
DEVICE_EVIDENCE_SOURCES = ("local_device", "dns_observation", "native_protection")
PROCESSING_SOURCES = ("this_device", "apollosg_servers")
COMPLETENESS = ("complete", "partial")
REPRESENTATIONS = ("full_record", "privacy_protected_copy", "privacy_summary")
LEGACY_PROVENANCE = ("server_projected", "incomplete")
FIELDS = ("evidence_provenance", "processing_source", "evidence_completeness", "evidence_representation")

# Adapter labels: a device's privacy summary (patrol_policy.minimal_patrol), server Triage (triage/store.py) and a
# server investigation (investigation_projector.py).
SUMMARY_ADAPTER = "ApolloSG on-device assessment"
TRIAGE_ADAPTER = "Higgins Triage (deterministic)"
INVESTIGATION_ADAPTER = "Magnum DI investigation"


def server_evidence_source(source_metadata: Optional[dict] = None, *, mailbox: bool = False) -> str:
    """What supplied evidence the server checks: the connected mailbox it was read from, else this device, which sent it."""
    return "connected_mailbox" if mailbox or (source_metadata or {}).get("provider") else "device_submission"


def has_server_findings(doc: dict) -> bool:
    """A server record carries Apollo's findings beyond the privacy summary (Triage record, investigation, metadata)."""
    record = doc.get("patrol_record") or {}
    return bool(doc.get("triage_investigation") or doc.get("investigation_case_id") or record.get("investigationCaseId")
                or doc.get("case_briefing") or doc.get("source_metadata") or doc.get("evidence_profile"))


def _legacy_server_source(doc: dict) -> Optional[str]:
    """The real evidence source of a record that stored server processing in its place. A device's own privacy summary
    never recorded which of its sources supplied it, so that stays not recorded."""
    adapter = doc.get("adapter_label")
    if adapter == SUMMARY_ADAPTER:
        return None
    if adapter == TRIAGE_ADAPTER:  # server Triage reads email only from a connected mailbox
        return server_evidence_source(doc.get("source_metadata"), mailbox=doc.get("category") == "email")
    if adapter == INVESTIGATION_ADAPTER or doc.get("triage_investigation") or doc.get("investigation_case_id"):
        return server_evidence_source(doc.get("source_metadata"))
    return None


def _triage_completeness(doc: dict) -> Optional[str]:
    record = doc.get("triage_investigation")
    if not isinstance(record, dict):
        return None
    return "partial" if record.get("incompleteChecks") or record.get("coverageGaps") else "complete"


def evidence_model(doc: dict[str, Any]) -> dict[str, Optional[str]]:
    """The separated model for one stored Patrol event (or a Patrol record's event snapshot), legacy values read in."""
    stored = doc.get("evidence_provenance") or None
    adapter = doc.get("adapter_label")
    server_made = adapter in (TRIAGE_ADAPTER, INVESTIGATION_ADAPTER)
    legacy_server = stored == "server_projected" or (stored is None and server_made)
    device_recorded = stored is not None and not legacy_server
    if stored in EVIDENCE_SOURCES:
        source = stored
    else:
        source = _legacy_server_source(doc) if legacy_server else None

    processing = doc.get("processing_source")
    if processing not in PROCESSING_SOURCES:
        processing = ("this_device" if adapter == SUMMARY_ADAPTER else "apollosg_servers") if legacy_server \
            else "this_device" if device_recorded or adapter == SUMMARY_ADAPTER else None

    representation = doc.get("evidence_representation")
    if representation not in REPRESENTATIONS:
        if legacy_server:
            representation = "privacy_protected_copy" if server_made or has_server_findings(doc) else "privacy_summary"
        elif adapter == SUMMARY_ADAPTER:
            representation = "privacy_summary"
        else:
            representation = "full_record" if device_recorded else None

    completeness = doc.get("evidence_completeness")
    if completeness not in COMPLETENESS:
        completeness = "partial" if stored == "incomplete" else _triage_completeness(doc)

    return {"evidence_provenance": source, "processing_source": processing,
            "evidence_completeness": completeness, "evidence_representation": representation}


def with_evidence_model(doc: dict[str, Any]) -> dict[str, Any]:
    """The document with its evidence fields in the separated model (legacy values read in, never written back)."""
    return {**doc, **evidence_model(doc)} if isinstance(doc, dict) else doc
