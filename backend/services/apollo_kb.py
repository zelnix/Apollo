"""Apollo Knowledge Base maintenance — Tavily discovers and maintains; trusted sources provide authority.

  Trusted sources → Tavily finds new or changed pages → candidates → deduplicate → extract the source's own
  words → automatic checks → store with provenance → Apollo KB (+ Scam Alerts, + Learn with Higgins)

The owner's Rules of Engagement, as enforced here:
- Tavily is used only here — never by Magnum DI, live investigations or to answer a question as it is asked.
- Tavily is never the source. Every record keeps the page, publisher, authority tier, jurisdiction, licence and
  dates (published when the page says, retrieved, last checked).
- History is kept. A page whose words change becomes a new version and the old one is kept as Superseded;
  a page its source no longer serves becomes Historical. Nothing is deleted.
- No near-duplicates. The same page is updated in place; the same words on another page are recorded as
  another place they are published.
- Nothing is invented. Knowledge is the source's own words; a fact the page doesn't state stays missing, and a
  page that fails the automatic checks is not stored as knowledge.
- Apollo knowledge is general knowledge. It is never case evidence.
No AI is called here: classification uses the same fixed rules as Scam Alerts.
"""
from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pymongo.errors import DuplicateKeyError

from core.db import db, now_utc
from services import kb_sources, scam_analysis, tavily_client
from services.kb_sources import TIER_1, TIER_2, TIER_3

log = logging.getLogger("apollo.kb")

RUN_EVERY = timedelta(days=7)
RETRY_AFTER = timedelta(days=1)
RECHECK_AFTER = timedelta(days=7)
UPDATED_FOR = timedelta(days=30)
ALERT_MAX_AGE = timedelta(days=180)
ALERT_HISTORICAL_AFTER = timedelta(days=730)
FAILED_CHECKS_BEFORE_HISTORICAL = 2
MAX_RECHECKS = 40
SAME_PAGE = 0.92
NEAR_DUPLICATE = 0.85
MIN_WORDS = 120
MAX_LINK_DENSITY = 0.4
LOCK_FOR = timedelta(hours=1)
ALERT_FEED_ID = "apollo-kb"

GUIDANCE_TOPICS = (
    "how to spot a phishing scam", "text message scams", "phone call impersonation scams", "investment scams",
    "romance scams", "remote access tech support scams", "online shopping scams", "job and employment scams",
    "identity theft what to do", "protect your accounts with passphrases and multi-factor authentication",
    "what to do if you have been scammed", "deepfake and AI voice scams", "QR code scams", "cryptocurrency scams",
)
ALERT_TOPICS = ("scam alert warning", "new scam targeting consumers", "impersonation scam warning", "text message scam warning")
TIER_RESULTS = {TIER_1: 5, TIER_2: 4, TIER_3: 3}

_TOPICS = {name: re.compile(pattern, re.I) for name, pattern in {
    "phishing": r"phish|smish|fake (?:emails?|texts?|websites?)",
    "text messages": r"\btext messages?\b|\bsms\b",
    "phone calls": r"\bphone (?:calls?|scams?)\b|\bvish",
    "impersonation": r"impersonat|pretend(?:s|ing)? to be",
    "investment": r"\binvest",
    "cryptocurrency": r"crypto|bitcoin",
    "romance": r"romance|dating",
    "remote access": r"remote access|tech(?:nical)? support",
    "online shopping": r"online shopping|fake (?:online )?(?:stores?|shops?)|marketplace",
    "jobs": r"\bjobs? (?:scams?|offers?)|employment scam",
    "identity theft": r"identity (?:theft|crime|fraud)",
    "data breach": r"data breach",
    "account security": r"passphrase|password|multi-factor|two-factor|\bmfa\b|passkey",
    "malware": r"malware|ransomware|virus",
    "deepfakes": r"deepfake|voice clon|ai[- ]generated",
    "qr codes": r"\bqr codes?\b",
    "recovery": r"if you(?:'ve| have) been scammed|report (?:a|the|it)|recover",
}.items()}
_CATEGORY = (("recovery", "After an incident"), ("account security", "Accounts and identity"), ("identity theft", "Accounts and identity"),
             ("data breach", "Accounts and identity"), ("phishing", "Messages and email"), ("text messages", "Messages and email"),
             ("phone calls", "Calls and impersonation"), ("impersonation", "Calls and impersonation"),
             ("online shopping", "Shopping and payments"), ("malware", "Devices, apps and networks"),
             ("remote access", "Devices, apps and networks"), ("qr codes", "Devices, apps and networks"))
