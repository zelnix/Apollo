"""Typed, encrypted, owner-scoped Higgins context and redacted ordinary-chat history.

This module has no investigation, evidence, tool, browser or search dependency. Context reads are
allow-listed, freshness-checked and owner-filtered before they can enter an ordinary chat prompt.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from typing import Literal, Optional

from pydantic import Field

from core.db import db, now_utc
from core.redaction import redact_investigation_secrets
from services.higgins.contracts import Wire
from services.higgins.encryption import decrypt, encrypt

ContextCategory = Literal["recent_outcome", "protection_state", "preference", "goal", "permission"]
ContextProvenance = Literal["device_observation", "apollo_outcome", "user_report", "user_preference"]
EXPIRY = {"recent_outcome": timedelta(days=7), "protection_state": timedelta(hours=1), "preference": timedelta(days=90), "goal": timedelta(days=30), "permission": timedelta(days=1)}
MAX_PER_CATEGORY = 25
MAX_TOTAL = 100
MAX_CHAT_MESSAGES = 60
CHAT_CONTENT_TTL = timedelta(minutes=5)
CHAT_RECEIPT_TTL = timedelta(days=30)


class ContextWrite(Wire):
    category: ContextCategory
    summary: str = Field(min_length=1, max_length=600)
    provenance: ContextProvenance
    observed_at: Optional[datetime] = None


class ContextItem(Wire):
    id: str
    category: ContextCategory
    summary: str
    provenance: ContextProvenance
    observed_at: datetime
    expires_at: datetime
    redaction: Literal["secret_redacted"] = "secret_redacted"


class ChatHistoryItem(Wire):
    id: str
    role: Literal["user", "higgins"]
    content: str
    created_at: datetime
    conversation_id: str
    turn_id: str
    expires_at: datetime


def _enc(value: dict) -> str:
    return encrypt(json.dumps(value, ensure_ascii=False).encode())


def _dec(value: str) -> dict:
    return json.loads(decrypt(value).decode())


async def ensure_indexes() -> None:
    await db.higgins_context.create_index([("owner_id", 1), ("category", 1), ("observed_at", -1)])
    await db.higgins_context.create_index("context_id", unique=True)
    await db.higgins_context.create_index("expires_at", expireAfterSeconds=0)
    await db.higgins_chat_messages.create_index([("owner_id", 1), ("created_at", -1)])
    await db.higgins_chat_messages.create_index([("owner_id", 1), ("message_id", 1)], unique=True)
    await db.higgins_chat_messages.create_index("expires_at", expireAfterSeconds=0)
    await db.higgins_chat_receipts.create_index([("owner_id", 1), ("turn_id", 1)], unique=True)
    await db.higgins_chat_receipts.create_index("expires_at", expireAfterSeconds=0)


async def put(owner: str, value: ContextWrite) -> ContextItem:
    now = now_utc()
    observed = value.observed_at or now
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=now.tzinfo)
    if observed > now + timedelta(minutes=2):
        observed = now
    summary = redact_investigation_secrets(value.summary).strip()
    context_id = str(uuid.uuid4())
    expires = min(observed + EXPIRY[value.category], now + EXPIRY[value.category])
    item = ContextItem(id=context_id, category=value.category, summary=summary, provenance=value.provenance, observed_at=observed, expires_at=expires)
    await db.higgins_context.insert_one({"owner_id": owner, "context_id": context_id, "category": value.category, "provenance": value.provenance,
                                         "observed_at": observed, "expires_at": expires, "redaction": "secret_redacted",
                                         "content_ciphertext": _enc({"summary": summary}), "created_at": now})
    category_rows = await db.higgins_context.find({"owner_id": owner, "category": value.category}, {"_id": 0, "context_id": 1}).sort("observed_at", -1).skip(MAX_PER_CATEGORY).to_list(None)
    if category_rows:
        await db.higgins_context.delete_many({"owner_id": owner, "context_id": {"$in": [row["context_id"] for row in category_rows]}})
    all_rows = await db.higgins_context.find({"owner_id": owner}, {"_id": 0, "context_id": 1}).sort("observed_at", -1).skip(MAX_TOTAL).to_list(None)
    if all_rows:
        await db.higgins_context.delete_many({"owner_id": owner, "context_id": {"$in": [row["context_id"] for row in all_rows]}})
    return item


async def current(owner: str, limit: int = 30) -> list[ContextItem]:
    now = now_utc()
    rows = await db.higgins_context.find({"owner_id": owner, "expires_at": {"$gt": now}}, {"_id": 0}).sort("observed_at", -1).limit(min(limit, 50)).to_list(None)
    items: list[ContextItem] = []
    for row in rows:
        try:
            summary = redact_investigation_secrets(str(_dec(row["content_ciphertext"])["summary"]))
            items.append(ContextItem(id=row["context_id"], category=row["category"], summary=summary, provenance=row["provenance"],
                                     observed_at=row["observed_at"], expires_at=row["expires_at"], redaction="secret_redacted"))
        except (KeyError, ValueError, TypeError):
            continue
    return items


async def clear(owner: str) -> int:
    return (await db.higgins_context.delete_many({"owner_id": owner})).deleted_count


async def add_chat_message(owner: str, conversation_id: str, turn_id: str, role: Literal["user", "higgins"], content: str, expires_at: datetime) -> ChatHistoryItem:
    now = now_utc(); clean = redact_investigation_secrets(content).strip(); message_id = str(uuid.uuid4())
    item = ChatHistoryItem(id=message_id, role=role, content=clean, created_at=now, conversation_id=conversation_id, turn_id=turn_id, expires_at=expires_at)
    await db.higgins_chat_messages.insert_one({"owner_id": owner, "message_id": message_id, "role": role, "conversation_id": conversation_id,
                                               "turn_id": turn_id, "content_ciphertext": _enc({"content": clean}), "created_at": now, "expires_at": expires_at,
                                               "retention_class": "ordinary_chat_content_5m"})
    old = await db.higgins_chat_messages.find({"owner_id": owner}, {"_id": 0, "message_id": 1}).sort("created_at", -1).skip(MAX_CHAT_MESSAGES).to_list(None)
    if old:
        await db.higgins_chat_messages.delete_many({"owner_id": owner, "message_id": {"$in": [row["message_id"] for row in old]}})
    return item


async def add_chat_exchange(owner: str, conversation_id: str, turn_id: str, question: str, answer: str,
                            *, classification: str, context_sources: list[str], investigation_available: bool) -> datetime:
    now, expires = now_utc(), now_utc() + CHAT_CONTENT_TTL
    await add_chat_message(owner, conversation_id, turn_id, "user", question, expires)
    await add_chat_message(owner, conversation_id, turn_id, "higgins", answer, expires)
    await db.higgins_chat_receipts.update_one(
        {"owner_id": owner, "turn_id": turn_id},
        {"$setOnInsert": {"owner_id": owner, "turn_id": turn_id, "conversation_id": conversation_id,
                          "classification": classification, "context_sources": context_sources,
                          "investigation_available": investigation_available, "created_at": now,
                          "content_expires_at": expires, "expires_at": now + CHAT_RECEIPT_TTL,
                          "retention_class": "ordinary_chat_non_content_receipt"}}, upsert=True)
    return expires


async def chat_history(owner: str, limit: int = 100) -> list[ChatHistoryItem]:
    rows = await db.higgins_chat_messages.find({"owner_id": owner, "expires_at": {"$gt": now_utc()}}, {"_id": 0}).sort("created_at", 1).limit(min(limit, MAX_CHAT_MESSAGES)).to_list(None)
    items: list[ChatHistoryItem] = []
    for row in rows:
        try:
            items.append(ChatHistoryItem(id=row["message_id"], role=row["role"], content=_dec(row["content_ciphertext"])["content"],
                                         created_at=row["created_at"], conversation_id=row["conversation_id"], turn_id=row["turn_id"], expires_at=row["expires_at"]))
        except (KeyError, ValueError, TypeError):
            continue
    return items


async def clear_chat(owner: str) -> int:
    content = (await db.higgins_chat_messages.delete_many({"owner_id": owner})).deleted_count
    await db.higgins_chat_receipts.delete_many({"owner_id": owner})
    return content


async def turn_history(owner: str, turn_ids: list[str]) -> list[ChatHistoryItem]:
    if not turn_ids:
        return []
    rows = await db.higgins_chat_messages.find({"owner_id": owner, "turn_id": {"$in": turn_ids}, "expires_at": {"$gt": now_utc()}}, {"_id": 0}).sort("created_at", 1).to_list(16)
    items: list[ChatHistoryItem] = []
    for row in rows:
        try:
            items.append(ChatHistoryItem(id=row["message_id"], role=row["role"], content=_dec(row["content_ciphertext"])["content"],
                                         created_at=row["created_at"], conversation_id=row["conversation_id"], turn_id=row["turn_id"], expires_at=row["expires_at"]))
        except (KeyError, ValueError, TypeError):
            continue
    return items


async def chat_receipts(owner: str, limit: int = 100) -> list[dict]:
    return await db.higgins_chat_receipts.find({"owner_id": owner, "expires_at": {"$gt": now_utc()}},
        {"_id": 0, "owner_id": 0, "expires_at": 0}).sort("created_at", -1).limit(limit).to_list(limit)