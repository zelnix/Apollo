"""Protection explanations: reviewed text only. Apollo Protections are canonical; the common Device Protections are
pre-written, and so are the phone's own call and message protection apps; nothing calls Gemini to write one."""
import os
import re

from services import protection_explanations as pe
from services.protection_knowledge import APOLLO_PROTECTIONS, DEVICE_SEEDS, PROVIDER_KIND_SEEDS, PROVIDER_SEEDS


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
    assert pe.reviewed_device_explanation("made_up_protection") is None
    assert pe.reviewed_device_explanation("call:") is None


def test_every_catalogue_protection_has_a_reviewed_explanation():
    catalogue = open(os.path.join(os.path.dirname(__file__), "../../frontend/src/domain/deviceSecurityCatalogue.ts")).read()
    ids = set(re.findall(r'^    id: "([a-z_]+)",', catalogue, re.M))
    assert len(ids) >= 39
    assert ids <= set(DEVICE_SEEDS), sorted(ids - set(DEVICE_SEEDS))


def test_the_phones_own_call_and_message_protection_apps_are_explained():
    kotlin = open(os.path.join(os.path.dirname(__file__), "../../frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/AppDeviceCatalog.kt")).read()
    block = kotlin[kotlin.index("val NATIVE_PROTECTION"):kotlin.index("val VISIBLE_PACKAGES")]
    for package in re.findall(r'"([a-z.]+)"', block):
        assert f"call:{package}" in PROVIDER_SEEDS, package
    for pid in ("call:com.apple.mobilephone", "message:com.apple.MobileSMS", "message:com.google.android.apps.messaging"):
        found = pe.reviewed_device_explanation(pid)
        assert found["explanation"]["what"] == PROVIDER_SEEDS[pid]["what"]
    # An app ApolloSG has nothing specific on still gets the explanation that is true of its whole kind.
    assert pe.reviewed_device_explanation("call:com.example.blocker")["explanation"]["what"] == PROVIDER_KIND_SEEDS["call"]["what"]
    assert pe.reviewed_device_explanation("message:com.example.sms")["explanation"]["what"] == PROVIDER_KIND_SEEDS["message"]["what"]
    for seed in (*PROVIDER_SEEDS.values(), *PROVIDER_KIND_SEEDS.values()):
        assert set(seed) == {"what", "why", "protects_against"} and all(len(v) > 30 for v in seed.values())
        assert "Gemini" not in str(seed) and "Google AI" not in str(seed)


def test_no_ai_explanation_code_is_left():
    source = open(pe.__file__).read()
    assert "provider" not in source and "generate" not in source


def test_the_api_serves_reviewed_text_and_has_no_ai_route():
    from test_device_auth import Dev
    d = Dev()
    assert d.get("/protections/device/private_dns").status_code == 200
    hiya = d.get("/protections/device/call:com.hiya.star")
    assert hiya.status_code == 200 and hiya.json()["explanation"]["what"].startswith("Hiya")
    assert d.get("/protections/device/made_up_protection").status_code == 404
    gone = d.post("/protections/device/explanation", json={"protectionId": "call:com.hiya.star", "title": "Hiya", "platform": "android"})
    assert gone.status_code in (404, 405)
