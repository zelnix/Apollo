import pytest

from app.domain.models.rule_entry import RuleEntry
from app.domain.validation.rule_conflicts import RuleValidationError, validate_and_canonicalize


def r(rule_id, host, action="block"):
    return RuleEntry(ruleId=rule_id, host=host, action=action)


def test_duplicate_rule_ids_rejected():
    with pytest.raises(RuleValidationError, match="duplicate ruleId"):
        validate_and_canonicalize([r("a", "one.example"), r("a", "two.example")])


@pytest.mark.parametrize(
    "h1,h2",
    [
        ("Example.com", "example.COM"),
        ("example.com.", "example.com"),
        ("bücher.example", "xn--bcher-kva.example"),
        ("BÜCHER.example", "bücher.example"),
        ("XN--BCHER-KVA.example", "bücher.example."),
    ],
)
def test_equivalent_hosts_with_conflicting_actions_rejected(h1, h2):
    with pytest.raises(RuleValidationError, match="conflicting actions"):
        validate_and_canonicalize([r("a", h1, "block"), r("b", h2, "allow")])


def test_equivalent_duplicate_same_action_rejected():
    with pytest.raises(RuleValidationError, match="duplicate host"):
        validate_and_canonicalize([r("a", "Example.com"), r("b", "example.com.")])


def test_invalid_host_rejected():
    with pytest.raises(RuleValidationError, match="invalid host"):
        validate_and_canonicalize([r("a", "bad host.example")])


def test_valid_rules_are_canonicalized():
    out = validate_and_canonicalize([r("a", "Block.Example."), r("b", "Allow.Example", "allow")])
    assert [x.host for x in out] == ["block.example", "allow.example"]


@pytest.mark.anyio
async def test_sign_endpoint_reports_conflicts(client, admin_headers):
    body = {
        "rulesetId": "gd-m1-controlled-block",
        "confirm": True,
        "rules": [{"ruleId": "x", "host": "a.example", "action": "block"}, {"ruleId": "y", "host": "A.EXAMPLE.", "action": "allow"}],
    }
    r = await client.post("/api/rules/sign", json=body, headers=admin_headers)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "RULE_CONFLICT"
