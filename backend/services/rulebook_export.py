"""Downloads of the whole rule book for the admin portal: JSON (every section, word for word) and a PDF laid out like
the page (one rule per line, tables as tables). Both are made from content/rulebook.md at the moment of download."""
from __future__ import annotations

import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.fonts import addMapping
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import HRFlowable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from services import rulebook

FONTS = Path(__file__).resolve().parent.parent / "content" / "fonts"
_SECTION = re.compile(r"^##\s+(.*?)(?:\s*\{#([\w-]+)\})?\s*$")
_GROUP_SECTION = re.compile(r"^###\s+(.*?)(?:\s*\{#([\w-]+)\})?\s*$")
_HEADING = re.compile(r"^(#{1,4})\s+(.*?)(?:\s*\{#[\w-]+\})?\s*$")
_ITEM = re.compile(r"^(\s*)([-*]|\d+\.)\s+(.*)$")
_TABLE_DIVIDER = re.compile(r"^\s*\|[\s|:-]+\|\s*$")


def split_sections(text: str) -> tuple[str, list[dict]]:
    """The intro, then one entry per `## ` section: its id (the {#id} anchor, or one made from the title), title and body."""
    intro, *parts = text.split("\n## ")
    sections = []
    for part in parts:
        heading, _, body = part.partition("\n")
        match = _SECTION.match(f"## {heading}")
        title, anchor = (match.group(1), match.group(2)) if match else (heading, None)
        anchor = anchor or re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        sections.append({"id": anchor, "title": title, "markdown": re.sub(r"\n-{3,}\s*$", "", body.rstrip()).strip("\n")})
    return intro.rstrip(), sections


def split_groups(text: str) -> tuple[str, list[dict]]:
    """The rule book's parts: the intro, then one entry per `## ` part (Protection Gates, Investigation process…) with
    its lead text and one entry per `### ` section under it (id, title and body, word for word)."""
    intro, parts = split_sections(text)
    groups = []
    for part in parts:
        lead, *bodies = ("\n" + part["markdown"]).split("\n### ")
        sections = []
        for body in bodies:
            heading, _, rest = body.partition("\n")
            match = _GROUP_SECTION.match(f"### {heading}")
            title, anchor = (match.group(1), match.group(2)) if match else (heading, None)
            anchor = anchor or re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
            sections.append({"id": anchor, "title": title, "markdown": rest.strip("\n")})
        groups.append({"id": part["id"], "title": part["title"], "intro": lead.strip("\n"), "sections": sections})
    return intro, groups


def filename(kind: str) -> str:
    return f"apollosg-rule-book-{rulebook.read()['reviewedAt'] or 'current'}.{kind}"


# ── JSON ────────────────────────────────────────────────────────────────────

def as_json() -> bytes:
    book = rulebook.read()
    intro, groups = split_groups(book["markdown"])
    title, _, intro_body = intro.partition("\n")
    behind = rulebook.changed()
    payload = {
        "title": re.sub(r"^#\s+", "", title).strip(),
        "lastReviewed": book["reviewedAt"],
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "inStepWithCode": not behind,
        "changedSinceReview": behind,
        "source": "backend/content/rulebook.md",
        "intro": intro_body.strip("\n"),
        "groups": groups,
        "markdown": book["markdown"],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


# ── PDF ─────────────────────────────────────────────────────────────────────

def _register_fonts() -> None:
    # Bundled Liberation fonts: they carry the book's arrows (→ ↔) that the built-in PDF fonts lack, and they ship
    # with the code, so the PDF looks the same on every server.
    if "ApolloSans" in pdfmetrics.getRegisteredFontNames():
        return
    for name, file in (("ApolloSans", "LiberationSans-Regular.ttf"), ("ApolloSans-Bold", "LiberationSans-Bold.ttf"),
                       ("ApolloSans-Italic", "LiberationSans-Italic.ttf"), ("ApolloSans-BoldItalic", "LiberationSans-BoldItalic.ttf"),
                       ("ApolloMono", "LiberationMono-Regular.ttf")):
        pdfmetrics.registerFont(TTFont(name, str(FONTS / file)))
    for bold, italic, name in ((0, 0, "ApolloSans"), (1, 0, "ApolloSans-Bold"), (0, 1, "ApolloSans-Italic"), (1, 1, "ApolloSans-BoldItalic")):
        addMapping("ApolloSans", bold, italic, name)


def _inline(text: str) -> str:
    """Markdown emphasis to ReportLab's paragraph markup, escaping everything else."""
    codes: list[str] = []

    def keep(match: re.Match) -> str:
        codes.append(f'<font face="ApolloMono">{escape(match.group(1))}</font>')
        return f"\x00{len(codes) - 1}\x00"

    out = escape(re.sub(r"`([^`]+)`", keep, text))
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", out)
    out = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", out)
    out = re.sub(r"(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)", r"<i>\1</i>", out)
    return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m.group(1))], out)


def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().removeprefix("|").removesuffix("|").split("|")]