_LANGUAGE = {"AU": "en-AU", "US": "en-US", "UK": "en-GB", "NZ": "en-NZ", "CA": "en-CA"}


# ── Reading a page: the source's own words, without the website around them ─────

_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\((?:[^()]|\([^)]*\))*\)")
_FOOTNOTE = re.compile(r"\[\d{1,3}\]")
_BANNER = re.compile(r"official website of the|websites? (?:often )?end in \.gov|an? \.gov website|secure \.gov|https:// (?:means|ensures)|lock icon"
                     r"|here[’']s how you know|cookies?\b|by clicking a retailer link|share sensitive information only|please share your thoughts?"
                     r"|^disclaimer$|email protected|download microsoft edge|upgrade to microsoft edge", re.I)
_LINK_ONLY = re.compile(r"(?:(?:[-*+•]|\d+[.)])\s+)?\x01[^\x01\x02]*\x02[\s.,;]*")
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET = re.compile(r"^(?:[-*+•]|\d+[.)])\s+")
_JUNK = re.compile(r"skip to|cookie|readspeaker|listen to this page|share (?:this|on)|print (?:this )?page|back to top|subscribe|sign up|follow us|javascript"
                   r"|official website of the|websites? (?:often )?end in \.gov|\.gov website|secure \.gov|lock icon|here[’']s how you know"
                   r"|share sensitive information only|you have been logged out|breadcrumb", re.I)
_SKIP_HEADING = re.compile(r"^(?:breadcrumbs?|main navigation|navigation|menu|search|site search|on this page|in this section|contents|table of contents)$", re.I)
_END = re.compile(r"^(?:was this (?:page|information) helpful|related (?:content|links|pages|articles|resources)|share this|connect with us|footer|"
                  r"stay connected|follow us|subscribe|contact us|explore more|more from)\b", re.I)
_MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
_PAGE_DATE = re.compile(rf"\b(?:last updated|updated|published|date published|first published)\W{{0,3}}(?:on\s+)?(\d{{1,2}} (?:{_MONTHS}) 20\d\d)", re.I)
_ENGLISH = set("the and to of a in is you your for that are with be this or it can on if they as not have from by".split())
_LISTING = {"search", "search-terms", "tag", "tags", "category", "categories", "topics", "page", "news-and-alerts", "consumer-alerts",
            "alerts", "news", "blog", "blogs", "advisories", "publications", "resources", "about-us", "contact-us", "sitemap"}
_TAXONOMY = {"search", "search-terms", "tag", "tags", "category", "categories", "topic", "topics", "archive", "archives", "author"}
_LISTING_TITLE = re.compile(r"^(?:tag|tags|category|topic|archive|search results?|author)\s*:|^page \d+\b", re.I)


