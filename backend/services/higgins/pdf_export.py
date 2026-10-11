"""Apollo Investigation Report — PDF Export Generator

Produces a professionally branded PDF from a Magnum DI investigation and Higgins briefing.

Apollo colour palette:
- Deep Sentinel Navy: #0B1220 (headings, structure)
- Brand Navy: #162235 (accents)
- Brand Gold: #C9A34A (highlights)
- Protected Green: #4FAF83 (success states)
- Warning Amber: #D4780A
- Threat Red: #D9534F
- Surface: #F5F7FA, #FFFFFF
- Text: #0B1220, #52606D

The generated PDF includes:
- Apollo-branded header with logo
- Investigation summary (subject, dates, assessment)
- Magnum DI findings and assessment
- Higgins evidence-specific explanations
- Evidentiary Chain metadata (display IDs, integrity hashes, provenance, transformations)
- Source references and verification dates
- Retention notice and privacy information
"""
from __future__ import annotations

import io
import os
import re
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from reportlab.lib import colors as rl_colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm, inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Image as RLImage, HRFlowable, PageBreak, KeepTogether,
)
from reportlab.platypus.flowables import Flowable

# ── Apollo brand colours ──
NAVY_DEEP = rl_colors.HexColor("#0B1220")
NAVY_BRAND = rl_colors.HexColor("#162235")
GOLD = rl_colors.HexColor("#C9A34A")
GOLD_LIGHT = rl_colors.HexColor("#E2C06B")
GREEN = rl_colors.HexColor("#4FAF83")
AMBER = rl_colors.HexColor("#D4780A")
RED = rl_colors.HexColor("#D9534F")
GREY_TEXT = rl_colors.HexColor("#52606D")
GREY_LIGHT = rl_colors.HexColor("#D7E0EA")
SURFACE = rl_colors.HexColor("#F5F7FA")
WHITE = rl_colors.HexColor("#FFFFFF")

LOGO_PATH = Path(__file__).parent.parent.parent / "logo" / "apollo_logo.png"
# Fallback: look in the frontend assets
FRONTEND_LOGO = Path("/app/frontend/assets/images/logo.png")

ASSESSMENT_COLOURS = {
    "critical": RED, "high": RED, "elevated": AMBER,
    "moderate": AMBER, "low": GREEN, "informational": GREY_TEXT,
}


def _get_logo_path() -> Optional[str]:
    for p in [LOGO_PATH, FRONTEND_LOGO]:
        if p.exists():
            return str(p)
    return None


def _clean_markdown(text: str) -> str:
    """Convert lightweight markdown to reportlab XML-ish markup."""
    if not text:
        return ""
    # Bold
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'__(.+?)__', r'<b>\1</b>', text)
    # Italic
    text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
    text = re.sub(r'_(.+?)_', r'<i>\1</i>', text)
    # Code
    text = re.sub(r'`(.+?)`', r'<font face="Courier" size="9">\1</font>', text)
    # Strip markdown headers (##, ###) — we handle sections separately
    text = re.sub(r'^#{1,4}\s+', '', text, flags=re.MULTILINE)
    # Convert bullet points
    text = re.sub(r'^\s*[-•]\s+', '• ', text, flags=re.MULTILINE)
    return text


