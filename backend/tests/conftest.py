# Test-only auth shim (Hardening Gate step 2).
# The API now requires a server-issued bearer token and rejects caller-supplied device_ids that don't match it.
# The older suites were written against the pre-auth API and use arbitrary device_id strings. Rather than rewrite
# ~20 files at once, this conftest transparently: (1) registers a real device the first time a legacy id is seen,
# (2) rewrites that id to the real one in path/query/body, (3) attaches the right bearer token, and (4) maps real
# ids back to the legacy ones in response bodies so the tests' equality checks still hold.
# Authentication itself is tested WITHOUT this shim in test_device_auth.py (it uses requests.post directly with
# explicit headers and its own ids, which are never rewritten because they are real server ids).
import fcntl, json, os, re, tempfile
import pytest, requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")
# One map per pytest run (all xdist workers of a run share PYTEST_XDIST_TESTRUNUID).
_SHARED_MAP = os.path.join(tempfile.gettempdir(), f"apollo_shim_ids_{os.environ.get('PYTEST_XDIST_TESTRUNUID') or os.getppid()}.json")
ID_KEYS = ("device_id", "user_id", "protected_device_id", "guardian_device_id")
_real_by_legacy: dict[str, tuple[str, str]] = {}  # legacy id -> (real id, token)
_legacy_by_real: dict[str, str] = {}
_orig_request = requests.Session.request
_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def _real(legacy: str) -> tuple[str, str]:
    if legacy in _real_by_legacy:
        return _real_by_legacy[legacy]
    if _ID_RE.match(legacy) and legacy in _legacy_by_real.values():
        return next(v for k, v in _real_by_legacy.items() if v[0] == legacy)
    # xdist runs classes of one module on different workers (loadscope). Their legacy→real maps must agree, or a
    # pairing made in one class is invisible to the next (DEVICE_A would be two different real devices). The map is
    # therefore shared through a per-run file under an exclusive lock.
    with open(_SHARED_MAP, "a+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        fh.seek(0)
        try:
            shared = json.loads(fh.read() or "{}")
        except ValueError:
            shared = {}
        if legacy not in shared:
            r = _orig_request(requests.Session(), "POST", f"{BASE_URL}/api/devices/register", json={"platform": "web", "adapter_mode": "mock"}, headers={"User-Agent": "apollo-tests"})
            j = r.json()
            shared[legacy] = [j["device_id"], j["device_token"]]
            fh.seek(0); fh.truncate(); fh.write(json.dumps(shared))
        real, tok = shared[legacy]
    _real_by_legacy[legacy] = (real, tok); _legacy_by_real[real] = legacy
    return _real_by_legacy[legacy]


def _shimmed_request(self, method, url, **kw):
    hdrs = {**self.headers, **(kw.get("headers") or {})}
    if "/api/" not in url or url.endswith("/devices/register") or "Authorization" in hdrs or "X-Apollo-Raw" in hdrs:
        return _orig_request(self, method, url, **kw)
    caller = None
    body = kw.get("json")
    if isinstance(body, dict):
        for k in ID_KEYS:
            if isinstance(body.get(k), str):
                real, tok = _real(body[k]); body[k] = real
                if k in ("device_id", "user_id"): caller = tok
    params = kw.get("params")
    if isinstance(params, dict):
        for k in ID_KEYS:
            if isinstance(params.get(k), str):
                real, tok = _real(params[k]); params[k] = real
                if k == "device_id": caller = tok
    m = re.search(r"/api/devices/([^/]+)/settings", url)
    if m:
        real, tok = _real(m.group(1)); url = url.replace(m.group(1), real); caller = tok
    if caller is None and "/api/family/confirm/" not in url:  # authenticated call with no id → any real device will do
        caller = _real("__anonymous_caller__")[1]
    if caller:
        kw["headers"] = {**(kw.get("headers") or {}), "Authorization": f"Bearer {caller}"}
    resp = _orig_request(self, method, url, **kw)
    if resp.content and _legacy_by_real:
        text = resp.content.decode("utf-8", "ignore")
        for real, legacy in _legacy_by_real.items():
            text = text.replace(real, legacy)
        resp._content = text.encode("utf-8")
    return resp


@pytest.fixture(autouse=True, scope="session")
def _install_auth_shim():
    requests.Session.request = _shimmed_request
    yield
    requests.Session.request = _orig_request
