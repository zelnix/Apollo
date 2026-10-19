"""Google Cloud Sensitive Data Protection image.redact POC (contained evaluation; not used by the app).

Usage:
  GOOGLE_APPLICATION_CREDENTIALS=secrets/sa.json GCP_PROJECT_ID=... .venv/bin/python run_poc.py

Runs two configurations over every synthetic image:
  builtin  - Google built-in credential infoTypes only
  combined - built-ins + narrowly scoped custom regex/hotword infoTypes for PIN/OTP/recovery/seed/password
Redaction colour is magenta so redacted pixels can be measured exactly against the manifest boxes.
"""
import json
import os
import time
from pathlib import Path

from google.cloud import dlp_v2
from PIL import Image

HERE = Path(__file__).parent
MAGENTA = {"red": 1.0, "green": 0.0, "blue": 1.0}
SECRET_COVERED = 0.6   # >= 60% of a secret's box painted → redacted
EVIDENCE_HIT = 0.10    # >= 10% of an evidence box painted → evidence removed

# Credential/authentication-secret built-ins only (validated against infoTypes.list at runtime).
WANTED_BUILTINS = [
    "PASSWORD", "AUTH_TOKEN", "JSON_WEB_TOKEN", "ENCRYPTION_KEY", "OAUTH_CLIENT_SECRET",
    "BASIC_AUTH_HEADER", "HTTP_COOKIE", "XSRF_TOKEN", "WEAK_PASSWORD_HASH",
    "GCP_API_KEY", "GCP_CREDENTIALS", "AWS_CREDENTIALS", "AZURE_AUTH_TOKEN",
    "OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "STRIPE_SECRET_KEY",
]

# Custom detectors only where no built-in matches the requirement. group_indexes=[1] redacts
# only the value, never the label, so surrounding evidence is untouched.
CUSTOM = [
    ("APOLLO_PIN", r"(?i)\b(?:pin|passcode)(?:\s+is)?\s*[:=]?\s*(\d{4,8})\b"),
    ("APOLLO_OTP", r"(?i)\b(?:otp|one[- ]time code|verification code|security code|login code|code)(?:\s+is)?\s*[:=]?\s*(\d{4,8}|\d{2}\s\d{2}\s\d{2})\b"),
    ("APOLLO_OTP_LEAD", r"(?i)\b(?:G-|use\s+|otp\s+)(\d{4,8})\b"),
    ("APOLLO_RECOVERY_CODE", r"(?i)\b([a-z0-9]{4,5}-[a-z0-9]{4,5}(?:-[a-z0-9]{4}){0,2})\b"),
    ("APOLLO_PASSWORD_FIELD", r"(?i)\b(?:password|passwd|pwd|db_password)(?:\s+is)?\s*[:=]?\s*(\S{6,})"),
    ("APOLLO_SEED_WORDS", r"\b((?:[a-z]{3,8}\s+){3,}[a-z]{3,8})\b"),
]
CUSTOM_RULES = {
    # Recovery codes only near recovery/backup/2FA wording.
    "APOLLO_RECOVERY_CODE": ["recovery", "backup", "2fa"],
    # Lower-case word runs only near seed/recovery/12-words wording.
    "APOLLO_SEED_WORDS": ["seed", "recovery phrase", "12 words", "24 words", "mnemonic"],
}


def custom_info_types():
    out = []
    for name, pattern in CUSTOM:
        cit = {"info_type": {"name": name}, "regex": {"pattern": pattern, "group_indexes": [1]}}
        hot = CUSTOM_RULES.get(name)
        if hot:
            # Base likelihood UNLIKELY; hotword nearby lifts it to VERY_LIKELY. min_likelihood=LIKELY filters the rest.
            cit["likelihood"] = "UNLIKELY"
            cit["detection_rules"] = [{"hotword_rule": {
                "hotword_regex": {"pattern": "(?i)(" + "|".join(hot) + ")"},
                "proximity": {"window_before": 120, "window_after": 10},
                "likelihood_adjustment": {"fixed_likelihood": "VERY_LIKELY"},
            }}]
        else:
            cit["likelihood"] = "VERY_LIKELY"
        out.append(cit)
    return out


