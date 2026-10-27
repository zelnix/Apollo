"""Email evidence findings — Higgins Triage's minimal structured summary of the email evidence it examined on the phone.

The phone classifies the evidence (L1 screenshot/text … L4 provider-verified) and reads the original email's headers
itself; the original .eml never leaves it. What may travel with an investigation is only this summary: the level,
each capability's status, the authentication results AS THE RECEIVING MAIL SERVER RECORDED THEM, domains, counts and
fingerprints. No subject, body, display names, addresses or header text. ApolloSG never re-checks SPF, DKIM or DMARC.
Mirrors frontend src/domain/triage/emailEvidence.ts `emailFindings` and the egress allow-list in src/domain/privacy.ts.
"""
from __future__ import annotations

import json
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from services.higgins import evidence as ev
from services.higgins import repository as repo
from services.higgins.contracts import Coverage

DOMAIN = r"^[a-z0-9.-]{1,253}$"
RESULT = Field(default=None, max_length=20, pattern=r"^[a-z]{1,20}$")
LEVEL_WORDS = {"L1": "L1 — Visual/Text", "L2": "L2 — Shared Email", "L3": "L3 — Original Message", "L4": "L4 — Provider-Verified Source"}
CAPABILITY_STATUS = Literal["verified", "recorded", "observed", "unavailable"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RecordedAuth(_Strict):
    recorded_by: str = Field(max_length=253, pattern=r"^[a-z0-9.:_-]{1,253}$")
    receiver_confirmed: bool
    spf: Optional[str] = RESULT
    dkim: Optional[str] = RESULT
    dmarc: Optional[str] = RESULT
    arc: Optional[str] = RESULT


class AttachmentFact(_Strict):
    type: str = Field(max_length=100)
    size: int = Field(ge=0)
    sha256: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    ext: Optional[str] = Field(default=None, pattern=r"^[a-z0-9]{1,10}$")


class EmailEvidenceFindings(_Strict):
    type: Literal["email"]
    level: Literal["L1", "L2", "L3", "L4"]
    via: Literal["pasted", "screenshot", "shared", "eml_file", "raw_source", "connected_mailbox", "simulated"]
    capabilities: dict[str, CAPABILITY_STATUS] = Field(default_factory=dict, max_length=30)
    auth: Optional[RecordedAuth] = None
    from_domain: Optional[str] = Field(default=None, pattern=DOMAIN)
    reply_to_domains: list[str] = Field(default_factory=list, max_length=5)
    return_path_domain: Optional[str] = Field(default=None, pattern=DOMAIN)
    message_id_domain: Optional[str] = Field(default=None, pattern=DOMAIN)
    dkim_domains: list[str] = Field(default_factory=list, max_length=5)
    received_hops: int = Field(default=0, ge=0, le=500)
    header_count: int = Field(default=0, ge=0, le=5000)
    attachments: list[AttachmentFact] = Field(default_factory=list, max_length=20)
    signals: list[str] = Field(default_factory=list, max_length=20)
    original_sha256: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    original_bytes: Optional[int] = Field(default=None, ge=0)
    observed_at: Optional[str] = Field(default=None, max_length=40)


def summary(findings: EmailEvidenceFindings) -> str:
    """One plain statement of what the evidence was and what the receiving server recorded — never a verdict."""
    level = LEVEL_WORDS[findings.level]
    parts = [f"Email evidence classified by Higgins Triage on the phone: {level} (received as {findings.via.replace('_', ' ')})."]
    if findings.level in ("L1", "L2"):
        parts.append("ApolloSG did not receive the original email's full headers, so sender authentication could not be examined.")
    elif findings.auth:
        a = findings.auth
        results = ", ".join(f"{m.upper()} {getattr(a, m) or 'not recorded'}" for m in ("spf", "dkim", "dmarc"))
        who = a.recorded_by if a.recorded_by != "unknown" else "a mail server that didn't name itself"
        parts.append(f"Sender authentication as recorded by {who}"
                     f"{', the server that received it' if a.receiver_confirmed else ' (not matched to the delivering servers)'}: {results}. "
                     "ApolloSG reports these as recorded and did not re-check them; passing results confirm only the sending domain.")
    else:
        parts.append("The original's headers carried no SPF, DKIM or DMARC results recorded by the receiving server.")
    if findings.signals:
        parts.append(f"Header signals (each only a signal, not proof): {', '.join(findings.signals)}.")
    return " ".join(parts)


async def attach(owner: str, case: dict, findings: EmailEvidenceFindings) -> tuple[object, bool]:
    """Add the findings to a case as Apollo-inferred evidence, once per level and original. Returns (item, replayed)."""
    client_item_id = f"email-evidence-{findings.level}-{(findings.original_sha256 or 'copy')[:16]}"
    existing = await repo.list_evidence(owner, case["case_id"])
    if any(row.get("client_item_id") == client_item_id for row in existing):
        return None, True
    text = summary(findings) + "\n\n" + json.dumps(findings.model_dump(exclude_none=True), ensure_ascii=False, sort_keys=True)
    item = await ev.ingest_text(owner, case, client_item_id, text, origin="apollo_inference",
                                label=f"Email evidence ({LEVEL_WORDS[findings.level]})",
                                coverage=Coverage(status="examined", unit="items", total=1, examined=1))
    return item, False
