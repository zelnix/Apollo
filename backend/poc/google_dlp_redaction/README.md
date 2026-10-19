# Google DLP image.redact POC (paused — awaiting service account)

Contained evaluation only. Not used by the app; production image flow unchanged.

Run when a service account (role roles/dlp.user) JSON key is available:

    cp <key>.json secrets/sa.json
    GOOGLE_APPLICATION_CREDENTIALS=secrets/sa.json GCP_PROJECT_ID=<project_id> .venv/bin/python run_poc.py
    .venv/bin/python report.py   # writes REPORT.md

- images/ + manifest.json: 47 synthetic images (generate_images.py), every text segment tagged secret/evidence/plain with pixel boxes.
- run_poc.py: two configs (built-in credential infoTypes only; built-ins + custom PIN/OTP/recovery/seed/password regex+hotword). Magenta redaction colour → pixel scoring.
- Isolated venv (.venv) so google-cloud-dlp's protobuf/grpc versions don't affect the backend.
- Existing Apollo keys can't be used: Gemini key rejected (DLP needs OAuth principal); Safe Browsing key restricted and DLP disabled in its project.
