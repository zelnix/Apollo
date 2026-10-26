"""Pairing codes: 6 random digits, 15 minutes, one use, only the newest works, no phone number, wrong guesses limited."""
import uuid
from datetime import timedelta

from test_device_auth import Dev, _db


def _pair(d):
    r = d.post("/family/pair", json={"device_id": d.id, "owner_name": "Mum", "phone": "+61 400 000 000"})
    assert r.status_code == 200, r.text
    return r.json()["code"]


def test_codes_are_six_random_digits():
    d = Dev()
    codes = {_pair(d) for _ in range(5)}
    assert all(c.isdigit() and len(c) == 6 for c in codes) and len(codes) > 1


def test_a_phone_number_is_never_kept_with_the_code():
    d = Dev(); code = _pair(d)
    doc = _db(lambda server: server.db.pair_codes.find_one({"code": code, "protected_device_id": d.id}))
    assert "owner_phone" not in doc


def test_only_the_newest_code_works():
    owner, family = Dev(), Dev()
    old, new = _pair(owner), _pair(owner)
    assert family.post("/family/link", json={"device_id": family.id, "code": old}).status_code == 404
    assert family.post("/family/link", json={"device_id": family.id, "code": new}).status_code == 200


def test_a_code_stops_working_after_15_minutes():
    owner, family = Dev(), Dev()
    code = _pair(owner)
    _db(lambda server: server.db.pair_codes.update_one({"code": code, "protected_device_id": owner.id},
                                                       {"$set": {"expires_at": server.now_utc() - timedelta(seconds=1)}}))
    r = family.post("/family/link", json={"device_id": family.id, "code": code})
    assert r.status_code == 404 and "expired" in r.json()["detail"]


def test_letters_are_not_a_code():
    family = Dev()
    assert family.post("/family/link", json={"device_id": family.id, "code": "AB12CD"}).status_code == 422


def test_wrong_guesses_pause_linking():
    owner, family = Dev(), Dev()
    code = _pair(owner)
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"
    for _ in range(5):
        assert family.post("/family/link", json={"device_id": family.id, "code": wrong}).status_code == 404
    r = family.post("/family/link", json={"device_id": family.id, "code": code})
    assert r.status_code == 429 and "15 minutes" in r.json()["detail"]
    _db(lambda server: server.db.pair_link_misses.delete_many({"device_id": family.id}))
    assert family.post("/family/link", json={"device_id": family.id, "code": code}).status_code == 200


def test_email_invitations_are_gone():
    d = Dev()
    assert d.post("/family/guardians", json={"device_id": d.id, "email": "a@b.co", "name": "Aunt", "owner_name": "Mum"}).status_code in (404, 405)
    assert d.get(f"/family/confirm/{uuid.uuid4().hex}").status_code == 404
