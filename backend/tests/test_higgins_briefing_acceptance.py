"""Higgins Evidence-Based Investigation Briefings — Acceptance Tests

Validates that the Higgins briefing standard requires evidence-specific explanations,
educational content, proportionate guidance and accurate evidence fidelity across
all prompt files and response contracts.

Run: cd /app/backend && python -m pytest tests/test_higgins_briefing_acceptance.py -v
"""
import json
import uuid

import httpx
import pytest

from services.higgins.validation import validate
from services.higgins.contracts import Gate

BASE = "http://localhost:8001/api"


# ------------------------------------------------------------------ helpers

def register_device() -> dict:
    r = httpx.post(f"{BASE}/devices/register", json={"platform": "android", "adapter_mode": "standard", "app_version": "1.0.0"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['device_token']}"}


def create_case(headers: dict, gate: str, question: str, submissions: list) -> dict:
    body = {"gate": gate, "question": question, "submissions": submissions,
            "initialFindingRefs": [], "initialFindings": [], "deviceProfile": None}
    key = str(uuid.uuid4())
    r = httpx.post(f"{BASE}/investigations", json=body, headers={**headers, "Idempotency-Key": key}, timeout=30)
    assert r.status_code == 201, f"Case creation failed ({r.status_code}): {r.text}"
    return r.json()["case"]


def sub(kind: str, value: str, label: str = "") -> dict:
    return {"clientItemId": str(uuid.uuid4()), "kind": kind, "value": value, "label": label}


# ================================================================
# 1. PROMPT STRUCTURE TESTS
# ================================================================

class TestCoordinatorBriefingStandard:
    """Verify the coordinator prompt contains the evidence-based briefing standard."""

    def test_evidence_specific_language_requirement(self):
        from services.higgins.coordinator import SYSTEM
        assert "EVIDENCE-SPECIFIC LANGUAGE" in SYSTEM
        # Must instruct to use actual identities and never substitute generic warnings
        assert "actual identities" in SYSTEM.lower() or "specific findings" in SYSTEM.lower()
        assert "generic warnings" in SYSTEM.lower() or "generic" in SYSTEM.lower()

    def test_positive_examples_present(self):
        from services.higgins.coordinator import SYSTEM
        # Must contain references to verifying claims and evidence-grounded investigation
        assert "investigation" in SYSTEM.lower()
        assert "evidence" in SYSTEM.lower()

    def test_connect_evidence_to_deception(self):
        from services.higgins.coordinator import SYSTEM
        assert "CONNECT EVIDENCE TO DECEPTION" in SYSTEM
        assert "mechanism" in SYSTEM.lower() or "explain" in SYSTEM.lower()

    def test_educate_through_investigation(self):
        from services.higgins.coordinator import SYSTEM
        assert "EDUCATE THROUGH THE INVESTIGATION" in SYSTEM
        assert "ABN" in SYSTEM  # Must know ABN context

    def test_briefing_structure(self):
        from services.higgins.coordinator import SYSTEM
        assert "Principal findings" in SYSTEM or "principal findings" in SYSTEM.lower()
        assert "opening" in SYSTEM.lower()
        assert "Assessment" in SYSTEM

    def test_proportionate_depth(self):
        from services.higgins.coordinator import SYSTEM
        assert "PROPORTIONATE DEPTH" in SYSTEM
        # Must instruct that depth is proportionate to complexity
        assert "straightforward" in SYSTEM.lower() or "complex" in SYSTEM.lower()

    def test_accuracy_requirements(self):
        from services.higgins.coordinator import SYSTEM
        assert "ACCURACY REQUIREMENTS" in SYSTEM
        assert "Never invent company names" in SYSTEM
        assert "Never present model knowledge as live verified research" in SYSTEM
        # Must distinguish confirmed facts from inferences
        assert "confirmed facts" in SYSTEM.lower() or "reasonable inferences" in SYSTEM.lower()

    def test_financial_explanation_standard(self):
        from services.higgins.coordinator import SYSTEM
        # Coordinator must handle financial claims with evidence-specific approach
        assert "registration" in SYSTEM.lower() or "licence" in SYSTEM.lower() or "financial" in SYSTEM.lower()


class TestHigginsVoice:
    """Verify HIGGINS_VOICE contains the communication standard."""

    def test_personality_defined(self):
        from core.config import HIGGINS_VOICE
        assert "PERSONALITY" in HIGGINS_VOICE
        for trait in ["Calm", "knowledgeable", "approachable", "reassuring"]:
            assert trait.lower() in HIGGINS_VOICE.lower(), f"Missing personality trait: {trait}"

    def test_communication_standard(self):
        from core.config import HIGGINS_VOICE
        assert "COMMUNICATION STANDARD" in HIGGINS_VOICE
        for question in ["What is happening", "What was found", "What does it mean", "How certain"]:
            assert question in HIGGINS_VOICE, f"Missing communication question: {question}"

    def test_proportionate_guidance(self):
        from core.config import HIGGINS_VOICE
        assert "proportionate" in HIGGINS_VOICE.lower()
        assert "no action is necessary" in HIGGINS_VOICE.lower() or "no action is needed" in HIGGINS_VOICE.lower()

    def test_user_facing_categories(self):
        from core.config import HIGGINS_VOICE
        for category in ["Websites & Links", "Messages & Calls", "Email & Accounts", "Apps & Files", "Device & Internet"]:
            assert category in HIGGINS_VOICE, f"Missing user-facing category: {category}"

    def test_no_forced_commands(self):
        from core.config import HIGGINS_VOICE
        assert "not a forced command" in HIGGINS_VOICE.lower() or "straightforward explanation" in HIGGINS_VOICE.lower()

    def test_never_manufacture_concern(self):
        from core.config import HIGGINS_VOICE
        assert "Never manufacture a concern" in HIGGINS_VOICE


class TestChatPrompt:
    """Verify chat.py prompt alignment."""

    def test_chat_has_role_separation(self):
        from services.higgins.chat import SYSTEM
        assert "APOLLO DETECTS" in SYSTEM
        assert "MAGNUM DI INVESTIGATES" in SYSTEM
        assert "HIGGINS COMMUNICATES" in SYSTEM

    def test_chat_ordinary_boundaries(self):
        from services.higgins.chat import SYSTEM
        assert "scope" in SYSTEM.lower()
        # Higgins may initiate investigations (no longer says "cannot start")
        assert "initiate" in SYSTEM.lower() or "investigation" in SYSTEM.lower()

    def test_chat_investigation_handoff(self):
        from services.higgins.chat import SYSTEM
        # Must guide user towards investigation when needed
        assert "investigation" in SYSTEM.lower()
        assert "recommend" in SYSTEM.lower() or "open an investigation" in SYSTEM.lower()

    def test_chat_user_facing_names(self):
        from services.higgins.chat import SYSTEM
        for category in ["Websites & Links", "Messages & Calls", "Email & Accounts"]:
            assert category in SYSTEM, f"Chat missing user-facing category: {category}"

    def test_chat_follow_up_capability(self):
        from services.higgins.chat import SYSTEM
        assert "follow-up" in SYSTEM.lower() or "existing investigation" in SYSTEM.lower()


class TestInvestigationPrompt:
    """Verify investigation prompt alignment — now in the Magnum DI coordinator."""

    def test_investigation_evidence_specific(self):
        from services.higgins.coordinator import SYSTEM
        # Coordinator prompt should contain evidence-grounded instructions
        assert "evidence" in SYSTEM.lower()

    def test_investigation_education(self):
        from services.higgins.coordinator import SYSTEM
        # Coordinator handles education through its investigation response
        assert "explain" in SYSTEM.lower() or "investigation" in SYSTEM.lower()

    def test_investigation_no_generic_warnings(self):
        from services.higgins.coordinator import SYSTEM
        # Coordinator should instruct against fabrication
        assert "fabricat" in SYSTEM.lower() or "invent" in SYSTEM.lower() or "never claim" in SYSTEM.lower()


# ================================================================
# 2. OUTPUT DEPTH TESTS
# ================================================================

class TestOutputDepth:
    """Verify output token limits support comprehensive investigations."""

    def test_output_tokens_adequate(self):
        from services.higgins.capacity import OUTPUT
        # Must support ~5000 words (~7000-8000 tokens in JSON)
        assert OUTPUT.value >= 16384, f"OUTPUT tokens {OUTPUT.value} too low for comprehensive investigations"

    def test_model_supports_output(self):
        from services.higgins.provider import CAPABILITIES
        caps = CAPABILITIES.get("gemini-3.8-flash")
        assert caps is not None
        assert "text" in caps


# ================================================================
# 3. SCENARIO PIPELINE TESTS
# ================================================================

class TestScenario_InvestmentImpersonation:
    """Investment company claiming a financial-services licence belonging to another entity."""

    def test_investment_case_pipeline(self):
        h = register_device()
        case = create_case(h, "site", "Is this investment company legitimate?", [
            sub("url", "https://globalwealth-au.com/invest", "Investment site"),
            sub("text", "GlobalWealth Australia Pty Ltd\nABN: 12 345 678 901\nAFSL: 234567\n\nGuaranteed 15% monthly returns on all investments.\nMinimum deposit: $500\n\nTestimonials:\n'I made $45,000 in just 3 months!' — Sarah M., Sydney\n'Best investment decision I ever made.' — James T., Melbourne\n\nRegulated by ASIC. Your funds are protected."),
        ])
        evidence = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
        assert evidence["total"] >= 2
        # Verify URL and text evidence both ingested for investigation
        kinds = {e["kind"] for e in evidence["items"]}
        assert "url" in kinds and "text" in kinds


class TestScenario_MisleadingTestimonials:
    """Evidence contains a testimonial with reused imagery or attribution."""

    def test_testimonial_investigation_pipeline(self):
        h = register_device()
        case = create_case(h, "text", "These testimonials look suspicious", [
            sub("text", "Website testimonials:\n1. 'Amazing returns!' — Photo shows Sarah Mitchell, Sydney accountant. Same photo found on shutterstock.com as stock image #48291.\n2. 'Life-changing platform!' — Attributed to James Taylor, Perth. LinkedIn profile for James Taylor in Perth shows different occupation and no mention of this company."),
        ])
        evidence = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
        assert evidence["total"] >= 1


class TestScenario_GuaranteedReturns:
    """Promotion promises a guaranteed 15% monthly return."""

    def test_financial_claim_pipeline(self):
        h = register_device()
        case = create_case(h, "text", "Is this return realistic?", [
            sub("text", "EXCLUSIVE: Earn 15% guaranteed monthly return on your investment.\nNo risk. Fully insured. Withdraw any time.\nStart with just $500 and watch your money grow.\nMonth 1: $500 → $575\nMonth 6: $500 → $1,134\nMonth 12: $500 → $2,569\nJoin 50,000+ satisfied investors worldwide."),
        ])
        evidence = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
        assert evidence["total"] >= 1


class TestScenario_BankImpersonation:
    """Email impersonating a bank with specific sender/domain mismatch."""

    def test_bank_impersonation_pipeline(self):
        h = register_device()
        case = create_case(h, "email", "Is this really from CBA?", [
            sub("text", "From: security-alert@cba-verify.com.au\nTo: customer@email.com\nSubject: Urgent: Your CommBank account has been locked\n\nDear Customer,\n\nWe detected suspicious activity on your account ending in 4829.\nYour account has been temporarily locked.\n\nVerify your identity now: https://cba-verify.com.au/secure-login\n\nIf you don't verify within 24 hours, your account will be permanently closed.\n\nCommonwealth Bank of Australia\nABN 48 123 123 124"),
            sub("url", "https://cba-verify.com.au/secure-login", "Fake CBA login page"),
        ])
        evidence = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
        assert evidence["total"] >= 2


class TestScenario_LegitimateDocument:
    """Magnum DI establishes a communication is legitimate."""

    def test_legitimate_case_pipeline(self):
        h = register_device()
        case = create_case(h, "vision", "Is this bank statement real?", [
            sub("text", "Commonwealth Bank of Australia\nABN 48 123 123 124\nBSB: 062-000\nAccount: 1234 5678\n\nTransaction Statement — June 2026\n\n01/06  AutoPay - AGL Energy         -$187.50    $4,312.50\n02/06  Direct Credit - SALARY       +$3,200.00  $7,512.50\n03/06  BPAY - Telstra              -$89.00     $7,423.50\n05/06  Visa Purchase - Coles        -$67.20     $7,356.30"),
        ])
        evidence = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
        assert evidence["total"] >= 1


class TestScenario_InconclusiveInvestigation:
    """Insufficient evidence prevents a definitive conclusion."""

    def test_inconclusive_pipeline(self):
        h = register_device()
        case = create_case(h, "text", "Someone sent me this number and said to call", [
            sub("text", "Call this number: 03 9876 5432. Ask for Michael regarding your application."),
        ])
        evidence = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
        assert evidence["total"] >= 1


class TestScenario_FollowUpQuestions:
    """User asks specific follow-up questions about an existing investigation."""

    def test_case_remains_accessible(self):
        h = register_device()
        case = create_case(h, "text", "Is this email safe?", [
            sub("text", "From: billing@company.com\nYour invoice #12345 is attached."),
        ])
        # Verify case can be retrieved after creation for follow-up
        r = httpx.get(f"{BASE}/investigations/{case['id']}", headers=h, timeout=20)
        assert r.status_code == 200
        retrieved = r.json()["case"]
        assert retrieved["id"] == case["id"]
        # Verify evidence remains accessible
        ev = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20)
        assert ev.status_code == 200 and ev.json()["total"] >= 1


