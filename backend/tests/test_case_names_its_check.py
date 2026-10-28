"""One check, one Threats record — through the live API: a case opened from a check's result names that check's
own record (patrolEventId), so its result updates that record and no second, server-filed record appears.

Run: cd /app/backend && python -m pytest tests/test_case_names_its_check.py -q
"""
import uuid

import pytest
import requests

from core.db import db
from tests.test_triage_live_api import API, _device


def _open(auth: dict, record_id: str) -> requests.Response:
    payload = {"gate": "link", "question": "Can you walk me through what Apollo found?", "patrolEventId": record_id, "origin": "user",
               "submissions": [{"clientItemId": str(uuid.uuid4()), "kind": "url", "value": "https://commbank-notice.net/info", "label": "checked link"}],
               "initialFindingRefs": [], "initialFindings": []}
    return requests.post(f"{API}/investigations", json=payload, headers={**auth, "Idempotency-Key": uuid.uuid4().hex}, timeout=25)


@pytest.mark.anyio
async def test_a_case_opened_from_a_check_names_the_checks_own_record():
    device_id, auth = _device()
    event_id = str(uuid.uuid4())
    r = _open(auth, event_id)
    assert r.status_code == 201, r.text
    case = await db.investigation_cases.find_one({"owner_id": device_id, "case_id": r.json()["case"]["id"]}, {"_id": 0, "client_submission_id": 1})
    assert case["client_submission_id"] == event_id


def test_a_record_name_that_isnt_one_is_refused():
    _device_id, auth = _device()
    assert _open(auth, "not a record id; drop table").status_code == 422
