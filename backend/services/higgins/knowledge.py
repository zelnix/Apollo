"""Apollo knowledge base (KB): reusable researched knowledge, searchable without AI.

Every entry keeps its source, link, authority tier, jurisdiction and dates, and Higgins quotes entries verbatim:
- learn_article      — published Learn with Higgins articles (in-app route)
- scam_alert         — official scam alerts and advisories from the government feeds
- official_guidance  — cyber.gov.au guidance (CC BY 4.0), shipped in data/cyber_gov_au_guidance.json
- scam_pattern       — established scam patterns as official sources describe them (teddy/patterns.py), with the
                       markers TC FlyBy compares submitted material against
- researched         — trusted pages found and maintained through Tavily (services/apollo_kb.py), versioned
- gemini_answer      — an answer cache: Gemini's answer to a general question nothing above covered. It is
                       labelled as Gemini's and is never treated as sourced knowledge.

KB knowledge is general knowledge. It is never evidence about anything a person asked Apollo to check.

Search is deterministic: a MongoDB text index narrows candidates, then a fixed term-coverage rule decides
whether an entry really answers the question. Stored answers must match the question itself, so an answer
is never reused for a different question.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Optional

from core.db import db, now_utc
from core.redaction import redact_investigation_secrets
from services.kb_sources import JURISDICTION_LABEL, TIER_1, TIER_LABEL

log = logging.getLogger("apollo.knowledge")

GUIDANCE_FILE = Path(__file__).resolve().parents[2] / "data" / "cyber_gov_au_guidance.json"
CYBER_PUBLISHER = "Australian Cyber Security Centre (cyber.gov.au)"
CYBER_LICENCE = "CC BY 4.0"
CYBER_ATTRIBUTION = "© Commonwealth of Australia (Australian Signals Directorate), licensed under CC BY 4.0."

_STOP = set("""a about above after again all am an and any are as at be because been before being below between both but by can
could did do does doing down during each few for from further get got had has have having he her here hers him his how i if in
into is it its itself just me more most my myself no nor not now of off on once only or other our out over own same she should
so some such than that the their them then there these they this those through to too under until up very was we were what when
where which while who whom why will with would you your yours yourself apollo higgins please tell explain know want need help
really thing things someone something way ways much many also like""".split())
_WORD = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")
# Questions that carry personal detail are answered but never stored for reuse.
_PERSONAL = re.compile(r"https?://|www\.|@|\d{6,}|\b(my name is|i live at|my address)\b", re.I)


def _stem(word: str) -> str:
    for suffix in ("ing", "es", "ed", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def terms(text: str) -> list[str]:
    """Content terms of a question: lower-cased, stop words removed, lightly stemmed, order kept."""
    seen: list[str] = []
    for word in _WORD.findall((text or "").lower().replace("’", "'")):
        word = word.split("'")[0]
        if len(word) < 3 or word in _STOP:
            continue
        stem = _stem(word)
        if stem not in seen:
            seen.append(stem)
    return seen


def _coverage(query_terms: list[str], text: str) -> float:
    if not query_terms:
        return 0.0
    have = set(terms(text))
    return sum(1 for term in query_terms if term in have) / len(query_terms)


def _kb_id(kind: str, key: str) -> str:
    return hashlib.sha256(f"{kind}:{key}".encode()).hexdigest()[:32]


async def ensure_indexes() -> None:
    # Pages once quoted for a live question (Tavily is now for KB maintenance only); the KB re-reads them properly.
    await db.higgins_knowledge.delete_many({"kind": "web_result"})
    await db.higgins_knowledge.create_index("kb_id", unique=True)
    await db.higgins_knowledge.create_index([("kind", 1), ("updated_at", -1)])
    await db.higgins_knowledge.create_index([("title", "text"), ("question", "text"), ("body", "text")],
                                            weights={"title": 6, "question": 8, "body": 1}, name="kb_text", default_language="english")


async def upsert(kind: str, key: str, *, title: str, body: str, publisher: str, authority_tier: str, jurisdiction: str,
                 url: str | None = None, route: str | None = None, question: str = "", licence: str = "", attribution: str = "",
                 published_at=None, retrieved_via: str = "apollo", knowledge_class: str = "general_knowledge",
                 extra: Optional[dict] = None) -> str:
    kb_id = _kb_id(kind, key)
    now = now_utc()
    provenance = {"source_url": url, "publisher": publisher, "authority_tier": authority_tier, "jurisdiction": jurisdiction,
                  "licence": licence, "attribution": attribution, "published_at": published_at, "retrieved_at": now,
                  "last_checked_at": now, "retrieved_via": retrieved_via}
    await db.higgins_knowledge.update_one({"kb_id": kb_id}, {
        "$set": {"kind": kind, "key": key, "title": title[:300], "body": body[:20000], "publisher": publisher, "url": url, "route": route,
                 "question": question[:400], "licence": licence, "attribution": attribution, "authority_tier": authority_tier,
                 "jurisdiction": jurisdiction, "knowledge_class": knowledge_class, "status": "current", "provenance": provenance,
                 "updated_at": now, **(extra or {})},
        "$setOnInsert": {"kb_id": kb_id, "created_at": now, "hits": 0}}, upsert=True)
    return kb_id


# ── Loading what Apollo already holds ─────────────────────────────────────────

def _article_text(article: dict) -> str:
    parts = [article.get("summary") or ""]
    for section in article.get("sections") or []:
        parts.append("\n".join([section.get("heading") or "", *[str(p) for p in section.get("paragraphs") or []],
                                *[str(b) for b in section.get("bullets") or []]]))
    return "\n\n".join(part.strip() for part in parts if part and part.strip())


_LANGUAGE_REGION = {"en-AU": "AU", "en-US": "US", "en-GB": "UK", "en-NZ": "NZ", "en-CA": "CA"}


async def sync_learn_articles() -> int:
    count = 0
    # Articles Apollo made from researched pages are already in the KB as those pages' own records.
    async for article in db.learning_articles.find({"status": "published", "deleted_at": None, "source_type": {"$ne": "apollo_kb"}}, {"_id": 0}):
        citations = [c.get("label") for c in article.get("citations") or [] if c.get("label")]
        await upsert("learn_article", article["slug"], title=article["title"], body=_article_text(article),
                     publisher="Learn with Higgins" + (f" (sources: {', '.join(citations[:3])})" if citations else ""),
                     route=f"/higgins/learning/{article['slug']}", authority_tier="apollo_curated",
                     jurisdiction=_LANGUAGE_REGION.get(article.get("language") or "", "INTL"), published_at=article.get("published_at"))
        count += 1
    return count


async def sync_scam_alerts() -> int:
    """Every analysed official alert/advisory, in the source's own words."""
    from services import government_alerts, scam_analysis, scam_intel
    sources = {row["source_id"]: row for row in await db.learning_sources.find({}, {"_id": 0, "source_id": 1, "name": 1}).to_list(500)}
    count = 0
    # Alerts the KB itself found (origin apollo_kb) are already in the KB as researched records.
    async for row in db.learning_feed_items.find({"scam_analysis.analysisVersion": scam_analysis.ANALYSIS_VERSION,
                                                  "origin": {"$ne": "apollo_kb"}}, {"_id": 0}):
        analysis = row["scam_analysis"]
        if not (row.get("title") and row.get("url")) or row.get("url", "").find("#") >= 0:
            continue
        sections = analysis.get("sections") or {}
        body = "\n\n".join(part for part in [row.get("summary") or "", sections.get("whereHappening") or "",
                                             sections.get("whatToWatch") or "", sections.get("whatToDo") or ""] if part)
        source_name = government_alerts.SOURCE_DISPLAY_NAME.get(row["source_id"], (sources.get(row["source_id"]) or {}).get("name") or row["source_id"])
        region = scam_intel.region_for(row["source_id"])
        await upsert("scam_alert", row["url"], title=row["title"], body=body, publisher=source_name, url=row["url"],
                     authority_tier=TIER_1, jurisdiction="INTL" if region == "GLOBAL" else region, published_at=row.get("published_at"),
                     retrieved_via="government_feed", extra={"tier": analysis.get("tier"), "severity": analysis.get("severity"), "region": region})
        count += 1
    return count


