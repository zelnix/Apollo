"""Descriptive phone names from Google Play's supported devices list ("SM-F956B" → "Samsung Galaxy Z Fold6")."""
import pytest

from services import device_models

CSV = ("Retail Branding,Marketing Name,Device,Model\n"
       '"Samsung","Galaxy Z Fold6","q6q","SM-F956B"\n'
       '"Google","Pixel 8","shiba","Pixel 8"\n'
       '"OnePlus","OnePlus 12","OP595DL1","CPH2581"\n'
       '"","","AD681H","Smartfren Andromax AD681H"\n'
       '"xiaomi","Redmi Note 13","sapphire","23129RAA4G"\n').encode("utf-16")


def test_the_list_is_read_as_utf16_and_each_model_gets_its_descriptive_name():
    rows = {(r["brand_key"], r["model_key"]): r["name"] for r in device_models.parse(CSV)}
    assert rows[("samsung", "SM-F956B")] == "Samsung Galaxy Z Fold6"
    assert rows[("google", "PIXEL 8")] == "Google Pixel 8"
    assert rows[("oneplus", "CPH2581")] == "OnePlus 12"  # the brand isn't said twice
    assert rows[("xiaomi", "23129RAA4G")] == "Xiaomi Redmi Note 13"
    assert len(rows) == 4  # a row without a marketing name names nothing


@pytest.mark.parametrize("brand,marketing,name", [
    ("Samsung", "Galaxy S24 Ultra", "Samsung Galaxy S24 Ultra"),
    ("motorola", "moto g54 5G", "Motorola moto g54 5G"),
    ("", "Pixel 8", "Pixel 8"),
])
def test_descriptive(brand, marketing, name):
    assert device_models.descriptive(brand, marketing) == name


async def test_a_phone_is_named_from_the_model_it_reported(monkeypatch):
    rows = device_models.parse(CSV)

    class Collection:
        async def find_one(self, query, _projection=None):
            return next((r for r in rows if r["model_key"] == query["model_key"] and r["brand_key"] == query["brand_key"]), None)

        async def distinct(self, _field, query):
            return sorted({r["name"] for r in rows if r["model_key"] == query["model_key"]})

    class Db:
        def __getitem__(self, _name):
            return Collection()

    monkeypatch.setattr(device_models, "db", Db())
    device_models._cache.clear()
    assert await device_models.name_for("samsung", "SM-F956B") == "Samsung Galaxy Z Fold6"
    assert await device_models.name_for("Samsung Electronics", " sm-f956b ") == "Samsung Galaxy Z Fold6"  # one name for that code
    assert await device_models.name_for("samsung", "SM-UNKNOWN") is None
    assert await device_models.name_for("samsung", None) is None