def _date(text: str) -> datetime | None:
    try:
        return datetime.strptime(text.strip(), "%d %B %Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_page(raw: str) -> dict:
    """Headings, paragraphs and bullet points of the page itself; menus, footers and link lists are dropped.

    `link_density` is the share of the kept words that were nothing but a link — high on listing pages."""
    blocks: list[tuple[str, str]] = []
    title, page_date, link_words = "", None, 0
    # Link text is kept and marked line by line (links can span several lines), so a line that was nothing but a link is known.
    marked = _LINK.sub(lambda m: "\x01" + m.group(1).replace("\n", "\x02\n\x01") + "\x02", _IMAGE.sub("", raw or ""))
    for raw_line in marked.splitlines():
        bare = raw_line.strip()
        link_only = bool(_LINK_ONLY.fullmatch(bare))
        line = re.sub(r"\s+", " ", _FOOTNOTE.sub("", bare.replace("\x01", "").replace("\x02", "")).replace("\u00a0", " ")
                      .replace("**", "").replace("\u200d", "")).strip()
        if not line or _BANNER.search(line):
            continue
        if not page_date and (found := _PAGE_DATE.search(line)):
            page_date = _date(found.group(1))
        heading = _HEADING.match(line)
        if heading:
            words = heading.group(2).strip(" #*_")
            if not words:
                continue
            if _END.match(words) and blocks:
                break
            if _SKIP_HEADING.match(words) or _JUNK.search(words):
                continue
            if heading.group(1) == "#" and not title:
                title = words
            else:
                blocks.append(("heading", words))
            continue
        if _JUNK.search(line) and len(line.split()) < 12:
            continue
        if _BULLET.match(line):
            item = _BULLET.sub("", line).strip(" *_")
            if len(item.split()) >= 4:
                blocks.append(("bullet", item))
                link_words += len(item.split()) if link_only else 0
            continue
        line = line.strip(" *_>")
        if len(line.split()) >= 6 and not line.startswith("|"):
            blocks.append(("para", line))
            link_words += len(line.split()) if link_only else 0
    while blocks and blocks[-1][0] == "heading":
        blocks.pop()
    words = sum(len(value.split()) for kind, value in blocks if kind != "heading")
    return {"title": title, "blocks": blocks, "words": words, "link_density": link_words / max(words, 1), "page_date": page_date}


def page_text(page: dict) -> str:
    return "\n\n".join(value if kind != "bullet" else f"• {value}" for kind, value in page["blocks"])


def first_paragraph(page: dict) -> str:
    return next((value for kind, value in page["blocks"] if kind == "para" and len(value) >= 30), "")


def normalise_url(url: str) -> str:
    """One key per page: https, no www., no fragment, no tracking parameters, no trailing slash."""
    parsed = urlparse((url or "").strip())
    host = (parsed.hostname or "").lower().removeprefix("www.")
    query = urlencode([(k, v) for k, v in parse_qsl(parsed.query) if not k.lower().startswith(("utm_", "fbclid", "gclid"))])
    return urlunparse(("https", host, parsed.path.rstrip("/") or "/", "", query, ""))


def _url_variants(url: str) -> list[str]:
    parsed = urlparse(normalise_url(url))
    hosts = [parsed.hostname or "", f"www.{parsed.hostname}"]
    paths = [parsed.path, parsed.path + "/"]
    query = f"?{parsed.query}" if parsed.query else ""
    return [f"https://{host}{path}{query}" for host in hosts for path in paths]


def sketch(text: str, size: int = 128) -> list[int]:
    """Bottom-k fingerprint of the page's five-word phrases, for change and near-duplicate detection."""
    tokens = re.findall(r"[a-z0-9]+", (text or "").lower())
    phrases = {" ".join(tokens[i:i + 5]) for i in range(max(1, len(tokens) - 4))}
    return sorted({int(hashlib.blake2b(p.encode(), digest_size=7).hexdigest(), 16) for p in phrases})[:size]


def similarity(a: list[int], b: list[int]) -> float:
    if not a or not b:
        return 0.0
    size = min(len(a), len(b))
    union = sorted(set(a) | set(b))[:size]
    both = set(a) & set(b)
    return sum(1 for value in union if value in both) / len(union)


def address_checks(url: str, title: str) -> str | None:
    """The checks that need only the address and title — also re-applied to stored records on every run."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return "not_https"
    if kb_sources.source_for(url) is None:
        return "untrusted_source"
    if re.search(r"\.(?:pdf|docx?|xlsx?|pptx?|zip|mp4|mp3)(?:/|$)", parsed.path, re.I):
        return "document_file"
    segments = [segment for segment in parsed.path.lower().split("/") if segment]
    if (not segments or parsed.query or segments[-1] in _LISTING or _TAXONOMY & set(segments[:-1])
            or re.fullmatch(r"(?:page-?)?\d+", segments[-1]) or re.fullmatch(r"\d{4,6}", segments[-1])):
        return "listing_or_navigation_page"
    if not title:
        return "no_title"
    if _LISTING_TITLE.search(title) or scam_analysis._obviously_not_an_alert({"url": url, "title": title}):
        return "listing_or_navigation_page"
    return None


def automatic_checks(url: str, page: dict) -> str | None:
    """Why a page cannot become Apollo knowledge, or None when it passes every check."""
    reason = address_checks(url, page["title"])
    if reason:
        return reason
    if page["link_density"] > MAX_LINK_DENSITY:
        return "listing_or_navigation_page"
    if page["words"] < MIN_WORDS:
        return "too_little_content"
    tokens = re.findall(r"[a-z]+", page_text(page).lower())
    if sum(1 for token in tokens if token in _ENGLISH) / max(len(tokens), 1) < 0.12:
        return "not_english"
    return None


def topics(title: str, body: str) -> list[str]:
    head, start = title or "", (body or "")[:3000]
    scored = [(2 * len(pattern.findall(head)) + len(pattern.findall(start)), name) for name, pattern in _TOPICS.items()]
    return [name for score, name in sorted(scored, key=lambda item: -item[0]) if score > 0][:4]


def learn_category(found: list[str]) -> str:
    return next((category for topic, category in _CATEGORY if topic in found), "Everyday scams")


def _published(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(str(value))
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def _clean_title(title: str, source: kb_sources.KbSource) -> str:
    parts = re.split(r"\s+[|–—-]\s+", (title or "").strip())
    return parts[0].strip() if len(parts) > 1 and len(parts[0]) >= 8 else (title or "").strip()


def classify(source: kb_sources.KbSource, title: str, page: dict, published: datetime | None, intent: str) -> dict:
    """Scam alert or general knowledge, by the same fixed rules Scam Alerts use on the source's own words."""
    item = {"title": title, "summary": first_paragraph(page), "content_type": "live_alert" if intent == "alert" else "official_advice",
            "published_at": published, "_source_name": source.publisher, "_source_region": source.jurisdiction}
    analysis = scam_analysis.analyse(item, page_text(page))
    recent = bool(published and now_utc() - published <= ALERT_MAX_AGE)
    is_alert = source.tier == TIER_1 and intent == "alert" and recent and analysis["tier"] in ("specific_scam", "emerging_pattern")
    return {"category": "scam_alert" if is_alert else "knowledge", "analysis": analysis, "topics": topics(title, page_text(page))}


# ── Ingesting one page ─────────────────────────────────────────────────────────

def _kb_id(key: str) -> str:
    return hashlib.sha256(f"researched:{key}".encode()).hexdigest()[:32]


async def _reject(url: str, reason: str, run_id: str) -> str:
    await db.apollo_kb_rejections.insert_one({"url": url[:1500], "reason": reason, "run_id": run_id, "at": now_utc()})
    return f"rejected:{reason}"


async def _held_elsewhere(url: str) -> bool:
    """Already Apollo knowledge from a government feed, the shipped guidance or a curated Learn article."""
    variants = _url_variants(url)
    return bool(await db.learning_feed_items.find_one({"url": {"$in": variants}, "origin": {"$ne": "apollo_kb"}}, {"_id": 1})
                or await db.higgins_knowledge.find_one({"kind": "official_guidance", "url": {"$in": variants}}, {"_id": 1})
                or await db.learning_articles.find_one({"citations.url": {"$in": variants}, "source_type": {"$ne": "apollo_kb"},
                                                        "deleted_at": None}, {"_id": 1}))


async def _near_duplicate(fingerprint: list[int], key: str) -> dict | None:
    async for row in db.higgins_knowledge.find({"kind": "researched", "key": {"$ne": key}}, {"_id": 0, "kb_id": 1, "sketch": 1, "title": 1}):
        if similarity(row.get("sketch") or [], fingerprint) >= NEAR_DUPLICATE:
            return row
    return None


def _record(source: kb_sources.KbSource, url: str, key: str, title: str, page: dict, published: datetime | None,
            classified: dict, *, version: int, status: str, now: datetime) -> dict:
    body = page_text(page)
    return {
        "kb_id": _kb_id(key), "kind": "researched", "key": key, "title": title[:300], "body": body[:20000], "summary": first_paragraph(page)[:600],
        "publisher": source.publisher, "url": url, "route": None, "question": "", "licence": source.licence, "attribution": source.attribution,
        "category": classified["category"], "topics": classified["topics"], "authority_tier": source.tier, "jurisdiction": source.jurisdiction,
        "knowledge_class": "general_knowledge",
        "provenance": {"source_url": url, "publisher": source.publisher, "domain": source.domain, "authority_tier": source.tier,
                       "jurisdiction": source.jurisdiction, "licence": source.licence, "attribution": source.attribution,
                       "published_at": published, "retrieved_at": now, "last_checked_at": now, "retrieved_via": "tavily"},
        "status": status, "version": version, "sketch": sketch(body), "content_hash": hashlib.sha256(body.encode()).hexdigest(),
        "changed_at": now if status == "updated" else None, "failed_checks": 0, "updated_at": now,
    }


async def ingest(candidate: dict, run: dict) -> str:
    """One discovered or re-read page → added | updated | unchanged | duplicate | already_in_kb | rejected:<reason>."""
    url = candidate["url"]
    key = normalise_url(url)
    source = kb_sources.source_for(url)
    page = parse_page(candidate.get("rawContent") or "")
    if source and not page["title"]:
        page["title"] = _clean_title(candidate.get("title") or "", source)
    reason = automatic_checks(url, page)
    if reason:
        if candidate.get("intent") is None:  # a stored page re-read for maintenance
            run["made_historical"] = run.get("made_historical", 0) + int(await _failed_check(url))
        return await _reject(url, reason, run["run_id"])
    if await _held_elsewhere(url):
        return "already_in_kb"
    title, now = page["title"], now_utc()
    published = _published(candidate.get("publishedDate")) or page["page_date"]
    existing = await db.higgins_knowledge.find_one({"kind": "researched", "key": key}, {"_id": 0})
    if existing:
        published = published or _aware(existing.get("provenance", {}).get("published_at"))
        intent = candidate.get("intent") or ("alert" if existing.get("category") == "scam_alert" else "guidance")
        classified = classify(source, title, page, published, intent)
        if similarity(existing.get("sketch") or [], sketch(page_text(page))) >= SAME_PAGE and existing.get("title") == title:
            revived = {"status": "current", "historical_reason": None} if existing.get("status") == "historical" else {}
            await db.higgins_knowledge.update_one({"kb_id": existing["kb_id"]}, {"$set": {"provenance.last_checked_at": now, "failed_checks": 0, **revived}})
            return "unchanged"
        await db.apollo_kb_history.insert_one({
            "kb_id": existing["kb_id"], "key": key, "version": existing.get("version", 1), "status": "superseded", "superseded_at": now,
            "title": existing.get("title"), "body": existing.get("body"), "category": existing.get("category"),
            "provenance": existing.get("provenance"), "content_hash": existing.get("content_hash")})
        record = _record(source, url, key, title, page, published, classified, version=existing.get("version", 1) + 1, status="updated", now=now)
        await db.higgins_knowledge.update_one({"kb_id": existing["kb_id"]}, {"$set": record})
        await _publish({**existing, **record}, source, page, classified, run)
        return "updated"
    if await db.higgins_knowledge.find_one({"kind": "researched", "also_published_at.url": url}, {"_id": 1}):
        return "duplicate"
    fingerprint = sketch(page_text(page))
    twin = await _near_duplicate(fingerprint, key)
    if twin:
        await db.higgins_knowledge.update_one({"kb_id": twin["kb_id"]}, {"$addToSet": {"also_published_at": {"url": url, "publisher": source.publisher}}})
        return "duplicate"
    classified = classify(source, title, page, published, candidate.get("intent") or "guidance")
    record = _record(source, url, key, title, page, published, classified, version=1, status="current", now=now)
    await db.higgins_knowledge.update_one({"kb_id": record["kb_id"]}, {"$set": record,
                                          "$setOnInsert": {"created_at": now, "hits": 0, "also_published_at": []}}, upsert=True)
    await _publish(record, source, page, classified, run)
    return "added"


# ── Destinations: Scam Alerts and Learn with Higgins ───────────────────────────

async def _publish(record: dict, source: kb_sources.KbSource, page: dict, classified: dict, run: dict) -> None:
    if record["category"] == "scam_alert":
        await _publish_alert(record, source, page, classified["analysis"])
        run["alerts_published"] += 1
    elif source.republish:
        outcome = await _publish_learn(record, source, page)
        if outcome:
            run[f"learn_{outcome}"] += 1


async def _publish_alert(record: dict, source: kb_sources.KbSource, page: dict, analysis: dict) -> None:
    """A current official warning joins Scam Alerts, read and rated by the same rules as the government feeds."""
    fingerprint = hashlib.sha256(f"apollo-kb:{record['key']}".encode()).hexdigest()
    now = now_utc()
    item = {"candidate_id": fingerprint[:24], "fingerprint": fingerprint, "feed_id": ALERT_FEED_ID, "origin": "apollo_kb", "kb_id": record["kb_id"],
            "source_id": source.source_id, "title": record["title"], "summary": first_paragraph(page)[:1500], "url": record["url"],
            "published_at": record["provenance"]["published_at"], "status": "processed", "trust_status": "recognised_government",
            "content_type": "live_alert", "language": _LANGUAGE.get(source.jurisdiction, "en"), "review_queue_policy": "automatic_checks",
            "updated_at": now, "last_checked_at": now, "expires_at": now + timedelta(days=90), "scam_analysis": analysis}
    await db.learning_feed_items.update_one({"fingerprint": fingerprint}, {"$set": item, "$setOnInsert": {"created_at": now}}, upsert=True)
    await db.higgins_knowledge.update_one({"kb_id": record["kb_id"]}, {"$set": {"alert_fingerprint": fingerprint}})


def learn_article(record: dict, source: kb_sources.KbSource, page: dict) -> dict | None:
    """A Learn with Higgins article made of the source's own headings, paragraphs and bullet points."""
    summary = first_paragraph(page)
    sections: list[dict] = []
    current = {"heading": "Overview", "paragraphs": [], "bullets": []}
    for kind, value in page["blocks"]:
        if kind == "heading":
            if current["paragraphs"] or current["bullets"]:
                sections.append(current)
            current = {"heading": value[:160], "paragraphs": [], "bullets": []}
        elif kind == "bullet" and len(current["bullets"]) < 12:
            current["bullets"].append(value[:600])
        elif kind == "para" and value != summary and len(current["paragraphs"]) < 8:
            current["paragraphs"].append(value[:1200])
    if current["paragraphs"] or current["bullets"]:
        sections.append(current)
    checked = record["provenance"]["last_checked_at"].strftime("%-d %B %Y")
    sections = sections[:11] + [{"heading": "Source and licence", "bullets": [], "paragraphs": [
        f"This article reproduces guidance published by {source.publisher}. Read the original: {record['url']}",
        f"{source.attribution} Apollo last checked the original on {checked}."]}]
    found = record.get("topics") or []
    if len(sections) < 3 or not any(section["bullets"] for section in sections) or len(summary) < 30:
        return None
    return {"title": record["title"][:160], "summary": summary[:600], "category": learn_category(found), "topic": (found or ["scams"])[0],
            "audience": "general", "language": _LANGUAGE.get(source.jurisdiction, "en"), "contentType": "guide", "riskContext": learn_category(found),
            "tags": list(dict.fromkeys([*found, "official guidance", source.jurisdiction.lower()]))[:6], "sections": sections,
            "citations": [{"sourceId": source.source_id, "label": source.publisher, "url": record["url"]}],
            "sourceType": "apollo_kb", "evidenceQuality": "official_guidance"}


async def _publish_learn(record: dict, source: kb_sources.KbSource, page: dict) -> str | None:
    from services import learning
    raw = learn_article(record, source, page)
    if raw is None:
        return None
    known = set(await learning.sources_by_id())
    if not learning.quality_checks(raw, known)["passed"]:
        return None
    slug = record.get("learn_slug")
    if not slug:
        slug = learning._slug(record["title"][:90])
        clash = await db.learning_articles.find_one({"slug": slug}, {"_id": 0, "source_type": 1, "citations": 1})
        if clash and not (clash.get("source_type") == "apollo_kb" and any(c.get("url") == record["url"] for c in clash.get("citations") or [])):
            slug = f"{slug[:90]}-{record['kb_id'][:6]}"
    existing = await db.learning_articles.find_one({"slug": slug}, {"_id": 0, "status": 1, "deleted_at": 1})
    if existing and existing.get("deleted_at"):
        return None  # an admin archived it — Apollo never brings it back
    saved = await learning.upsert_article({**raw, "slug": slug}, "system:apollo_kb")
    path = ["draft", "in_review", "approved", "published"]
    for target in path[path.index(saved["status"]) + 1:] if saved["status"] in path else []:
        await learning.transition(slug, target, "system:apollo_kb")
    await db.higgins_knowledge.update_one({"kb_id": record["kb_id"]}, {"$set": {"learn_slug": slug}})
    return "updated" if existing else "published"


# ── Maintenance ────────────────────────────────────────────────────────────────

async def _failed_check(url: str) -> bool:
    """A page the source no longer serves. After repeated failures it becomes Historical — never deleted."""
    row = await db.higgins_knowledge.find_one_and_update({"kind": "researched", "key": normalise_url(url)},
                                                         {"$inc": {"failed_checks": 1}, "$set": {"provenance.last_checked_at": now_utc()}},
                                                         projection={"_id": 0, "kb_id": 1, "failed_checks": 1, "status": 1}, return_document=True)
    if row and row.get("failed_checks", 0) >= FAILED_CHECKS_BEFORE_HISTORICAL and row.get("status") != "historical":
        await db.higgins_knowledge.update_one({"kb_id": row["kb_id"]}, {"$set": {"status": "historical", "historical_at": now_utc(),
                                                                                "historical_reason": "source_page_unavailable"}})
        return True
    return False


async def revalidate(run: dict) -> int:
    """When the checks tighten, records that no longer pass leave the KB everywhere (their Learn article is archived,
    their Scam Alert withdrawn). They were never valid knowledge, so this is a correction, not lost history."""
    from services import learning
    removed = 0
    async for row in db.higgins_knowledge.find({"kind": "researched"}, {"_id": 0, "kb_id": 1, "url": 1, "title": 1, "learn_slug": 1, "alert_fingerprint": 1}):
        reason = address_checks(row["url"], row.get("title") or "")
        if not reason:
            continue
        if row.get("learn_slug"):
            try:
                await learning.transition(row["learn_slug"], "archived", "system:apollo_kb")
            except (LookupError, ValueError):
                pass
        if row.get("alert_fingerprint"):
            await db.learning_feed_items.delete_one({"fingerprint": row["alert_fingerprint"], "origin": "apollo_kb"})
        await db.higgins_knowledge.delete_one({"kb_id": row["kb_id"]})
        await _reject(row["url"], reason, run["run_id"])
        removed += 1
    return removed


async def _age_records() -> int:
    now = now_utc()
    await db.higgins_knowledge.update_many({"kind": "researched", "status": "updated", "changed_at": {"$lte": now - UPDATED_FOR}}, {"$set": {"status": "current"}})
    result = await db.higgins_knowledge.update_many(
        {"kind": "researched", "category": "scam_alert", "status": {"$ne": "historical"}, "provenance.published_at": {"$lte": now - ALERT_HISTORICAL_AFTER}},
        {"$set": {"status": "historical", "historical_at": now, "historical_reason": "older_than_two_years"}})
    return result.modified_count


# ── Runs ───────────────────────────────────────────────────────────────────────

async def ensure_indexes() -> None:
    await db.higgins_knowledge.create_index([("kind", 1), ("key", 1)])
    await db.higgins_knowledge.create_index("also_published_at.url")
    await db.higgins_knowledge.create_index([("kind", 1), ("provenance.last_checked_at", 1)])
    await db.apollo_kb_history.create_index([("kb_id", 1), ("version", 1)], unique=True)
    await db.apollo_kb_runs.create_index([("started_at", -1)])
    await db.apollo_kb_rejections.create_index("at", expireAfterSeconds=90 * 86400)
    from services import learning
    await learning.import_package({"sources": kb_sources.learning_source_docs()}, "system:apollo_kb")


async def _acquire() -> bool:
    now = now_utc()
    try:
        await db.apollo_kb_state.find_one_and_update({"_id": "lock", "$or": [{"held_until": None}, {"held_until": {"$lte": now}}]},
                                                     {"$set": {"held_until": now + LOCK_FOR}}, upsert=True)
        return True
    except DuplicateKeyError:
        return False


async def _release() -> None:
    await db.apollo_kb_state.update_one({"_id": "lock"}, {"$set": {"held_until": None}})


async def due() -> bool:
    """Weekly: due when the last successful run is a week old, and no attempt was made in the last day."""
    now = now_utc()
    last = await db.apollo_kb_runs.find_one({}, {"_id": 0, "started_at": 1}, sort=[("started_at", -1)])
    good = await db.apollo_kb_runs.find_one({"status": {"$in": ["success", "partial"]}}, {"_id": 0, "started_at": 1}, sort=[("started_at", -1)])
    return (not last or _aware(last["started_at"]) <= now - RETRY_AFTER) and (not good or _aware(good["started_at"]) <= now - RUN_EVERY)


async def _search(run: dict, query: str, **kwargs) -> list[dict]:
    run["searches"] += 1
    try:
        return await tavily_client.search(query, **kwargs)
    except tavily_client.TavilyUnavailable as exc:
        if str(exc) in ("not_configured", "http_401", "http_403", "http_432"):
            raise
        run["search_errors"] += 1
        return []


async def run(trigger: str = "scheduled") -> dict:
    """Discover new trusted material, re-read what Apollo already holds, and store both with provenance."""
    if not await _acquire():
        return {"status": "already_running"}
    started = now_utc()
    record = {"run_id": secrets.token_hex(8), "trigger": trigger, "started_at": started, "status": "running", "searches": 0, "search_errors": 0,
              "rechecked": 0, "counts": {}, "rejections": {}, "alerts_published": 0, "learn_published": 0, "learn_updated": 0,
              "made_historical": 0, "revalidated_out": 0, "error": None}
    await db.apollo_kb_runs.insert_one(dict(record))
    try:
        if not tavily_client.configured():
            raise tavily_client.TavilyUnavailable("not_configured")
        record["revalidated_out"] = await revalidate(record)
        first_run = not await db.higgins_knowledge.find_one({"kind": "researched"}, {"_id": 1})
        candidates: dict[str, dict] = {}
        for query in GUIDANCE_TOPICS:
            for tier, limit in TIER_RESULTS.items():
                for result in await _search(record, query, domains=kb_sources.domains(tier), max_results=limit):
                    candidates.setdefault(normalise_url(result["url"]), {**result, "intent": "guidance"})
        for query in ALERT_TOPICS:
            for result in await _search(record, query, domains=kb_sources.domains(TIER_1), topic="news",
                                        time_range="month" if first_run else "week"):
                candidates[normalise_url(result["url"])] = {**result, "intent": "alert"}
        due_rows = await db.higgins_knowledge.find(
            {"kind": "researched", "status": {"$ne": "historical"}, "provenance.last_checked_at": {"$lte": started - RECHECK_AFTER}},
            {"_id": 0, "url": 1, "key": 1, "title": 1}).sort("provenance.last_checked_at", 1).limit(MAX_RECHECKS).to_list(MAX_RECHECKS)
        titles = {row["key"]: row["title"] for row in due_rows}
        recheck = [row["url"] for row in due_rows if row["key"] not in candidates]
        for start in range(0, len(recheck), 20):
            read, failed = await tavily_client.extract(recheck[start:start + 20])
            record["rechecked"] += len(read) + len(failed)
            for item in read:
                candidates.setdefault(normalise_url(item["url"]), {**item, "title": titles.get(normalise_url(item["url"]), ""), "intent": None})
            for url in failed:
                record["made_historical"] += int(await _failed_check(url))
        for candidate in candidates.values():
            try:
                outcome = await ingest(candidate, record)
            except Exception as exc:  # noqa: BLE001 — one bad page never stops the run
                log.warning("kb_ingest_failed url=%s type=%s", candidate.get("url", "")[:120], type(exc).__name__)
                outcome = "failed"
            if outcome.startswith("rejected:"):
                reason = outcome.split(":", 1)[1]
                record["rejections"][reason] = record["rejections"].get(reason, 0) + 1
                outcome = "rejected"
            record["counts"][outcome] = record["counts"].get(outcome, 0) + 1
        record["made_historical"] += await _age_records()
        record["status"] = "partial" if record["search_errors"] else "success"
        from services.higgins import knowledge
        await knowledge.refresh()
    except tavily_client.TavilyUnavailable as exc:
        record["status"], record["error"] = "failed", f"tavily_{exc}"
    except Exception as exc:  # noqa: BLE001 — recorded for the admin console; the next run tries again
        record["status"], record["error"] = "failed", type(exc).__name__
        log.exception("kb_run_failed")
    finally:
        record["finished_at"] = now_utc()
        await db.apollo_kb_runs.update_one({"run_id": record["run_id"]}, {"$set": record})
        await _release()
    log.info("kb_run %s", {k: record[k] for k in ("trigger", "status", "searches", "counts", "alerts_published", "learn_published")})
    return {k: v for k, v in record.items() if k != "_id"}


async def status() -> dict:
    """What the admin console shows: the KB by kind, status, tier and category, recent runs and rejections."""
    breakdown = await db.higgins_knowledge.aggregate([
        {"$group": {"_id": {"kind": "$kind", "status": {"$ifNull": ["$status", "current"]}, "tier": "$authority_tier", "category": "$category"},
                    "entries": {"$sum": 1}, "hits": {"$sum": "$hits"}}}, {"$sort": {"entries": -1}}]).to_list(200)
    runs = await db.apollo_kb_runs.find({}, {"_id": 0}).sort("started_at", -1).limit(8).to_list(8)
    rejections = await db.apollo_kb_rejections.find({}, {"_id": 0}).sort("at", -1).limit(25).to_list(25)
    last_good = next((r for r in runs if r.get("status") in ("success", "partial")), None)
    usage = await db.trusted_search_usage.count_documents({"purpose": "apollo_kb", "timestamp": {"$gte": now_utc() - timedelta(days=30)}})
    return {"configured": tavily_client.configured(), "breakdown": [{**row["_id"], "entries": row["entries"], "hits": row["hits"]} for row in breakdown],
            "history": await db.apollo_kb_history.count_documents({}), "runs": runs, "rejections": rejections,
            "nextRunAt": (_aware(last_good["started_at"]) + RUN_EVERY) if last_good else None, "tavilyCalls30d": usage}
