# Admin → Screens (services/screen_gallery.py, services/screen_capture.py): what gets captured, the copies the preview
# sends to the live panel, the live queue, and the admin pages. A real capture is never started here.
import base64
import io
import os
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from PIL import Image
from pymongo import MongoClient

from services import screen_capture as sc

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
API = os.environ.get("APOLLO_API", "http://localhost:8001/api")
KEY = os.environ.get("APOLLO_ADMIN_KEY", "")
RAW = {"User-Agent": "apollo-tests", "X-Apollo-Raw": "1"}
ADMIN = {**RAW, "X-Admin-Key": KEY}
DB = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _png() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 16), (20, 40, 80)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _cookie() -> dict:
    token = uuid.uuid4().hex
    DB.admin_sessions.insert_one({"token": token, "email": "tests@apollo.example", "name": "Tests",
                                  "expires_at": datetime.now(timezone.utc) + timedelta(hours=1)})
    return {"apollo_admin": token}


def test_every_route_file_is_a_screen_with_its_url_title_and_group():
    app = Path(sc.APP_DIR)
    files = [f for f in app.rglob("*.tsx") if not f.name.startswith(("_", "+"))]
    found = sc.screens()
    assert len(found) == len(files) and len({s["screen"] for s in found}) == len(found)
    by_file = {s["file"]: s for s in found}
    assert by_file["(tabs)/home"]["route"] == "/home" and by_file["(tabs)/home"]["group"] == "Tabs"
    assert by_file["settings/index"]["route"] == "/settings"
    assert by_file["index"]["route"] == "/" and by_file["index"]["group"] == "Setup"
    assert sc.route_for(by_file["patrol/[id]"], {}) == f"/patrol/{sc.SAMPLE_CASE}"
    assert sc.route_for(by_file["higgins/scam/[id]"], {"scam": "https://a.gov/x?y=1"}) == "/higgins/scam/https%3A%2F%2Fa.gov%2Fx%3Fy%3D1"


def test_the_preview_copy_reaches_the_gallery_and_downloads_in_a_zip():
    key = f"test-{uuid.uuid4().hex[:8]}@phone"
    item = {"key": key, "kind": "screen", "screen": key.split("@")[0], "title": "Test screen", "group": "Screens",
            "size": "phone", "route": "/test", "note": "", "captured_at": datetime.now(timezone.utc).isoformat(), "storage_path": "nope"}
    assert requests.post(f"{API}/admin/screens/ingest", headers=RAW, json={"item": item, "content_type": "image/png", "data": _png()}, timeout=60).status_code == 401
    r = requests.post(f"{API}/admin/screens/ingest", headers=ADMIN, json={"item": item, "content_type": "image/png", "data": _png()}, timeout=60)
    assert r.status_code == 200, r.text
    row = DB.admin_screens.find_one({"key": key})
    assert row["storage_path"] != "nope" and row["thumb_path"]  # only known fields are kept
    try:
        cookie = _cookie()
        page = requests.get(f"{API}/admin/screens", cookies=cookie, headers=RAW, timeout=30)
        assert page.status_code == 200 and "Test screen" in page.text and "Logos, icons and splash images" in page.text
        img = requests.get(f"{API}/admin/screens/image/{key}", cookies=cookie, headers=RAW, timeout=30)
        assert img.status_code == 200 and img.headers["content-type"] == "image/png"
        assert requests.get(f"{API}/admin/screens/thumb/{key}", cookies=cookie, headers=RAW, timeout=30).headers["content-type"] == "image/jpeg"
        z = requests.post(f"{API}/admin/screens/action", cookies=cookie, headers=RAW, data={"action": "download", "key": [key, "not a key"]}, timeout=60)
        assert z.status_code == 200 and z.headers["content-type"] == "application/zip"
        assert zipfile.ZipFile(io.BytesIO(z.content)).namelist() == [f"screens/phone/screens/{key.split('@')[0]}.png"]
        none = requests.post(f"{API}/admin/screens/action", cookies=cookie, headers=RAW, data={"action": "download"}, allow_redirects=False, timeout=30)
        assert none.status_code == 303 and none.headers["location"].endswith("msg=none")
    finally:
        DB.admin_screens.delete_one({"key": key})


def test_bad_copies_are_refused():
    for body in ({"item": {"key": "../etc"}, "content_type": "image/png", "data": _png()},
                 {"item": {"key": "home@phone"}, "content_type": "text/html", "data": _png()}):
        assert requests.post(f"{API}/admin/screens/ingest", headers=ADMIN, json=body, timeout=30).status_code == 422


def test_a_request_queued_on_the_live_panel_is_claimed_once():
    DB.admin_screen_runs.update_many({"status": "queued"}, {"$set": {"status": "test-parked"}})
    run_id = f"test-{uuid.uuid4().hex[:8]}"
    DB.admin_screen_runs.insert_one({"run_id": run_id, "status": "queued", "keys": ["tabs-home@phone"],
                                     "requested_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)})
    try:
        first = requests.post(f"{API}/admin/screens/queue/claim", headers=ADMIN, timeout=30).json()
        assert first["run"] == {"run_id": run_id, "keys": ["tabs-home@phone"]}
        assert requests.post(f"{API}/admin/screens/queue/claim", headers=ADMIN, timeout=30).json()["run"] is None
        progress = {"status": "done", "done": 1, "total": 1, "errors": [], "sneaky": "x"}
        assert requests.post(f"{API}/admin/screens/runs/{run_id}", headers=ADMIN, json=progress, timeout=30).status_code == 200
        row = DB.admin_screen_runs.find_one({"run_id": run_id})
        assert row["status"] == "done" and "sneaky" not in row
    finally:
        DB.admin_screen_runs.delete_one({"run_id": run_id})
        DB.admin_screen_runs.update_many({"status": "test-parked"}, {"$set": {"status": "queued"}})


def test_the_pages_need_an_admin_sign_in():
    for path in ("/admin/screens", "/admin/screens/image/tabs-home@phone", "/admin/screens/thumb/tabs-home@phone"):
        assert requests.get(f"{API}{path}", headers=RAW, allow_redirects=False, timeout=30).status_code == 303
    assert requests.post(f"{API}/admin/screens/action", headers=RAW, data={"action": "regenerate_all"}, allow_redirects=False, timeout=30).status_code == 303
