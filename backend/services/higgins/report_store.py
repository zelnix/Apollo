"""Health-check report artifacts and PDF export report builder.

Server-side permanent saved investigation reports have been removed (Stage 11).
The device owns the durable consumer record.  This module retains:
  - build_report()  — shared normalised report format used by PDF export and health checks.
  - Health-check artifact CRUD (disposable, TTL-bounded).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from core.db import db, now_utc
from core.redaction import redact_investigation_secrets
from services.higgins import repository as repo


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReportAction(_Strict):
    id: str
    label: str
    instruction: str
    kind: str


class ReportSource(_Strict):
    url: str
    title: str
    authority: str


class SavedReport(_Strict):
    reportId: str
    caseId: str
    gates: list[str]
    savedAt: str
    overview: str
    explanationMarkdown: str
    assessment: str
    attention: str
    scope: str
    responseRevision: int = Field(ge=1)
    findings: list[str]
    uncertainties: list[str]
    actions: list[ReportAction]
    sources: list[ReportSource]
    historical: bool
    retentionNotice: str


def build_report(response: dict, *, case_id: str, gates: list[str], revision: int,
                 sources: list[dict], report_id: str | None = None, health_check: bool = False) -> dict:
    """One normalised report contract for PDF export and synthetic health-check diagnostics."""
    cited = set(response["sourceIds"])
    clean = redact_investigation_secrets
    record = {
        "reportId": report_id or str(uuid.uuid4()), "caseId": case_id, "gates": gates,
        "savedAt": now_utc().isoformat(), "overview": clean(response["overview"]),
        "explanationMarkdown": clean(response["explanationMarkdown"]),
        "assessment": response["assessment"], "attention": response["attention"],
        "scope": clean(response["scope"]), "responseRevision": revision,
        "findings": [clean(f["text"]) for f in response["findings"]],
        "uncertainties": [clean(item) for item in response["uncertainties"]],
        "actions": [{"id": action["id"], "label": clean(action["label"]),
                     "instruction": clean(action["instruction"]), "kind": action["kind"]}
                    for action in response["actions"]],
        "sources": [{"url": s["url"], "title": s["title"], "authority": s["authority"]}
                    for s in sources if s["id"] in cited],
        "historical": not health_check,
        "retentionNotice": ("Synthetic system check; the server deletes its temporary report immediately."
                            if health_check else
                            "This investigation is stored on your device only. "
                            "ApolloSG's server does not retain completed investigations."),
    }
    return SavedReport.model_validate(record).model_dump(mode="json")


async def ensure_indexes() -> None:
    await db.health_report_artifacts.create_index([("owner_id", 1), ("report_id", 1)], unique=True)
    await db.health_report_artifacts.create_index([("owner_id", 1), ("check_id", 1)])
    await db.health_report_artifacts.create_index("expires_at", expireAfterSeconds=0)


async def write(owner: str, report: dict, *, health_check: bool = False, expires_at: datetime | None = None, database=None) -> None:
    """Write a disposable health-check report artifact.  Non-health-check writes are no longer supported."""
    if not health_check:
        raise ValueError("server_side_saved_reports_removed: the device owns completed investigation records")
    if expires_at is None:
        raise ValueError("disposable_report_requires_expiry")
    valid = SavedReport.model_validate(report).model_dump(mode="json")
    encrypted = repo.enc_json(valid)
    byte_size = len(encrypted.encode("utf-8"))
    document = {"owner_id": owner, "report_id": valid["reportId"],
                "report_ciphertext": encrypted, "saved_at": now_utc(), "byte_size": byte_size,
                "expires_at": expires_at, "health_check": True,
                "check_id": valid["caseId"].removeprefix("health-")}
    selected = (database if database is not None else db).health_report_artifacts
    await selected.insert_one(document)


async def read(owner: str, report_id: str, *, health_check: bool = False, database=None) -> dict | None:
    """Read a report artifact.  Only health-check artifacts are stored server-side."""
    selected = (database if database is not None else db).health_report_artifacts
    query = {"owner_id": owner, "report_id": report_id, "expires_at": {"$gt": now_utc()}}
    row = await selected.find_one(query, {"_id": 0, "report_ciphertext": 1})
    if not row:
        return None
    return SavedReport.model_validate(repo.dec_json(row["report_ciphertext"])).model_dump(mode="json")


async def delete(owner: str, report_id: str, *, health_check: bool = False, database=None) -> bool:
    """Delete a report artifact.  Only health-check artifacts exist server-side."""
    selected = (database if database is not None else db).health_report_artifacts
    result = await selected.delete_one({"owner_id": owner, "report_id": report_id})
    return bool(result.deleted_count)
