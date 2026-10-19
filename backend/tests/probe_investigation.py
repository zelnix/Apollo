"""Direct owner-key probe of the shared investigation engine (no mocks, no testing agent)."""
import json
import os
import sys
import time
import uuid

import httpx

BASE = os.environ.get("APOLLO_API", "http://localhost:8001/api")


def register():
    r = httpx.post(f"{BASE}/devices/register", json={"platform": "web", "adapter_mode": "unsupported", "app_version": "1.0.0"}, timeout=20)
    r.raise_for_status()
    data = r.json()
    return data["device_token"], data["device_id"]


def main():
    token, device_id = register()
    h = {"Authorization": f"Bearer {token}"}
    scenario = sys.argv[1] if len(sys.argv) > 1 else "link"
    if scenario == "link":
        body = {"gate": "link", "question": "I got a text saying my parcel is held and to pay a fee at this link. Is it safe?",
                "submissions": [{"clientItemId": str(uuid.uuid4()), "kind": "url", "value": "https://testsafebrowsing.appspot.com/s/phishing.html"},
                                {"clientItemId": str(uuid.uuid4()), "kind": "text", "value": "AusPost: your parcel could not be delivered. Pay the $3.20 redelivery fee within 24h: https://testsafebrowsing.appspot.com/s/phishing.html"}],
                "initialFindingRefs": [], "initialFindings": ["Apollo observed a payment request with a deadline in a delivery message (pressure pattern)."],
                "deviceProfile": {"platform": "web", "locale": "en-AU", "evidenceOrigin": "browser", "capabilityIds": []}}
    else:
        long = ("Hi, it's Marta from the strata committee. Minutes from last week attached in text below. " * 260) + \
               " IMPORTANT: the levy account changed, please pay this quarter's levy to BSB 062-000 account 1234 5678 instead of the usual account. " + ("Regards, Marta. " * 40)
        body = {"gate": "text", "question": "Is this message from my strata manager genuine? Should I pay?",
                "submissions": [{"clientItemId": str(uuid.uuid4()), "kind": "text", "value": long}], "initialFindingRefs": [], "initialFindings": [],
                "deviceProfile": {"platform": "android", "manufacturer": "Samsung", "model": "SM-S918B", "osVersion": "14", "locale": "en-AU", "evidenceOrigin": "native", "capabilityIds": []}}
    t0 = time.time()
    r = httpx.post(f"{BASE}/investigations", json=body, headers={**h, "Idempotency-Key": str(uuid.uuid4())}, timeout=60)
    print("create", r.status_code, r.text[:300] if r.status_code != 201 else "")
    r.raise_for_status()
    case, job = r.json()["case"], r.json()["job"]
    print("case", case["id"], "job", job["id"], "inventory", case["inventory"])
    after = 0
    with httpx.Client(timeout=200) as client:
        while True:
            with client.stream("GET", f"{BASE}/investigations/{case['id']}/jobs/{job['id']}/events", params={"after": after}, headers=h) as s:
                terminal = False
                for line in s.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    evt = json.loads(line[6:])
                    after = evt["sequence"]
                    payload = evt["payload"]
                    if evt["type"] == "progress":
                        print(f"  [{evt['type']}] {payload['phase']}: {payload['message']}")
                    elif evt["type"] == "response":
                        resp = payload["response"]
                        print("\nOVERVIEW:", resp["overview"])
                        print("\nEXPLANATION:", resp["explanationMarkdown"][:1500])
                        print("\nassessment", resp["assessment"], "attention", resp["attention"], "completion", resp["completion"])
                        print("findings", [(f["basis"], f["text"][:90]) for f in resp["findings"]])
                        print("sources", [(s["title"][:40], s["authority"]) for s in payload["sources"]])
                        print("actions", [(a["kind"], a["label"]) for a in resp["actions"]], "question", resp.get("question"))
                    else:
                        print(f"  [{evt['type']}] {json.dumps(payload)[:300]}")
                    if evt["type"] in ("completed", "failed", "cancelled", "expired"):
                        terminal = True
                if terminal:
                    break
            time.sleep(1)
    print("elapsed", round(time.time() - t0, 1), "s")
    final = httpx.get(f"{BASE}/investigations/{case['id']}", headers=h, timeout=20).json()["case"]
    print("final status", final["status"], "revision", final["revision"], "inventory", final["inventory"])
    ev = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
    for item in ev["items"]:
        print("  evidence", item["kind"], item["label"], item["coverage"]["status"], item["coverage"]["examined"], "/", item["coverage"]["total"])
    print("device_id", device_id)
    if os.environ.get("FOLLOWUP"):
        turn = {"expectedRevision": final["revision"], "turnId": str(uuid.uuid4()), "message": os.environ["FOLLOWUP"], "answerToQuestionId": (final.get("response") or {}).get("question", {}) and final["response"]["question"]["id"], "evidenceIds": []}
        key = str(uuid.uuid4())
        r = httpx.post(f"{BASE}/investigations/{case['id']}/turns", json=turn, headers={**h, "Idempotency-Key": key}, timeout=30)
        print("turn", r.status_code, r.text[:200])
        r2 = httpx.post(f"{BASE}/investigations/{case['id']}/turns", json=turn, headers={**h, "Idempotency-Key": key}, timeout=30)
        print("replay same key", r2.status_code, "same job:", r2.json().get("job", {}).get("id") == r.json()["job"]["id"])
        r3 = httpx.post(f"{BASE}/investigations/{case['id']}/turns", json={**turn, "message": "different"}, headers={**h, "Idempotency-Key": key}, timeout=30)
        print("changed payload same key", r3.status_code)
        job2 = r.json()["job"]
        with httpx.Client(timeout=200) as client:
            with client.stream("GET", f"{BASE}/investigations/{case['id']}/jobs/{job2['id']}/events", params={"after": 0}, headers=h) as s:
                for line in s.iter_lines():
                    if line.startswith("data: "):
                        evt = json.loads(line[6:]); p = evt["payload"]
                        if evt["type"] == "response": print("\nFOLLOW-UP OVERVIEW:", p["response"]["overview"], "\ncompletion", p["response"]["completion"], "question", p["response"].get("question"))
                        elif evt["type"] == "progress": print("  ", p["phase"], p["message"])
                        else: print("  [", evt["type"], "]", json.dumps(p)[:200])
        turns = httpx.get(f"{BASE}/investigations/{case['id']}/turns", headers=h, timeout=20).json()
        print("accepted turns", turns["total"], [t["question"][:40] for t in turns["items"]])
        other_token, _ = register()
        r = httpx.get(f"{BASE}/investigations/{case['id']}", headers={"Authorization": f"Bearer {other_token}"}, timeout=20)
        print("other owner read", r.status_code)
        r = httpx.delete(f"{BASE}/investigations/{case['id']}", headers=h, timeout=20)
        print("delete", r.status_code, "read after delete", httpx.get(f"{BASE}/investigations/{case['id']}", headers=h, timeout=20).status_code)


if __name__ == "__main__":
    main()
