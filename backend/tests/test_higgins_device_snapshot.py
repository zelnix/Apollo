"""The Higgins device snapshot contract.

`DeviceSnapshot` forbids unknown fields, so any drift between the TypeScript interface in
`frontend/src/higgins/deviceSnapshot.ts` and this model rejects the whole question with a 422.
These tests pin the camelCase wire shape the app actually sends, including the Device Capabilities
block, and prove Higgins' deterministic answers keep the attribution wording.
"""
from services.higgins import chat


FULL_WIRE = {
    "platform": "android",
    "checkedAt": "2026-06-02T09:00:00.000Z",
    "protectionOn": True,
    "adapter": "Apollo GuardDog",
    "gates": [{"id": "site", "title": "Site protection", "status": "Running", "tone": "resting",
               "automatic": True, "coverage": "full"}],
    "permissions": ["vpn_config: granted", "notifications: granted"],
    "network": "connected via wifi",
    "threatCounts": ["0 in total"],
    "openThreats": [],
    "alerts": "permission granted",
    "quietHours": "off",
    "batterySaver": False,
    "trustedLinks": 0,
    "savedChecks": 0,
    "personalData": "0 entries saved for Apollo to protect",
    "callScreener": "Not the active screener",
    "emailAccounts": "0 added, 0 connected",
    "capabilitySummary": "Apollo can use 6 of the 13 capabilities it looks for on this device.",
    "deviceProtections": [
        "Samsung Smart Call — Caller ID & spam filtering — Active on your device — does not share its decision with Apollo",
    ],
    "capabilities": [
        "App permissions: Available to Apollo",
        "Notification access: Permission needed",
        "Your phone’s own scam-call warning: Managed by your device (per Samsung Smart Call)",
        "Apps drawing over others: Managed by your device (per Android)",
    ],
    "recommendedSettings": [
        "Google Play Protect — Recommended protection — Apollo cannot read whether this is on. "
        "Higgins recommends checking that Play Protect is turned on.",
    ],
    "notes": [],
}


def test_full_app_snapshot_is_accepted():
    """Every field the app sends must validate — extra='forbid' makes drift a hard failure."""
    snap = chat.DeviceSnapshot.model_validate(FULL_WIRE)
    assert snap.capability_summary.startswith("Apollo can use 6")
    assert len(snap.capabilities) == 4
    assert snap.device_protections[0].startswith("Samsung Smart Call")


def test_capability_answer_keeps_the_providers_attribution():
    """Higgins answers device questions from the snapshot itself, with the provider's own wording intact."""
    from services.higgins import presenter
    snap = chat.DeviceSnapshot.model_validate(FULL_WIRE)
    protections = presenter.device_state(snap, "what does my phone protect by itself?")
    assert "provided by the device maker or operating system, not by Apollo" in protections["answer"]
    assert "Samsung Smart Call — Caller ID & spam filtering" in protections["answer"]
    settings = presenter.device_state(snap, "what settings should I turn on?")
    assert "Apollo can't read these settings" in settings["answer"] and "Google Play Protect" in settings["answer"]


def test_snapshot_without_capability_block_still_validates():
    """Older clients that don't send the capability block must keep working."""
    from services.higgins import presenter
    wire = {k: v for k, v in FULL_WIRE.items()
            if k not in {"capabilitySummary", "deviceProtections", "capabilities", "recommendedSettings"}}
    snap = chat.DeviceSnapshot.model_validate(wire)
    assert snap.capability_summary is None
    assert snap.capabilities == []
    answer = presenter.device_state(snap, "what can Apollo access on this phone?")
    assert answer["limitation"] is True and "doesn't have a reading" in answer["answer"]
