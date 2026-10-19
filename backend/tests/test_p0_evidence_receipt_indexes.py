"""P0 Mongo index regression: evidence receipt bindings must stay unique per device."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient


load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def test_evidence_receipt_unique_indexes_exist_in_mongo():
    """Module: patrol persistence; Feature: event/evidence uniqueness constraints."""
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    info = db.evidence_receipts.index_information()
    by_keys = {tuple(v.get("key", [])): v for v in info.values()}

    idx_device_evidence = by_keys.get((("device_id", 1), ("evidence_id", 1)))
    idx_device_event = by_keys.get((("device_id", 1), ("event_id", 1)))

    assert idx_device_evidence is not None
    assert idx_device_evidence.get("unique") is True
    assert idx_device_event is not None
    assert idx_device_event.get("unique") is True
