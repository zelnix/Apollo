"""Number Details: a phone number's country, line type and original network, from the numbering-plan data built into
libphonenumber (the `phonenumbers` package). No lookup service, no account, no lookup credit, nothing stored.

The network is the one the number's range was first given to. A number moved to another network keeps its range, so
this is always called the ORIGINAL network, never the network the number is on now."""
from __future__ import annotations

from typing import Optional

import phonenumbers
from phonenumbers import PhoneNumberType as T
from phonenumbers import carrier, geocoder
from pydantic import BaseModel

from services.phonerisk import normalize_phone

LINE_TYPE = {
    T.MOBILE: "Mobile",
    T.FIXED_LINE: "Landline",
    T.FIXED_LINE_OR_MOBILE: "Landline or mobile",
    T.TOLL_FREE: "Toll-free",
    T.PREMIUM_RATE: "Premium rate",
    T.SHARED_COST: "Business line (shared cost)",
    T.VOIP: "Internet calling (VoIP)",
    T.PERSONAL_NUMBER: "Personal number",
    T.PAGER: "Pager",
    T.UAN: "Business number",
    T.VOICEMAIL: "Voicemail",
}


class NumberDetails(BaseModel):
    number: str
    # False = the number matches no range in the numbering plan (not a number in use).
    valid: bool
    country_code: Optional[str] = None
    country: Optional[str] = None
    line_type: Optional[str] = None
    # The network the number's range was first given to (mobile numbers only); None when the data names none.
    network: Optional[str] = None
    source: str = "built_in"


def describe(raw: str, country: Optional[str]) -> NumberDetails:
    """What the numbering plan says about the number. Raises 422 (from normalize_phone) for something that isn't one."""
    e164 = normalize_phone(raw, country)
    parsed = phonenumbers.parse(e164, None)
    region = phonenumbers.region_code_for_number(parsed) or None
    valid = phonenumbers.is_valid_number(parsed)
    name = geocoder._region_display_name(region, "en") if region else ""  # noqa: SLF001 — the library's own country names
    return NumberDetails(
        number=e164,
        valid=valid,
        country_code=region,
        country=name or region,
        line_type=LINE_TYPE.get(phonenumbers.number_type(parsed)) if valid else None,
        network=(carrier.name_for_number(parsed, "en") or None) if valid else None,
    )
