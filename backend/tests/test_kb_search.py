"""Apollo KB search (services/higgins/knowledge.py): a question in the person's words meets an entry in the source's
words, with no AI. Concepts, everyday words, chatter, rarity weights, the generic-only rule, history and the
boundary with Gemini's saved answers.

Run: cd /app/backend && python -m pytest tests/test_kb_search.py -q
"""
import uuid

import pytest

from core.db import db
from services.higgins import knowledge as kb


def test_the_question_and_the_source_meet_on_the_same_concepts():
    assert kb.concepts("Why do scammers ask to be paid in bitcoin?", query=True) == ["scam", "pay", "crypto"]
    assert kb.concepts("Gift card and cryptocurrency demands") == ["gift", "card", "crypto", "demand"]
    assert kb.concepts("a stranger rang me", query=True) == ["call"]
    assert kb.concepts("I've been scammed") == kb.concepts("scams") == ["scam"]
    assert kb.concepts("Is public Wi-Fi safe?", query=True) == ["public", "wifi"]
    assert kb.concepts("A pop-up says my phone is infected", query=True) == ["warn", "phon", "malware"]
    assert kb.concepts("Should I give someone my one-time code?", query=True) == ["onetim", "code"]
    assert "qr" in kb.concepts("Scan a QR code") and "ai" in kb.concepts("cloned with AI")


def test_framing_words_and_australia_never_decide_a_match():
    assert kb.concepts("Where can I report a scam in Australia? Is it real?", query=True) == ["report", "scam"]
    assert kb.concepts("Australian scams") == ["australian", "scam"], "an entry keeps every word; only the question drops chatter"


def test_search_words_ask_the_index_for_every_everyday_word():
    words = kb.search_words("How do dating scams work?").split()
    assert {"dating", "romance", "boyfriend", "scammer"} <= set(words)


@pytest.fixture
async def library():
    coll = db[f"test_kb_search_{uuid.uuid4().hex[:8]}"]
    await coll.create_index([("title", "text"), ("question", "text"), ("body", "text")], weights={"title": 6, "question": 8, "body": 1},
                            name="kb_text", default_language="english")
    entries = [
        ("learn_article", "gift-card-crypto", "Gift card and cryptocurrency demands",
         "Scammers ask for gift cards or cryptocurrency because the payment is hard to trace and can't be reversed. No real bank, "
         "government agency or business asks to be paid this way."),
        ("learn_article", "recognising-phone-scams", "Recognising phone scams and what to do",
         "Hang up on a caller who pressures you. Call the organisation back on a number you find yourself."),
        ("learn_article", "public-wifi", "Using public Wi-Fi more safely",
         "Public Wi-Fi in cafes and airports can be watched. Avoid online banking on it or use your mobile data."),
        ("learn_article", "report-scam", "Where to report a scam", "Report the scam to Scamwatch and to your bank."),
        ("researched", "what-is-a-scam", "What is a scam?", "A scam tricks you into paying money by phone, text, email or online."),
        ("researched", "romance-old", "Romance scams", "Someone you met on a dating site asks for money.", ),
        ("learn_article", "romance-payment", "Romance and friendship payment requests",
         "A romance scammer you met online or on a dating app asks for money for a flight, a hospital bill or customs."),
    ]
    for kind, key, title, body in entries:
        await coll.insert_one({"kind": kind, "key": key, "kb_id": f"{kind}:{key}", "title": title, "body": body, "question": "",
                               "status": "historical" if key == "romance-old" else "current", "hits": 0})
    await coll.insert_one({"kind": "gemini_answer", "key": "g", "kb_id": "gemini_answer:g", "title": "Why do scammers want gift cards?",
                           "question": "Why do scammers want gift cards?", "body": "Gemini wrote this.", "status": "current", "hits": 0})
    kb.forget_weights()
    yield coll
    await coll.drop()
    kb.forget_weights()


async def found(coll, question: str) -> list[str]:
    return [e["key"] for e in await kb.search(question, limit=3, collection=coll)]


async def test_a_question_in_everyday_words_finds_the_article(library):
    assert (await found(library, "Why do scammers ask to be paid in bitcoin?"))[0] == "gift-card-crypto"
    assert (await found(library, "they want itunes cards"))[0] == "gift-card-crypto"
    assert (await found(library, "Is airport wifi ok for banking?"))[0] == "public-wifi"
    assert (await found(library, "Where can I report a scam in Australia?"))[0] == "report-scam"


async def test_how_something_arrived_alone_is_not_a_match(library):
    assert await found(library, "How do I change my phone's ringtone?") == [], "only 'phone' matched: not on the subject"
    assert await found(library, "What's a good recipe for banana bread?") == []


async def test_a_title_that_names_nothing_in_particular_ranks_below_one_that_does(library):
    keys = await found(library, "Can someone take money from me with a dating scam?")
    assert keys and keys[0] == "romance-payment" and "what-is-a-scam" not in keys[:1]


async def test_historical_entries_rank_below_current_ones(library):
    keys = await found(library, "romance scam asking for money")
    assert keys.index("romance-payment") < keys.index("romance-old")


async def test_geminis_saved_answers_are_never_returned_as_kb_knowledge(library):
    assert all(e["kind"] != "gemini_answer" for e in await kb.search("Why do scammers want gift cards?", limit=3, collection=library))
    n, held = await kb._weights(library)
    assert n == 7, "Gemini's answers don't count towards how rare a word is either"


async def test_rarity_is_counted_over_the_whole_library_and_kept_an_hour(library):
    n, held = await kb._weights(library)
    assert held["scam"] > held["crypto"] and n == 7
    await library.insert_one({"kind": "learn_article", "key": "new", "kb_id": "learn_article:new", "title": "Crypto", "body": "crypto", "status": "current"})
    assert (await kb._weights(library))[0] == 7, "kept"
    kb.forget_weights()
    assert (await kb._weights(library))[0] == 8, "recounted after a refresh"


def test_an_entry_must_hold_enough_of_the_question_and_share_its_title():
    weights = (10, {"crypto": 1, "gift": 1, "scam": 8, "pay": 6, "toll": 1})
    entry = {"title": "Gift card and cryptocurrency demands", "body": "Scammers ask for gift cards or cryptocurrency.", "status": "current"}
    assert kb._accepts(entry, ["scam", "pay", "crypto"], weights) > kb.MIN_SCORE
    assert kb._accepts(entry, ["toll", "pay"], weights) == 0.0, "nothing in its title"
    assert kb._accepts({**entry, "status": "historical"}, ["scam", "crypto"], weights) == kb._accepts(entry, ["scam", "crypto"], weights), \
        "being historical changes where an entry ranks, not whether it answers"


def test_rank_puts_current_before_historical_and_named_titles_before_vague_ones():
    current_vague = kb._rank({"title": "What is a scam?", "status": "current", "score": 9}, 0.9)
    current_named = kb._rank({"title": "Romance and friendship payment requests", "status": "current", "score": 1}, 0.4)
    historical_named = kb._rank({"title": "Romance scams", "status": "historical", "score": 9}, 0.99)
    assert current_named > current_vague > historical_named