def _styles() -> dict[str, ParagraphStyle]:
    """Build Apollo-branded paragraph styles."""
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("ApolloTitle", parent=base["Heading1"], fontSize=22, textColor=NAVY_DEEP,
                                 spaceAfter=4, alignment=TA_LEFT, leading=28),
        "subtitle": ParagraphStyle("ApolloSubtitle", parent=base["Normal"], fontSize=11, textColor=GREY_TEXT,
                                    spaceAfter=12, leading=15),
        "h2": ParagraphStyle("ApolloH2", parent=base["Heading2"], fontSize=14, textColor=NAVY_DEEP,
                              spaceBefore=16, spaceAfter=8, leading=18, borderPadding=(0, 0, 2, 0)),
        "h3": ParagraphStyle("ApolloH3", parent=base["Heading3"], fontSize=12, textColor=NAVY_BRAND,
                              spaceBefore=10, spaceAfter=6, leading=16),
        "body": ParagraphStyle("ApolloBody", parent=base["Normal"], fontSize=10, textColor=NAVY_DEEP,
                                spaceAfter=6, leading=14, alignment=TA_JUSTIFY),
        "body_grey": ParagraphStyle("ApolloBodyGrey", parent=base["Normal"], fontSize=9, textColor=GREY_TEXT,
                                     spaceAfter=4, leading=13),
        "evidence_id": ParagraphStyle("EvidenceId", parent=base["Normal"], fontSize=10, textColor=GOLD,
                                       spaceBefore=4, spaceAfter=2, leading=14),
        "meta": ParagraphStyle("ApolloMeta", parent=base["Normal"], fontSize=8, textColor=GREY_TEXT,
                                spaceAfter=2, leading=11),
        "footer": ParagraphStyle("ApolloFooter", parent=base["Normal"], fontSize=7, textColor=GREY_TEXT,
                                  alignment=TA_CENTER, leading=10),
        "badge": ParagraphStyle("ApolloBadge", parent=base["Normal"], fontSize=10, textColor=WHITE,
                                 alignment=TA_CENTER, leading=14),
        "retention": ParagraphStyle("Retention", parent=base["Normal"], fontSize=8, textColor=GREY_TEXT,
                                     spaceBefore=8, spaceAfter=4, leading=11, alignment=TA_LEFT),
    }


class GoldBar(Flowable):
    """A thin gold accent bar."""
    def __init__(self, width, height=1.5):
        super().__init__()
        self.width = width
        self.height = height

    def draw(self):
        self.canv.setFillColor(GOLD)
        self.canv.rect(0, 0, self.width, self.height, fill=1, stroke=0)

    def wrap(self, *args):
        return self.width, self.height + 2


