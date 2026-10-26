"""Protection explanations: reviewed text only. Apollo Protections are canonical; the common Device Protections are
pre-written; anything else has no explanation and nothing calls Gemini to write one."""
from services import protection_explanations as pe
from services.protection_knowledge import APOLLO_PROTECTIONS, DEVICE_SEEDS


def test_every_apollo_protection_has_one_canonical_explanation():
    assert set(APOLLO_PROTECTIONS) == {"site", "link", "text", "call", "network", "account", "email", "file", "app", "device"}
    for gate in APOLLO_PROTECTIONS:
        found = pe.apollo_explanation(gate)
        assert found["source"] == "apollo_reviewed" and found["version"] >= 1
        for field in ("what", "why", "protectsAgainst", "recommended"):
            assert len(found["explanation"][field]) > 20, (gate, field)
    assert pe.apollo_explanation("nope") is None


def test_common_device_protections_are_pre_written_and_nothing_else_is_invented():
    for pid in ("screen_lock", "app_scanner", "private_dns", "os_updates", "find_my_device", "developer_options", "stolen_device_protection",
                "theft_protection", "samsung_auto_blocker", "firewall", "disk_encryption"):
        assert pid in DEVICE_SEEDS, pid
    found = pe.reviewed_device_explanation("screen_lock")
    assert found["source"] == "apollo_reviewed" and len(found["explanation"]["why"]) > 20
    assert pe.reviewed_device_explanation("call:com.hiya.star") is None


def test_no_ai_explanation_code_is_left():
    source = open(pe.__file__).read()
    assert "provider" not in source and "generate" not in source


def test_the_api_serves_reviewed_text_and_has_no_ai_route():
    from test_device_auth import Dev
    d = Dev()
    assert d.get("/protections/device/private_dns").status_code == 200
    assert d.get("/protections/device/call:com.hiya.star").status_code == 404
    gone = d.post("/protections/device/explanation", json={"protectionId": "call:com.hiya.star", "title": "Hiya", "platform": "android"})
    assert gone.status_code in (404, 405)
