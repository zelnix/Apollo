"""Fixture regeneration must be deterministic and byte-identical to committed vectors."""
import json
import os
import sys

import pytest
from pathlib import Path

from tests.conftest import VECTORS

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import generate_test_vectors as gen  # noqa: E402


@pytest.mark.skipif(os.environ.get("GD_CI_EPHEMERAL_KEY") == "1", reason="fixtures are signed with the controlled-environment key; ephemeral CI keys cannot reproduce them byte-for-byte")
def test_regeneration_is_byte_identical(tmp_path, monkeypatch):
    before = {p.relative_to(VECTORS): p.read_bytes() for p in VECTORS.rglob("*") if p.is_file()}
    monkeypatch.setattr(gen, "ROOT", tmp_path)
    gen.main()
    for rel, content in before.items():
        if rel.parts[0] in ("signing", "jcs") and rel.suffix in (".json", ".hex"):
            assert (tmp_path / rel).read_bytes() == content, rel


def test_valid_bundle_targets_controlled_host_via_rule_not_hardcode():
    bundle = json.loads((VECTORS / "signing" / "valid_bundle.json").read_text())
    blocks = [r for r in bundle["payload"]["rules"] if r["action"] == "block"]
    assert blocks == [{"ruleId": "m1-controlled-block-001", "host": gen.CONTROLLED_HOST, "action": "block", "matchType": "exact", "category": "controlled-test"}]