async def load_official_guidance() -> int:
    """cyber.gov.au guidance shipped with Apollo (CC BY 4.0, attributed)."""
    if not GUIDANCE_FILE.exists():
        return 0
    entries = json.loads(GUIDANCE_FILE.read_text())
    for entry in entries:
        await upsert("official_guidance", entry["url"], title=entry["title"], body=entry["body"], publisher=CYBER_PUBLISHER,
                     url=entry["url"], licence=CYBER_LICENCE, attribution=CYBER_ATTRIBUTION, authority_tier=TIER_1, jurisdiction="AU",
                     retrieved_via="shipped_with_apollo")
    return len(entries)


async def refresh() -> dict:
    """Bring the KB up to date with Learn, Scam Alerts, the shipped official guidance and scam patterns. Idempotent."""
    from services.higgins.teddy import patterns
    result = {"learn": await sync_learn_articles(), "alerts": await sync_scam_alerts(), "guidance": await load_official_guidance(),
              "patterns": await patterns.load()}
    log.info("knowledge_refresh %s", result)
    return result


# ── Remembering new knowledge ─────────────────────────────────────────────────

def storable(question: str) -> bool:
    return redact_investigation_secrets(question) == question and not _PERSONAL.search(question)


async def remember_gemini_answer(question: str, answer: str) -> bool:
    if not storable(question):
        return False
    await upsert("gemini_answer", " ".join(terms(question)), title=question, question=question, body=answer,
                 publisher="Higgins (written by Gemini, Google's AI)", authority_tier="ai_generated", jurisdiction="INTL",
                 retrieved_via="gemini", knowledge_class="answer_cache")
    return True