def generate_pdf(
    case: dict,
    evidence_items: list[dict],
    *,
    subject: str = "",
    generated_at: Optional[datetime] = None,
) -> bytes:
    """Generate a branded Apollo investigation PDF.

    Args:
        case: The InvestigationCase wire dict (from case_view().wire())
        evidence_items: List of EvidenceItem wire dicts
        subject: Investigation subject name/description
        generated_at: PDF generation timestamp

    Returns:
        PDF bytes ready for streaming/download.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=15 * mm, bottomMargin=20 * mm,
                            title=f"Apollo Investigation — {subject or 'Report'}",
                            author="Apollo Scam Guard")
    s = _styles()
    story: list[Any] = []
    now = generated_at or datetime.utcnow()
    response = case.get("response") or {}
    page_width = A4[0] - 40 * mm

    # ── Header: Logo + Title ──
    logo_path = _get_logo_path()
    header_items = []
    if logo_path:
        try:
            header_items.append(RLImage(logo_path, width=36, height=36))
        except Exception:
            pass
    header_items.append(Paragraph("APOLLO SCAM GUARD", ParagraphStyle("LogoText", fontSize=9, textColor=GOLD,
                                                                        spaceAfter=0, leading=12, fontName="Helvetica-Bold")))
    # Simple header
    for item in header_items:
        story.append(item)
    story.append(Spacer(1, 4))
    story.append(GoldBar(page_width))
    story.append(Spacer(1, 10))

    # ── Investigation Title ──
    title = response.get("subject") or subject or "Investigation Report"
    story.append(Paragraph(f"Investigation Report: {_clean_markdown(title)}", s["title"]))

    # Subtitle with dates
    case_id = case.get("id", "—")
    created = case.get("createdAt", "")[:19].replace("T", " ")
    assessment = response.get("assessment", "unknown")
    story.append(Paragraph(f"Case {case_id[:12]}… · {created} · Assessment: <b>{assessment.upper()}</b>", s["subtitle"]))

    # Assessment badge
    badge_color = ASSESSMENT_COLOURS.get(assessment.lower(), GREY_TEXT)
    badge_table = Table([[Paragraph(f"<b>{assessment.upper()}</b>", s["badge"])]], colWidths=[80])
    badge_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), badge_color),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))
    story.append(badge_table)
    story.append(Spacer(1, 12))

    # ── Overview ──
    overview = response.get("overview", "")
    if overview:
        story.append(Paragraph("Investigation Summary", s["h2"]))
        story.append(HRFlowable(width="100%", color=GREY_LIGHT, thickness=0.5))
        for para in overview.split("\n\n"):
            if para.strip():
                story.append(Paragraph(_clean_markdown(para.strip()), s["body"]))
        story.append(Spacer(1, 6))

    # ── Higgins Explanation (Markdown) ──
    explanation = response.get("explanationMarkdown", "")
    if explanation:
        story.append(Paragraph("Higgins — Evidence-Based Explanation", s["h2"]))
        story.append(HRFlowable(width="100%", color=GOLD, thickness=1))
        story.append(Spacer(1, 4))
        sections = explanation.split("\n\n")
        for section in sections:
            section = section.strip()
            if not section:
                continue
            if section.startswith("## "):
                story.append(Paragraph(_clean_markdown(section[3:]), s["h3"]))
            elif section.startswith("### "):
                story.append(Paragraph(_clean_markdown(section[4:]), s["h3"]))
            else:
                story.append(Paragraph(_clean_markdown(section), s["body"]))
        story.append(Spacer(1, 8))

    # ── Findings ──
    findings = response.get("findings", [])
    if findings:
        story.append(Paragraph("Magnum DI — Investigation Findings", s["h2"]))
        story.append(HRFlowable(width="100%", color=NAVY_BRAND, thickness=1))
        story.append(Spacer(1, 4))
        for i, f in enumerate(findings, 1):
            label = f.get("label", f"Finding {i}")
            detail = f.get("detail", "")
            severity = f.get("severity", "")
            evidence_refs = f.get("evidenceIds", [])

            finding_parts = []
            finding_parts.append(Paragraph(f"<b>{i}. {_clean_markdown(label)}</b>"
                                           + (f' <font color="#{GREY_TEXT.hexval()[2:]}" size="9">[{severity}]</font>' if severity else ""),
                                           s["body"]))
            if detail:
                finding_parts.append(Paragraph(_clean_markdown(detail), s["body_grey"]))
            if evidence_refs:
                refs = ", ".join(str(r) for r in evidence_refs)
                finding_parts.append(Paragraph(f'<font color="#{GOLD.hexval()[2:]}" size="8">Evidence: {refs}</font>', s["meta"]))
            story.append(KeepTogether(finding_parts))
            story.append(Spacer(1, 4))

    # ── Uncertainties ──
    uncertainties = response.get("uncertainties", [])
    if uncertainties:
        story.append(Paragraph("Material Uncertainties", s["h3"]))
        for u in uncertainties:
            text = u if isinstance(u, str) else (u.get("description", "") if isinstance(u, dict) else str(u))
            if text:
                story.append(Paragraph(f"• {_clean_markdown(text)}", s["body_grey"]))

    # ── Recommended Actions ──
    actions = response.get("actions", [])
    if actions:
        story.append(Paragraph("Recommended Actions", s["h3"]))
        for a in actions:
            text = a if isinstance(a, str) else (a.get("description", "") if isinstance(a, dict) else str(a))
            if text:
                story.append(Paragraph(f"• {_clean_markdown(text)}", s["body"]))

    # ── Sources ──
    sources = response.get("sources", [])
    if sources:
        story.append(Spacer(1, 8))
        story.append(Paragraph("Research Sources & Verification", s["h2"]))
        story.append(HRFlowable(width="100%", color=GREY_LIGHT, thickness=0.5))
        for src in sources:
            name = src.get("name", src.get("id", "—"))
            url = src.get("url", "")
            verified = src.get("verifiedAt", src.get("checked", ""))
            line = f"<b>{_clean_markdown(name)}</b>"
            if url:
                line += f' — <font color="#{GREY_TEXT.hexval()[2:]}" size="8">{url}</font>'
            if verified:
                line += f' <font color="#{GREEN.hexval()[2:]}" size="8">[verified {verified[:10]}]</font>'
            story.append(Paragraph(line, s["body_grey"]))

    # ── Evidentiary Chain ──
    if evidence_items:
        story.append(Spacer(1, 10))
        story.append(Paragraph("Evidentiary Chain", s["h2"]))
        story.append(HRFlowable(width="100%", color=GOLD, thickness=1))
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            "Each item below was registered, validated and retained by Apollo during the investigation. "
            "Integrity hashes allow independent verification that findings reference the original material.",
            s["body_grey"]))
        story.append(Spacer(1, 6))

        for item in evidence_items:
            display_id = item.get("displayId", "E-???")
            kind = item.get("kind", "unknown")
            availability = item.get("availability", "unknown")
            integrity = item.get("integrityHash", "")
            label = item.get("label", "")
            collected = (item.get("collectedAt") or item.get("expiresAt", ""))[:19].replace("T", " ")
            expires = item.get("expiresAt", "")[:19].replace("T", " ")

            ev_parts = []
            # Header row
            status_text = "Available" if availability == "available" else \
                          "Content Expired (24h)" if availability == "content_expired" else \
                          "Purged" if availability == "purged" else availability.title()
            status_color = GREEN if availability == "available" else AMBER if availability == "content_expired" else RED
            ev_parts.append(Paragraph(
                f'<b>{display_id}</b> · {kind.title()} · '
                f'<font color="#{status_color.hexval()[2:]}">{status_text}</font>', s["evidence_id"]))
            if label:
                ev_parts.append(Paragraph(_clean_markdown(label), s["body_grey"]))

            # Metadata table
            meta_rows = []
            if collected:
                meta_rows.append(["Acquired", collected])
            if expires:
                meta_rows.append(["Content Expires", expires])
            if integrity:
                meta_rows.append(["SHA-256", integrity[:32] + "…" if len(integrity) > 32 else integrity])

            # Provenance
            prov = item.get("provenance")
            if prov:
                method = prov.get("acquisitionMethod", "")
                source_desc = prov.get("sourceDescription", "")
                if method:
                    meta_rows.append(["Acquisition", method])
                if source_desc:
                    meta_rows.append(["Source", source_desc[:80]])

            # Transformations
            transforms = item.get("transformations", [])
            for t in transforms:
                t_kind = t.get("kind", "") if isinstance(t, dict) else str(t)
                t_desc = t.get("description", "") if isinstance(t, dict) else ""
                meta_rows.append(["Transform", f"{t_kind}: {t_desc[:60]}"])

            if meta_rows:
                meta_table = Table(meta_rows, colWidths=[80, page_width - 90])
                meta_table.setStyle(TableStyle([
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("TEXTCOLOR", (0, 0), (0, -1), GREY_TEXT),
                    ("TEXTCOLOR", (1, 0), (1, -1), NAVY_DEEP),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 1),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ]))
                ev_parts.append(meta_table)

            if availability == "content_expired":
                ev_parts.append(Paragraph(
                    '<i>This evidence was automatically deleted after 24 hours to protect your privacy. '
                    'The investigation findings above remain available.</i>', s["meta"]))

            ev_parts.append(Spacer(1, 6))
            story.append(KeepTogether(ev_parts))

    # ── Retention & Privacy Notice ──
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", color=GREY_LIGHT, thickness=0.5))

    report_expires = case.get("reportExpiresAt", "")[:10] if case.get("reportExpiresAt") else "—"
    evidence_expires = case.get("evidenceExpiresAt", "")[:10] if case.get("evidenceExpiresAt") else "—"
    retention_text = (
        f"<b>Retention Policy</b><br/>"
        f"Source evidence: automatically deleted within 24 hours of acquisition (expires {evidence_expires}).<br/>"
        f"Saved investigation report: retained for up to 90 days (expires {report_expires}).<br/>"
        f"This exported PDF is a user-controlled copy outside the application's automatic retention system."
    )
    story.append(Paragraph(retention_text, s["retention"]))

    # ── Footer ──
    story.append(Spacer(1, 10))
    story.append(GoldBar(page_width))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Generated by Apollo Scam Guard · {now.strftime('%Y-%m-%d %H:%M UTC')}<br/>"
        "APOLLO DETECTS. MAGNUM DI INVESTIGATES. HIGGINS EXPLAINS AND GUIDES.",
        s["footer"]))

    # Build
    doc.build(story)
    return buf.getvalue()
