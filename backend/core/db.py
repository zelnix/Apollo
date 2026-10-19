"""Motor client + shared document helpers. Import core.config first so .env is loaded."""
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

import os

import core.config  # noqa: F401  (loads .env)

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- Mongo base
PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    def to_mongo(self) -> dict[str, Any]:
        data = self.model_dump(by_alias=True, exclude_none=True)
        data.pop("_id", None)
        return data

    @classmethod
    def from_mongo(cls, doc: dict[str, Any]):
        return cls.model_validate(doc)