# ── Search and verbatim presentation ──────────────────────────────────────────

def _accepts(entry: dict, query_terms: list[str]) -> float:
    """Coverage score if the entry genuinely answers the question, else 0. Stored answers must match the question."""
    if entry["kind"] == "gemini_answer":
        question_cover = _coverage(query_terms, entry.get("question") or "")
        return question_cover if question_cover >= (1.0 if len(query_terms) <= 2 else 0.8) else 0.0
    title_cover = _coverage(query_terms, entry.get("title") or "")
    full_cover = _coverage(query_terms, f"{entry.get('title') or ''} {entry.get('body') or ''}")
    needed = 1.0 if len(query_terms) <= 2 else 0.75
    if full_cover < needed or title_cover == 0:
        return 0.0
    return full_cover * (0.85 if entry.get("status") == "historical" else 1.0)  # current knowledge first


async def search(question: str, limit: int = 2) -> list[dict]:
    query_terms = terms(question)
    if not query_terms:
        return []
    try:
        rows = await db.higgins_knowledge.find({"$text": {"$search": " ".join(query_terms)}},
                                               {"_id": 0, "score": {"$meta": "textScore"}}).sort([("score", {"$meta": "textScore"})]).limit(25).to_list(25)
    except Exception:  # noqa: BLE001 — a missing index means no match, never a crash
        return []
    scored = [(coverage, row["score"], row) for row in rows if (coverage := _accepts(row, query_terms)) > 0]
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    picked = [row for _cover, _score, row in scored[:limit]]
    if picked:
        await db.higgins_knowledge.update_many({"kb_id": {"$in": [row["kb_id"] for row in picked]}}, {"$inc": {"hits": 1}})
    return picked


def related_share(entry: dict, query_terms: list[str]) -> float:
    """How strongly a sourced entry is ON THE SAME SUBJECT as the text: the share of its title found in the text.
    0 when it isn't related. Looser than _accepts — it needn't answer a question word for word — and saved AI
    answers never count, because they aren't sourced knowledge."""
    if entry.get("kind") == "gemini_answer":
        return 0.0
    title_terms = terms(entry.get("title") or "")
    if not title_terms:
        return 0.0
    wanted = set(query_terms)
    shared = sum(1 for term in title_terms if term in wanted)
    share = shared / len(title_terms)
    if len(query_terms) <= 6:  # a question: it must share its subject words with the entry
        return share if shared >= min(2, len(query_terms)) else 0.0
    return share if shared >= 2 and share >= 0.5 else 0.0  # evidence: half the entry's title must be in it


async def related(text: str, limit: int = 2) -> list[dict]:
    """Sourced entries on the same subject as `text`, best first. Used by the preview simulator, which answers
    from Apollo's own library instead of calling Gemini. Never raises: no index or no match means no entries."""
    query_terms = terms(text)[:30]
    if not query_terms:
        return []
    try:
        rows = await db.higgins_knowledge.find({"$text": {"$search": " ".join(query_terms)}, "kind": {"$ne": "gemini_answer"}},
                                               {"_id": 0, "sketch": 0, "score": {"$meta": "textScore"}}
                                               ).sort([("score", {"$meta": "textScore"})]).limit(25).to_list(25)
    except Exception:  # noqa: BLE001
        return []
    scored = [(share, row["score"], row) for row in rows if (share := related_share(row, query_terms)) > 0]
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [row for _share, _score, row in scored[:limit]]