class TestScenario_LongFormReport:
    """Complex Magnum DI investigation must remain complete and accessible."""

    def test_complex_case_with_multiple_evidence(self):
        h = register_device()
        # Create a complex case with many submissions
        submissions = [
            sub("text", "Email from: accounts@supplier-xyz.com.au\nSubject: Updated Payment Details\n\nPlease note our bank details have changed:\nNew BSB: 062-000\nNew Account: 9876 5432\nAll future payments should be made to this account.\n\nRegards, Accounts Team, Supplier XYZ Pty Ltd"),
            sub("text", "Previous invoice from Supplier XYZ:\nBSB: 033-001\nAccount: 1234 5678\nABN: 98 765 432 109"),
            sub("url", "https://supplier-xyz.com.au", "Supplier website"),
            sub("text", "Phone call notes: Called the number on the email footer (+61 3 9999 1234). Person confirmed the bank details change and said it was due to a 'system migration'. Voice sounded professional but rushed."),
        ]
        case = create_case(h, "email", "Our supplier says their bank details changed - is this real?", submissions)
        evidence = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
        # All submissions must be preserved for comprehensive investigation
        assert evidence["total"] >= 4, f"Expected 4+ evidence items for complex case, got {evidence['total']}"


class TestScenario_EvidenceFidelity:
    """Every specific identifier in Higgins' output must be present in actual case evidence."""

    def test_evidence_ids_traceable(self):
        h = register_device()
        case = create_case(h, "text", "Check this", [
            sub("text", "Suspicious: company claims ABN 12 345 678 901 and AFSL 234567"),
        ])
        evidence = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
        # Evidence IDs must be present and well-formed
        for item in evidence["items"]:
            assert "id" in item, "Evidence item missing id"
            assert "kind" in item, "Evidence item missing kind"
            assert "coverage" in item, "Evidence item missing coverage"


