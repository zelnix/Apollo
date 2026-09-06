"""Public, non-secret M1 configuration consumed by the mobile harness."""
from fastapi import APIRouter, Request

router = APIRouter(tags=["config"])

# Honest capability statement for the Android selective-IP proof. Nothing more is claimed.
M1_CAPABILITIES = {
    "android": {
        "selectiveIpBlocking": True,
        "hostnameVisibility": "selective-ip-only",
        "dnsInterception": False,
        "dohDotCoverage": False,
        "quicHttp3Coverage": False,
        "perAppAttribution": False,
        "universalDeviceProtection": False,
    },
    "ios": {
        "selectiveIpBlocking": False,
        "hostnameVisibility": "none",
        "analysisAndWarningOnly": True,
    },
}


@router.get("/config")
async def get_config(request: Request) -> dict:
    s = request.app.state.settings
    return {
        "rulesetId": s.ruleset_id,
        "controlledEndpoint": {"host": s.controlled_host, "ipv4": s.controlled_ipv4, "url": s.controlled_url},
        "blockDedupeWindowMs": s.block_dedupe_window_ms,
        "signingKeyId": s.signing_key_id,
        "capabilities": M1_CAPABILITIES,
        "privacy": {
            "rawUrlsLeaveDevice": False,
            "cloudLookupPayload": "scheme + canonical host + path only; no userinfo/query/fragment/port",
            "threatScent": "local-only",
        },
    }
