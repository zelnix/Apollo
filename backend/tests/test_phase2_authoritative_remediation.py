import json
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

from core.auth import LEARNING_ADMIN_PERMISSIONS
from services import capability_registry, learning, patrol_records
from services.higgins import chat, context_tools

ROOT = Path(__file__).resolve().parents[2]


def test_c21_registry_declares_exactly_ten_gates_and_tools():
    assert set(capability_registry.GATES) == {"site", "text", "call", "email", "link", "file", "app", "device", "account", "network"}
    assert {"get_product_capabilities", "get_gate_states"}.issubset(context_tools.READERS)
    assert all({"id", "title", "implementationOwner", "mode", "declared"} <= item.keys() for item in capability_registry.declarations())


def test_c22_device_result_contract_allows_canonical_unavailable_reason_without_leaking_schema_details():
    source = (ROOT / "frontend" / "src" / "domain" / "privacy.ts").read_text()
    assert '"unavailableReason"' in source
    assert 'readonly code = "EGRESS_SCHEMA_REJECTED"' in source
    assert 'Privacy policy blocked field' not in source
    case_store = (ROOT / "frontend" / "src" / "investigation" / "caseStore.ts").read_text()
    assert "pendingDeviceResult" in case_store and "Retrying the same device observation" in case_store


def test_c23_chat_contract_and_retention_are_bounded():
    schema = chat.ChatReply.model_json_schema(by_alias=True)
    assert {"turnId", "answer", "evidenceBasis", "uncertainty", "contextUsed", "suggestedActions", "investigationAvailable", "retention"}.issubset(schema["properties"])
    from services.higgins import context
    assert context.CHAT_CONTENT_TTL == timedelta(minutes=5)
    assert chat.ChatRetention(server_content_expires_at="2026-09-23T00:00:00Z").local_content_max_seconds == 3600
    source = (ROOT / "backend" / "services" / "higgins" / "chat.py").read_text()
    assert "coordinator" not in source and "investigative_work_started: Literal[False]" in source


def test_c24_server_projection_never_turns_an_unverified_claim_into_blocked():
    claimed = SimpleNamespace(state="biting", status="active")
    assert patrol_records._effective(claimed, False) == ("danger", "unverified_block_claim_rejected")
    assert patrol_records._effective(claimed, True) == ("blocked", "fresh_packet_drop_evidence")
    source = (ROOT / "frontend" / "src" / "domain" / "patrolOutcomes.ts").read_text()
    assert "event.patrol_record?.effectiveReason" in source and "logicalIssueKey" in source


def test_c25_catalogue_is_backend_owned_complete_and_import_only():
    package = json.loads((ROOT / "backend" / "content" / "learning_catalogue_au.json").read_text())
    assert len(package["articles"]) >= 35
    assert len({article["slug"] for article in package["articles"]}) == len(package["articles"])
    assert all(len(article["overview"].split()) >= 20 for article in package["articles"])
    assert all(len(article["signs"] + article["actions"] + article["recovery"]) >= 9 for article in package["articles"])
    assert all(feed["reviewQueuePolicy"] == "always_review" for feed in package["feeds"])
    source = (ROOT / "backend" / "services" / "learning.py").read_text()
    assert "SEEDS" not in source and "setOnInsert\": article" not in source
    assert (ROOT / "backend" / "scripts" / "import_learning_catalogue.py").exists()


def test_learning_quality_and_permissions_are_explicit():
    assert LEARNING_ADMIN_PERMISSIONS == {"learning_content_view", "learning_content_edit", "learning_content_review", "learning_content_publish", "learning_source_manage", "learning_feed_manage"}
    sample = {"title": "Safe verification guide", "summary": "A complete plain-language explanation for checking an unexpected request safely.",
              "tags": ["verification", "requests"], "sections": [
                  {"heading": "Recognise", "paragraphs": ["An unexpected request can look familiar while still coming from someone else. Slow down and inspect the request through a separate channel before acting."], "bullets": ["Notice pressure and secrecy.", "Check the actual destination."]},
                  {"heading": "Check", "paragraphs": ["Open the organisation's official application or type its known address yourself. Do not use contact details contained in the suspicious message."], "bullets": ["Call a known number.", "Keep codes private."]},
                  {"heading": "Recover", "paragraphs": ["If information or money moved, contact the relevant provider promptly and keep a concise record of what happened for its fraud process."], "bullets": ["Secure affected accounts.", "Report through official channels."]}],
              "citations": [{"sourceId": "scamwatch", "url": "https://www.scamwatch.gov.au/guide"}]}
    result = learning.quality_checks(sample, {"scamwatch"})
    assert result["passed"] is True and not result["citationErrors"] and not result["prohibitedPatterns"]


def test_feed_transport_checks_final_allowlisted_host_and_content_type():
    source = (ROOT / "backend" / "services" / "learning_feeds.py").read_text()
    assert "feed redirect escaped source allowlist" in source
    assert "public_get(feed[\"url\"], max_hops=2)" in source
    assert "allowed_types" in source and "MAX_BYTES = 1_048_576" in source
    assert "approved_listing_page" in source and "allowed_path_prefixes" in source
    assert "scheduled learning feed refresh failed" in source and "FeedRefreshFailure" in source