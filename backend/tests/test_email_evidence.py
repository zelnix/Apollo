"""Email evidence findings: the server accepts only Higgins Triage's minimal structured summary of the email evidence
(never the original email), carries it into the investigation, and a case can receive better evidence later."""
import pytest
from pydantic import ValidationError

from services import email_evidence
from services.email_evidence import EmailEvidenceFindings

L3 = {
    "type": "email", "level": "L3", "via": "eml_file",
    "capabilities": {"original_message": "observed", "spf": "recorded", "dkim": "recorded", "dmarc": "recorded", "provider_provenance": "unavailable"},
    "auth": {"recorded_by": "mx.google.com", "receiver_confirmed": True, "spf": "fail", "dkim": "none", "dmarc": "fail", "arc": None},
    "from_domain": "commbank.com.au", "reply_to_domains": ["commbank-help.co"], "return_path_domain": "mailer-x.ru",
    "message_id_domain": "mailer-x.ru", "dkim_domains": [], "received_hops": 2, "header_count": 14,
    "attachments": [{"type": "application/pdf", "size": 14, "sha256": "a" * 64, "ext": "pdf"}],
    "signals": ["reply_to_differs", "spf_failed", "dmarc_failed"],
    "original_sha256": "b" * 64, "original_bytes": 1200, "observed_at": "2026-06-14T11:00:00.000Z",
}


def test_findings_model_mirrors_the_phone_and_rejects_anything_else():
    EmailEvidenceFindings.model_validate(L3)
    for extra in ({"subject": "URGENT"}, {"body": "Dear customer"}, {"headers": "Received: …"}, {"from_address": "a@b.com"}):
        with pytest.raises(ValidationError):
            EmailEvidenceFindings.model_validate({**L3, **extra})
    with pytest.raises(ValidationError):
        EmailEvidenceFindings.model_validate({**L3, "from_domain": "CommBank Security <security@commbank.com.au>"})
    with pytest.raises(ValidationError):
        EmailEvidenceFindings.model_validate({**L3, "auth": {**L3["auth"], "note": "anything"}})


def test_phone_and_server_agree_on_the_finding_keys():
    import re
    from pathlib import Path
    privacy = (Path(__file__).resolve().parents[2] / "frontend/src/domain/privacy.ts").read_text(encoding="utf-8")
    keys = set(re.findall(r'"([a-z_0-9]+)"', re.search(r"EMAIL_FINDING_KEYS = new Set\(\[(.*?)\]\)", privacy, re.S).group(1)))
    assert keys == set(EmailEvidenceFindings.model_fields)


def test_summary_credits_the_receiving_server_and_never_claims_a_recheck():
    text = email_evidence.summary(EmailEvidenceFindings.model_validate(L3))
    assert "L3 — Original Message" in text
    assert "recorded by mx.google.com, the server that received it: SPF fail, DKIM none, DMARC fail" in text
    assert "did not re-check them" in text
    assert "not proof" in text
    l1 = email_evidence.summary(EmailEvidenceFindings.model_validate({"type": "email", "level": "L1", "via": "screenshot"}))
    assert "could not be examined" in l1 and "SPF" not in l1


def test_message_analyse_accepts_the_findings_and_adds_them_to_the_investigation():
    from routers.analysis import MessageAnalyseIn
    body = MessageAnalyseIn.model_validate({"device_id": "device-123456", "text": "Subject\nbody", "local_state": "growling", "gate": "email", "email_evidence": L3})
    assert body.email_evidence and body.email_evidence.level == "L3"
    with pytest.raises(ValidationError):
        MessageAnalyseIn.model_validate({"device_id": "device-123456", "text": "x", "local_state": "growling", "gate": "email",
                                         "email_evidence": {**L3, "raw_eml": "Received: …"}})


def test_evidence_profile_route_is_registered():
    from routers.investigations import router
    assert any(getattr(r, "path", "") == "/investigations/{case_id}/evidence-profile" and "POST" in getattr(r, "methods", set()) for r in router.routes)