def available_builtins(client, project):
    names = {t.name for t in client.list_info_types(request={"parent": f"projects/{project}/locations/global"}).info_types}
    return [n for n in WANTED_BUILTINS if n in names], [n for n in WANTED_BUILTINS if n not in names]


def redact(client, project, data, builtins, customs):
    info_types = [{"name": n} for n in builtins]
    cfg = {"info_types": info_types, "custom_info_types": customs, "min_likelihood": "LIKELY", "include_quote": True}
    redaction = [{"info_type": t, "redaction_color": MAGENTA} for t in info_types + [c["info_type"] for c in customs]]
    resp = client.redact_image(request={
        "parent": f"projects/{project}/locations/global",
        "byte_item": {"type_": dlp_v2.ByteContentItem.BytesType.IMAGE_PNG, "data": data},
        "inspect_config": cfg,
        "image_redaction_configs": redaction,
        "include_findings": True,
    })
    return resp


def painted_fraction(img, bbox):
    x0, y0, x1, y1 = bbox
    px = img.load(); total = hit = 0
    for x in range(x0, x1):
        for y in range(y0, y1):
            r, g, b = px[x, y][:3]; total += 1
            if r > 230 and g < 40 and b > 230: hit += 1
    return hit / total if total else 0.0


def score(item, out_path):
    img = Image.open(out_path).convert("RGB")
    rows = []
    for seg in item["segments"]:
        f = painted_fraction(img, seg["bbox"])
        if seg["role"] == "secret":
            verdict = "redacted" if f >= SECRET_COVERED else ("partial" if f >= EVIDENCE_HIT else "missed")
        elif seg["role"] == "evidence":
            verdict = "evidence_removed" if f >= EVIDENCE_HIT else "kept"
        else:
            verdict = "label_redacted" if f >= EVIDENCE_HIT else "kept"
        rows.append({"text": seg["text"], "role": seg["role"], "painted": round(f, 2), "verdict": verdict})
    return rows


def main():
    project = os.environ["GCP_PROJECT_ID"]
    client = dlp_v2.DlpServiceClient()
    builtins, unavailable = available_builtins(client, project)
    manifest = json.loads((HERE / "manifest.json").read_text())
    configs = {"builtin": (builtins, []), "combined": (builtins, custom_info_types())}
    results = {"project": project, "builtins_used": builtins, "builtins_unavailable": unavailable,
               "custom_detectors": CUSTOM, "custom_hotwords": CUSTOM_RULES, "runs": {}}
    total_bytes = calls = 0
    for cname, (b, c) in configs.items():
        outdir = HERE / "output" / cname; outdir.mkdir(parents=True, exist_ok=True)
        run = []
        for item in manifest:
            data = (HERE / "images" / item["file"]).read_bytes()
            t0 = time.time()
            resp = redact(client, project, data, b, c)
            ms = int((time.time() - t0) * 1000)
            total_bytes += max(len(data), 1024); calls += 1
            out_path = outdir / item["file"]; out_path.write_bytes(resp.redacted_image)
            findings = [{"info_type": f.info_type.name, "quote": f.quote, "likelihood": f.likelihood.name}
                        for f in resp.inspect_result.findings]
            run.append({"id": item["id"], "category": item["category"], "ms": ms,
                        "ocr_text": resp.extracted_text, "findings": findings, "segments": score(item, out_path)})
            print(f"[{cname}] {item['id']}: {len(findings)} findings, {ms} ms")
        results["runs"][cname] = run
    results["usage"] = {"calls": calls, "billable_bytes": total_bytes,
                        "approx_cost_usd_beyond_free_tier": round(total_bytes / 1024 ** 3 * 3, 6)}
    (HERE / "results.json").write_text(json.dumps(results, indent=2))
    print("results.json written")


if __name__ == "__main__":
    main()