def blocks(text: str) -> list[tuple]:
    """The same reading as the app's (frontend/src/domain/ruleBook.ts): headings, paragraphs, lists (one item per
    line, nested by indent), tables and rules."""
    lines = re.sub(r"<!--[\s\S]*?-->", "", text).replace("\r\n", "\n").split("\n")
    out: list[tuple] = []
    paragraph: list[str] = []
    items: list[list] = []

    def flush() -> None:
        if paragraph:
            out.append(("paragraph", " ".join(paragraph)))
        if items:
            out.append(("list", [tuple(item) for item in items]))
        paragraph.clear(); items.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            flush(); i += 1; continue
        if heading := _HEADING.match(line):
            flush(); out.append(("heading", len(heading.group(1)), heading.group(2))); i += 1; continue
        if re.match(r"^\s*-{3,}\s*$", line):
            flush(); out.append(("rule",)); i += 1; continue
        if line.strip().startswith("|"):
            flush(); rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                if not _TABLE_DIVIDER.match(lines[i]):
                    rows.append(_cells(lines[i]))
                i += 1
            out.append(("table", rows)); continue
        if item := _ITEM.match(line):
            if paragraph:
                flush()
            marker = item.group(2) if item.group(2)[0].isdigit() else "•"
            items.append([min(2, round(len(item.group(1)) / 3)), marker, item.group(3)]); i += 1; continue
        if items and re.match(r"^\s+\S", line):
            items[-1][2] += " " + line.strip(); i += 1; continue
        if items:
            flush()
        paragraph.append(line.strip()); i += 1
    flush()
    return out


def as_pdf() -> bytes:
    _register_fonts()
    book = rulebook.read()
    base = ParagraphStyle("body", fontName="ApolloSans", fontSize=9.5, leading=13.5, textColor=colors.HexColor("#1F2933"), spaceAfter=4)
    styles = {
        1: ParagraphStyle("h1", parent=base, fontName="ApolloSans-Bold", fontSize=20, leading=25, spaceAfter=8),
        # A part of the book (Protection Gates…), a section under it (Link Gate…), then a section's own sub-heading.
        2: ParagraphStyle("h2", parent=base, fontName="ApolloSans-Bold", fontSize=17, leading=22, spaceAfter=8, keepWithNext=1),
        3: ParagraphStyle("h3", parent=base, fontName="ApolloSans-Bold", fontSize=13.5, leading=17, spaceBefore=14, spaceAfter=6, keepWithNext=1),
        4: ParagraphStyle("h4", parent=base, fontName="ApolloSans-Bold", fontSize=11.5, leading=15, spaceBefore=8, spaceAfter=4, keepWithNext=1),
    }
    cell = ParagraphStyle("cell", parent=base, fontSize=8.5, leading=11.5, spaceAfter=0)
    head = ParagraphStyle("head", parent=cell, fontName="ApolloSans-Bold")
    buffer = io.BytesIO()
    page = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                             title="ApolloSG rule book", author="ApolloSG")
    width = page.width
    story: list = []
    for block in blocks(book["markdown"]):
        kind = block[0]
        if kind == "heading":
            if block[1] == 2:
                # Each part starts on a new page; the "---" before it would only end the previous page.
                if story and isinstance(story[-1], HRFlowable):
                    story.pop()
                story.append(PageBreak())
            story.append(Paragraph(_inline(block[2]), styles[block[1]]))
        elif kind == "paragraph":
            story.append(Paragraph(_inline(block[1]), base))
        elif kind == "rule":
            story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#D5DAE1"), spaceBefore=6, spaceAfter=8))
        elif kind == "list":
            for depth, marker, text in block[1]:
                indent = 14 + depth * 14
                style = ParagraphStyle(f"item{depth}", parent=base, leftIndent=indent, bulletIndent=indent - 12, bulletFontName="ApolloSans", spaceAfter=2.5)
                story.append(Paragraph(_inline(text), style, bulletText=marker))
            story.append(Spacer(1, 3))
        elif kind == "table" and block[1]:
            rows = block[1]
            columns = max(len(row) for row in rows)
            data = [[Paragraph(_inline(row[c]) if c < len(row) else "", head if r == 0 else cell) for c in range(columns)] for r, row in enumerate(rows)]
            first = 0.32 if columns <= 2 else 0.24
            widths = [width * first] + [width * (1 - first) / (columns - 1)] * (columns - 1) if columns > 1 else [width]
            table = Table(data, colWidths=widths, repeatRows=1)
            table.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D5DAE1")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF1F5")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]))
            story += [table, Spacer(1, 6)]

    footer = f"ApolloSG rule book · last reviewed {book['reviewedAt'] or 'not recorded'}"

    def decorate(canvas, document) -> None:
        canvas.saveState()
        canvas.setFont("ApolloSans", 7.5)
        canvas.setFillColor(colors.HexColor("#6B7785"))
        canvas.drawString(18 * mm, 10 * mm, footer)
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {document.page}")
        canvas.restoreState()

    page.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return buffer.getvalue()
