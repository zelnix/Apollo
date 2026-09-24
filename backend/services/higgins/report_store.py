"""Shared encrypted report format and owner-scoped store for ordinary and disposable reports."""
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
    """One normalised report contract for both saved investigations and synthetic diagnostics."""
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
                            if health_check else "This saved snapshot remains until you delete it. It does not update with live protection status."),
    }
    return SavedReport.model_validate(record).model_dump(mode="json")


def _collection(health_check: bool, database=None):
    selected = database if database is not None else db
    return selected.health_report_artifacts if health_check else selected.investigation_reports


async def ensure_indexes() -> None:
    await db.health_report_artifacts.create_index([("owner_id", 1), ("report_id", 1)], unique=True)
    await db.health_report_artifacts.create_index([("owner_id", 1), ("check_id", 1)])
    await db.health_report_artifacts.create_index("expires_at", expireAfterSeconds=0)


async def write(owner: str, report: dict, *, health_check: bool = False, expires_at: datetime | None = None, database=None) -> None:
    if health_check and expires_at is None:
        raise ValueError("disposable_report_requires_expiry")
    valid = SavedReport.model_validate(report).model_dump(mode="json")
    document = {"owner_id": owner, "report_id": valid["reportId"],
                "report_ciphertext": repo.enc_json(valid), "saved_at": now_utc()}
    if health_check:
        document["expires_at"] = expires_at
        document["health_check"] = True
        document["check_id"] = valid["caseId"].removeprefix("health-")
    await _collection(health_check, database).insert_one(document)


async def read(owner: str, report_id: str, *, health_check: bool = False, database=None) -> dict | None:
    query = {"owner_id": owner, "report_id": report_id}
    if health_check:
        query["expires_at"] = {"$gt": now_utc()}
    row = await _collection(health_check, database).find_one(query, {"_id": 0, "report_ciphertext": 1})
    if not row:
        return None
    return SavedReport.model_validate(repo.dec_json(row["report_ciphertext"])).model_dump(mode="json")


async def delete(owner: str, report_id: str, *, health_check: bool = False, database=None) -> bool:
    result = await _collection(health_check, database).delete_one({"owner_id": owner, "report_id": report_id})
    return bool(result.deleted_count)