def excerpt(body: str, query_terms: list[str], max_chars: int = 900) -> str:
    """The passages of the entry that best match the question, verbatim and in their original order."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n|\n", body or "") if len(p.strip()) > 1]
    if not paragraphs:
        return ""
    ranked = sorted(range(len(paragraphs)), key=lambda i: (-_coverage(query_terms, paragraphs[i]), i))
    chosen: list[int] = []
    total = 0
    for index in ranked:
        if total and _coverage(query_terms, paragraphs[index]) == 0:
            break
        if total + len(paragraphs[index]) > max_chars and chosen:
            continue
        chosen.append(index)
        total += len(paragraphs[index])
        if total >= max_chars * 0.6:
            break
    return "\n\n".join(paragraphs[i] for i in sorted(chosen))[: max_chars + 200]


GENERAL_KNOWLEDGE_NOTE = "This is general knowledge from Apollo's library. It isn't a finding about anything you've asked Apollo to check."


def _day(value) -> str:
    return value.strftime("%-d %B %Y") if hasattr(value, "strftime") else ""


def provenance_line(entry: dict) -> str:
    """Who says it, how authoritative they are, where it applies, when it was published or checked, and its status."""
    provenance = entry.get("provenance") or {}
    tier = TIER_LABEL.get(entry.get("authority_tier") or "", "")
    jurisdiction = entry.get("jurisdiction") or ""
    parts = [p for p in [tier, JURISDICTION_LABEL.get(jurisdiction, "") if jurisdiction != "INTL" else ""] if p]
    if provenance.get("published_at"):
        parts.append(f"published {_day(provenance['published_at'])}")
    elif provenance.get("last_checked_at") and entry.get("kind") == "researched":
        parts.append(f"Apollo last checked it {_day(provenance['last_checked_at'])}")
    if entry.get("status") == "updated" and entry.get("changed_at"):
        parts.append(f"updated {_day(entry['changed_at'])}")
    line = f"({' · '.join(parts)})" if parts else ""
    if entry.get("status") == "historical":
        line += " Historical: its source no longer publishes this, so it may be out of date."
    if jurisdiction not in ("", "AU", "INTL"):
        line += f" This is {JURISDICTION_LABEL.get(jurisdiction, jurisdiction)} guidance — contacts and reporting steps may differ where you live."
    return line.strip()


def present(entries: list[dict], question: str) -> tuple[str, list[dict]]:
    """Verbatim presentation: who says it, their words, its provenance, and where to read the rest."""
    query_terms = terms(question)
    blocks: list[str] = []
    sources: list[dict] = []
    for entry in entries:
        if entry["kind"] == "gemini_answer":
            blocks.append(f"{entry['body']}\n\n(Apollo saved this answer earlier. Gemini, Google's AI, wrote it because Apollo's library "
                          "didn't cover this question. No official source has checked it.)")
            continue
        words = excerpt(entry["body"], query_terms)
        intro = f"{entry['publisher']} — “{entry['title']}”" if entry["kind"] != "learn_article" else f"From the Learn with Higgins article “{entry['title']}”"
        meta = provenance_line(entry)
        link = f"\n\nRead the original: {entry['url']}" if entry.get("url") else ""
        blocks.append(f"{intro}{(' ' + meta) if meta else ''}:\n\n{words}{link}")
        sources.append({"title": entry["title"], "publisher": entry["publisher"], "url": entry.get("url"), "route": entry.get("route"),
                        "licence": entry.get("licence") or None})
    if sources:
        blocks.append(GENERAL_KNOWLEDGE_NOTE)
    return "\n\n———\n\n".join(blocks), sources


async def stats() -> list[dict]:
    return await db.higgins_knowledge.aggregate([{"$group": {"_id": "$kind", "entries": {"$sum": 1}, "hits": {"$sum": "$hits"},
                                                             "updated": {"$max": "$updated_at"}}}, {"$sort": {"_id": 1}}]).to_list(20)