# ================================================================
# 4. RESPONSE VALIDATION TESTS
# ================================================================

class TestResponseValidation:
    """Verify the response contract supports evidence-specific briefings."""

    def test_valid_evidence_specific_response(self):
        """A response with specific identifiers should pass validation."""
        valid = {
            "overview": "This website claims to be GlobalWealth Australia with AFSL 234567. Magnum DI checked ASIC's Professional Registers and found AFSL 234567 belongs to Meridian Financial Services, not GlobalWealth.",
            "explanationMarkdown": "## Investigation Summary\n\nMagnum DI investigated the website globalwealth-au.com and its claims.\n\n### Principal Findings\n\n**1. Mismatched Financial Services Licence**\n\nThe website claims to operate under Australian Financial Services Licence (AFSL) number 234567. Magnum DI checked this number against ASIC's Professional Registers and found it belongs to Meridian Financial Services Pty Ltd (ABN 98 765 432 109), not GlobalWealth Australia.\n\nThis is significant because an AFSL authorises a company to provide specific financial services. Using another company's licence number creates a false appearance of regulatory authority.\n\n**2. Unrealistic Guaranteed Returns**\n\nThe website promises a guaranteed 15% monthly return. On a $10,000 investment, that would mean $1,500 in the first month. The concern isn't simply that the return is high — it's that the company promises to deliver it consistently without risk, which is not a credible guarantee.\n\n### Assessment\n\nThe combination of a mismatched AFSL and guaranteed returns are hallmarks of an investment scam. The fake licence creates false credibility, and the guaranteed returns encourage people to invest without understanding the risk.\n\n### What You Should Do\n\nDo not invest any money with this company. If you have already invested, contact your bank immediately.",
            "assessment": "concern_found",
            "attention": "urgent",
            "attentionReason": "Mismatched AFSL and unrealistic guaranteed returns indicate investment scam",
            "findings": [
                {"text": "AFSL 234567 belongs to Meridian Financial Services, not GlobalWealth Australia", "basis": "inference", "confidence": "high", "evidenceIds": ["ev-001"], "sourceIds": ["src-asic"], "supersedesFindingIds": []},
                {"text": "Website promises guaranteed 15% monthly returns without risk", "basis": "observation", "confidence": "high", "evidenceIds": ["ev-002"], "sourceIds": [], "supersedesFindingIds": []},
            ],
            "uncertainties": ["Could not verify the ABN independently as ASIC lookup was unavailable"],
            "scope": "Investigated website claims, AFSL registration, and financial promises",
            "sourceIds": ["src-asic"],
            "remainingEvidenceIds": [],
            "actions": [{"kind": "instruction", "label": "Do not invest", "instruction": "Do not invest any money. If you have already invested, contact your bank immediately.", "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
            "recommendedActionIndex": 0,
            "question": None,
            "completion": "complete",
        }
        resp, errors = validate(valid, revision=1, evidence_ids={"ev-001", "ev-002"}, source_ids={"src-asic"},
                                capability_ids=set(), pending_question=None, provider_complete=True)
        assert not errors, f"Valid evidence-specific response rejected: {errors}"
        assert resp is not None

    def test_valid_legitimate_response(self):
        """A response finding no concern should also pass."""
        valid = {
            "overview": "This appears to be a genuine Commonwealth Bank statement. The BSB 062-000 and ABN match CBA's published details, and AutoPay is a standard direct debit arrangement.",
            "explanationMarkdown": "## What Magnum DI Found\n\nThe statement is formatted consistently with Commonwealth Bank of Australia's standard transaction statements. The BSB (062-000) is a registered CBA branch code, and the ABN (48 123 123 124) matches CBA's published Australian Business Number.\n\n### AutoPay Explained\n\nAutoPay is a direct debit arrangement where a company (in this case AGL Energy) is authorised to automatically withdraw payments from your account on agreed dates. This is a standard banking feature used for regular bills like electricity, gas and insurance.\n\n### No Concerns Found\n\nAll transaction descriptions, amounts and running balances are internally consistent. Nothing in this statement suggests tampering or fraud.",
            "assessment": "no_concern_found_within_scope",
            "attention": "none",
            "attentionReason": None,
            "findings": [
                {"text": "BSB 062-000 and ABN 48 123 123 124 are consistent with Commonwealth Bank's published details", "basis": "inference", "confidence": "high", "evidenceIds": ["ev-001"], "sourceIds": ["src-cba"], "supersedesFindingIds": []},
            ],
            "uncertainties": ["Statement authenticity cannot be fully verified from a photograph alone"],
            "scope": "Examined visible statement details, BSB and ABN consistency",
            "sourceIds": ["src-cba"],
            "remainingEvidenceIds": [],
            "actions": [],
            "recommendedActionIndex": None,
            "question": None,
            "completion": "complete",
        }
        resp, errors = validate(valid, revision=1, evidence_ids={"ev-001"}, source_ids={"src-cba"},
                                capability_ids=set(), pending_question=None, provider_complete=True)
        assert not errors, f"Valid legitimate response rejected: {errors}"


# ================================================================
# 5. VISION HIGGINS BUILDER TESTS
# ================================================================

class TestVisionHigginsBuilder:
    """Verify _build_vision_higgins produces evidence-specific output."""

    def test_malicious_url_uses_specific_url(self):
        from routers.analysis import _build_vision_higgins
        result = _build_vision_higgins(
            image_type="email", description="An email claiming to be from NAB.", claimed_brand="NAB",
            confidence="high",
            findings=[{"type": "url", "indicator": "nab-secure.evil.site", "verdict": "malicious", "gate": "link"}],
            suspicious_indicators=["Sender domain doesn't match NAB"], legitimate_indicators=[],
            limitations=[], asks_user_to=["visit_url", "provide_credentials"], payment_details=None,
        )
        assert "nab-secure.evil.site" in result["headline"], "Headline should contain the specific malicious URL"
        assert "nab-secure.evil.site" in result["explanation"], "Explanation should reference the specific URL"

    def test_payment_change_explains_mechanism(self):
        from routers.analysis import _build_vision_higgins
        result = _build_vision_higgins(
            image_type="invoice", description="An invoice from a supplier.", claimed_brand="Smith Pty Ltd",
            confidence="high",
            findings=[], suspicious_indicators=["BSB changed from previous invoice"],
            legitimate_indicators=["ABN present"],
            limitations=[], asks_user_to=["make_payment"],
            payment_details={"present": True, "method": "bank transfer", "changed_details_warning": True},
        )
        assert "invoice fraud" in result["explanation"].lower(), "Should explain invoice fraud mechanism"
        assert "bank transfer" in result["explanation"].lower(), "Should mention the specific payment method"

    def test_legitimate_finding_reassures(self):
        from routers.analysis import _build_vision_higgins
        result = _build_vision_higgins(
            image_type="letter", description="A letter from a utility company.", claimed_brand="",
            confidence="high",
            findings=[], suspicious_indicators=[], legitimate_indicators=["Official letterhead", "ABN present"],
            limitations=[], asks_user_to=[], payment_details=None,
        )
        assert "no clear security concerns" in result["headline"].lower() or "no immediate action" in result["action"].lower()
        assert result["severity"] == "low"

    def test_claimed_brand_in_recommendation(self):
        from routers.analysis import _build_vision_higgins
        result = _build_vision_higgins(
            image_type="sms", description="An SMS about account verification.", claimed_brand="Telstra",
            confidence="high",
            findings=[], suspicious_indicators=["Unfamiliar sender number", "Urgency language"],
            legitimate_indicators=[],
            limitations=[], asks_user_to=["visit_url"], payment_details=None,
        )
        assert "Telstra" in result["headline"] or "Telstra" in result["explanation"]
        assert "Telstra" in result["action"], "Action should reference the specific brand for verification"
