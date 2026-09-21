"""US12-style probe: 50-page PDF, deceptive link only on page 47, uploaded to a File-gate case (real Gemini, no mocks)."""
import json
import os
import time
import uuid

import httpx

BASE = os.environ.get("APOLLO_API", "http://localhost:8001/api")


def make_pdf(pages: int, hot_page: int) -> bytes:
    objects = []
    def add(obj: str) -> int:
        objects.append(obj); return len(objects)
    font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids = []
    kids_placeholder = add("PLACEHOLDER")
    for n in range(1, pages + 1):
        line = f"Strata committee minutes, page {n}. Routine maintenance and gardening notes."
        if n == hot_page:
            line = f"URGENT: levy account changed. Pay this quarter to the new portal: http://testsafebrowsing.appspot.com/s/phishing.html before Friday."
        stream = f"BT /F1 11 Tf 40 750 Td ({line.replace('(', '').replace(')', '')}) Tj ET"
        content = add(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
        page = add(f"<< /Type /Page /Parent {kids_placeholder} 0 R /MediaBox [0 0 595 842] /Contents {content} 0 R /Resources << /Font << /F1 {font} 0 R >> >> >>")
        page_ids.append(page)
    objects[kids_placeholder - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{p} 0 R' for p in page_ids)}] /Count {pages} >>"
    catalog = add(f"<< /Type /Catalog /Pages {kids_placeholder} 0 R >>")
    out = b"%PDF-1.4\n"; offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out)); out += f"{i} 0 obj\n{obj}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def main():
    r = httpx.post(f"{BASE}/devices/register", json={"platform": "web", "adapter_mode": "unsupported", "app_version": "1.0.0"}, timeout=20); r.raise_for_status()
    h = {"Authorization": f"Bearer {r.json()['device_token']}"}
    pdf = make_pdf(50, 47)
    QUESTION = "My strata manager emailed these minutes as a PDF. Anything in here I should worry about?"
    body = {"gate": "file", "question": "", "submissions": [], "initialFindingRefs": [],
            "initialFindings": ["Apollo file check: PDF signature matches the .pdf extension; 50 pages; no embedded executable detected."], "deviceProfile": None}
    r = httpx.post(f"{BASE}/investigations", json=body, headers={**h, "Idempotency-Key": str(uuid.uuid4())}, timeout=60); r.raise_for_status()
    case = r.json()["case"]
    meta = {"expectedRevision": case["revision"], "clientItemId": str(uuid.uuid4()), "parentId": None, "kind": "document", "filename": "minutes.pdf", "mediaType": "application/pdf"}
    r = httpx.post(f"{BASE}/investigations/{case['id']}/evidence", data={"metadata": json.dumps(meta)}, files={"file": ("minutes.pdf", pdf, "application/pdf")}, headers=h, timeout=60)
    print("upload", r.status_code, r.text[:400]); r.raise_for_status()
    revision = r.json()["caseRevision"]
    turn = {"expectedRevision": revision, "turnId": str(uuid.uuid4()), "message": QUESTION, "answerToQuestionId": None, "evidenceIds": [r.json()["evidence"]["id"]]}
    r = httpx.post(f"{BASE}/investigations/{case['id']}/turns", json=turn, headers={**h, "Idempotency-Key": str(uuid.uuid4())}, timeout=30); print("turn", r.status_code, r.text[:120] if r.status_code != 202 else "")
    job = r.json()["job"]; t0 = time.time()
    with httpx.Client(timeout=200) as client:
        with client.stream("GET", f"{BASE}/investigations/{case['id']}/jobs/{job['id']}/events", params={"after": 0}, headers=h) as s:
            for line in s.iter_lines():
                if not line.startswith("data: "): continue
                evt = json.loads(line[6:]); p = evt["payload"]
                if evt["type"] == "progress": print("  ", p["phase"], p["message"])
                elif evt["type"] == "response":
                    print("\nOVERVIEW:", p["response"]["overview"]); print("completion", p["response"]["completion"], "attention", p["response"]["attention"])
                    print("findings", [(f["basis"], f["text"][:100]) for f in p["response"]["findings"]]); print("remaining", p["response"]["remainingEvidenceIds"])
                else: print("  [", evt["type"], "]", json.dumps(p)[:200])
    print("elapsed", round(time.time() - t0, 1))
    for item in httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()["items"]:
        print("  evidence", item["kind"], item["label"], item["coverage"]["status"], item["coverage"]["examined"], "/", item["coverage"]["total"], item["coverage"]["unit"])


if __name__ == "__main__":
    main()
