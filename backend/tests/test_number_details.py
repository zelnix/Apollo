"""Number Details: country, line type and original network from the numbering-plan data built into libphonenumber."""
import pytest
from fastapi import HTTPException

from services.number_details import describe


def test_australian_mobile_names_its_country_line_type_and_original_network():
    d = describe("0419 841 238", "AU")
    assert d.number == "+61419841238"
    assert d.valid is True
    assert (d.country_code, d.country) == ("AU", "Australia")
    assert d.line_type == "Mobile"
    assert d.network == "Telstra"
    assert d.source == "built_in"


def test_international_format_needs_no_country_hint():
    d = describe("+61412345678", None)
    assert (d.country, d.line_type, d.network) == ("Australia", "Mobile", "Optus")


def test_landline_and_business_numbers_have_a_line_type_but_no_network():
    landline = describe("02 9876 5432", "AU")
    assert (landline.line_type, landline.network) == ("Landline", None)
    assert describe("1800 123 456", "AU").line_type == "Toll-free"
    assert describe("1300 123 456", "AU").line_type == "Business line (shared cost)"


def test_us_number_names_the_united_states():
    d = describe("+1 415 555 2671", None)
    assert d.country == "United States"
    assert d.line_type == "Landline or mobile"


def test_something_that_is_not_a_phone_number_is_refused():
    with pytest.raises(HTTPException) as err:
        describe("hello", "AU")
    assert err.value.status_code == 422
