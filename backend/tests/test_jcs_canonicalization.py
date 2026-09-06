import json

from app.services.jcs_canonicalization import canonical_bytes, canonical_hex
from tests.conftest import VECTORS


def test_canonical_bytes_match_committed_fixture():
    envelope = json.loads((VECTORS / "jcs" / "unsigned_envelope.json").read_text())
    expected = (VECTORS / "jcs" / "canonical_bytes.hex").read_text().strip()
    assert canonical_hex(envelope) == expected


def test_rfc8785_properties():
    # key ordering, no whitespace, minimal escaping, integers verbatim, unicode literal
    assert canonical_bytes({"b": 1, "a": [True, None, "x"]}) == b'{"a":[true,null,"x"],"b":1}'
    assert canonical_bytes({"s": "\u00fc\n\"\\"}) == '{"s":"\u00fc\\n\\"\\\\"}'.encode("utf-8")
    assert canonical_bytes({"n": 9007199254740991}) == b'{"n":9007199254740991}'
    assert canonical_bytes({"\u20ac": 1, "a": 2}) == '{"a":2,"\u20ac":1}'.encode("utf-8")


def test_key_order_is_utf16_code_unit_order():
    # U+1F600 (surrogates D83D DE00) sorts before U+FB01 in UTF-16 order, even though UTF-8/code point order differs.
    assert canonical_bytes({"\U0001F600": 1, "\uFB01": 2}) == '{"\U0001F600":1,"\uFB01":2}'.encode("utf-8")
