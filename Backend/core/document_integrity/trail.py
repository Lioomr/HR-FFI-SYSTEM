"""Approval-trail page appended to a document before it is frozen and sealed.

The page lists who approved, in which role, and when - all from recorded
database fields - so the organization seal also covers the trail.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from io import BytesIO

from django.utils import timezone
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from core.pdf import font_pair, shape_ar

ACCENT = (1.0, 0.353, 0.0)
MODE_NOTES = {
    "freeze": "This copy was frozen at final approval and its SHA-256 hash recorded.",
    "seal": "This copy is sealed with the organization's digital seal and an RFC 3161 timestamp.",
    "personal": "Each approver signed with a personal certificate; the organization seal was applied last.",
}


@dataclass(frozen=True)
class TrailRow:
    role_label: str
    name: str
    action_label: str
    at: datetime | None
    certificate_serial: str = ""


def _when(value: datetime | None, tz=None) -> str:
    """Local date and time in ``tz`` (the viewer's region) with no zone suffix."""

    if not value:
        return ""
    if timezone.is_aware(value):
        value = timezone.localtime(value, tz) if tz is not None else timezone.localtime(value)
    return value.strftime("%Y-%m-%d %H:%M")


def _fit(text: str, font: str, size: float, width: float) -> str:
    shaped = shape_ar(text)
    if pdfmetrics.stringWidth(shaped, font, size) <= width:
        return shaped
    while shaped and pdfmetrics.stringWidth(f"{shaped}...", font, size) > width:
        shaped = shaped[:-1]
    return f"{shaped}..."


def render_trail_page(
    rows: list[TrailRow],
    *,
    title: str,
    reference: str,
    subject: str,
    frozen_at: datetime,
    mode: str,
    tz=None,
) -> bytes:
    regular, bold = font_pair()
    buffer = BytesIO()
    width, height = A4
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=1)
    pdf.setTitle(f"{title} - Approval Trail")
    margin = 48
    y = height - margin

    pdf.setFillColorRGB(*ACCENT)
    pdf.rect(margin, y - 4, width - margin * 2, 3, stroke=0, fill=1)
    y -= 28
    pdf.setFillColorRGB(0.1, 0.1, 0.1)
    pdf.setFont(bold, 16)
    pdf.drawString(margin, y, "Approval Trail")
    pdf.setFont(regular, 12)
    pdf.drawRightString(width - margin, y, shape_ar("سجل الاعتمادات"))
    y -= 24

    pdf.setFont(regular, 9.5)
    for label, value in (
        ("Document", title),
        ("Reference", reference),
        ("Subject", subject),
        ("Frozen at", _when(frozen_at, tz)),
    ):
        pdf.setFillColorRGB(0.4, 0.4, 0.4)
        pdf.drawString(margin, y, label)
        pdf.setFillColorRGB(0.1, 0.1, 0.1)
        pdf.drawString(margin + 90, y, _fit(value or "-", regular, 9.5, width - margin * 2 - 90))
        y -= 15
    y -= 10

    columns = [("Role", 110), ("Name", 150), ("Decision", 62), ("Recorded at", 115), ("Certificate", 62)]
    pdf.setFillColorRGB(0.95, 0.95, 0.95)
    pdf.rect(margin, y - 6, width - margin * 2, 18, stroke=0, fill=1)
    pdf.setFillColorRGB(0.2, 0.2, 0.2)
    pdf.setFont(bold, 9)
    x = margin + 4
    for label, column_width in columns:
        pdf.drawString(x, y, label)
        x += column_width
    y -= 22

    pdf.setFont(regular, 9)
    for row in rows:
        if y < margin + 60:
            break
        x = margin + 4
        values = [row.role_label, row.name, row.action_label, _when(row.at, tz), row.certificate_serial[:10]]
        for (_, column_width), value in zip(columns, values, strict=True):
            pdf.setFillColorRGB(0.1, 0.1, 0.1)
            pdf.drawString(x, y, _fit(value or "-", regular, 9, column_width - 6))
            x += column_width
        pdf.setStrokeColorRGB(0.88, 0.88, 0.88)
        pdf.line(margin, y - 6, width - margin, y - 6)
        y -= 20

    y -= 14
    pdf.setFont(regular, 8.5)
    pdf.setFillColorRGB(0.35, 0.35, 0.35)
    for line in (
        "HR work paper: names, roles and times come from the approval records, shown in your local time.",
        MODE_NOTES.get(mode, MODE_NOTES["freeze"]),
        "The approved form (pages before this one) is the verifiable original; this page is not part of it.",
    ):
        pdf.drawString(margin, y, line)
        y -= 12

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def append_pdf(document: bytes, extra: bytes) -> bytes:
    writer = PdfWriter()
    writer.append(PdfReader(BytesIO(document)))
    writer.append(PdfReader(BytesIO(extra)))
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def stamp_document_reference(document: bytes, *, reference_token: str, title: str) -> bytes:
    """Embed a machine-readable record pointer used to match uploaded copies."""

    writer = PdfWriter(clone_from=PdfReader(BytesIO(document)))
    writer.add_metadata({"/FFIDocumentRef": reference_token, "/Title": title, "/Producer": "FFI HR"})
    out = BytesIO()
    writer.write(out)
    return out.getvalue()
