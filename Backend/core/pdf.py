"""Unified PDF design module for FFI HR System.

All request-form and report PDFs render through helpers in this module so the
brand identity, fonts, and layout primitives stay consistent across apps.

Two rendering paths are provided:

* ``render_request_pdf`` — canvas-based, used for request forms (leave, loan,
  asset, rent). Bilingual EN/AR layout with branded header, details card,
  approval timeline, signature block.
* ``build_platypus_story_pdf`` — SimpleDocTemplate-based, used for tabular
  reports (payslips, payroll run reports). Shares palette, logo, corporate
  header, and signature stamp with the canvas path.

Everything below is pure rendering — no model imports. Callers assemble their
domain data into the structures documented on each helper.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from django.conf import settings
from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except Exception:  # pragma: no cover - optional dependency
    arabic_reshaper = None
    get_display = None

try:
    from pypdf import PdfReader, PdfWriter
except Exception:  # pragma: no cover - optional dependency
    PdfReader = None
    PdfWriter = None


LANDSCAPE_A4 = landscape(A4)

PALETTE = {
    "primary_orange": colors.HexColor("#f97316"),
    "light_orange": colors.HexColor("#ffedd5"),
    "soft_orange": colors.HexColor("#fff7ed"),
    "dark_text": colors.HexColor("#111827"),
    "muted_text": colors.HexColor("#6b7280"),
    "border_orange": colors.HexColor("#fdba74"),
    "grid_orange": colors.HexColor("#fed7aa"),
    "white": colors.white,
}

# RGB tuples for canvas-based helpers (reportlab canvas wants floats 0..1).
PALETTE_RGB = {
    "primary_orange": (0.976, 0.451, 0.086),
    "soft_orange": (1.000, 0.969, 0.929),
    "light_orange": (1.000, 0.929, 0.835),
    "border_orange": (0.992, 0.729, 0.455),
    "grid_orange": (0.996, 0.843, 0.667),
    "dark_text": (0.067, 0.094, 0.153),
    "muted_text": (0.420, 0.447, 0.502),
}


_FONT_CANDIDATES = {
    "DejaVuSans": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:\\Windows\\Fonts\\DejaVuSans.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ],
    "DejaVuSans-Bold": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:\\Windows\\Fonts\\DejaVuSans-Bold.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
    ],
}


def register_fonts() -> None:
    """Register DejaVuSans (with Arabic glyph coverage) on first call."""

    registered = pdfmetrics.getRegisteredFontNames()
    for name, paths in _FONT_CANDIDATES.items():
        if name in registered:
            continue
        for path in paths:
            if os.path.exists(path):
                try:
                    pdfmetrics.registerFont(TTFont(name, path))
                except Exception:
                    continue
                break


def font_pair() -> tuple[str, str]:
    """Return (regular, bold) font names, falling back to Helvetica."""

    register_fonts()
    names = pdfmetrics.getRegisteredFontNames()
    regular = "DejaVuSans" if "DejaVuSans" in names else "Helvetica"
    bold = "DejaVuSans-Bold" if "DejaVuSans-Bold" in names else "Helvetica-Bold"
    return regular, bold


def shape_ar(text: object) -> str:
    """Reshape Arabic text for correct RTL rendering on a reportlab canvas."""

    value = str(text or "").strip()
    if not value:
        return ""
    if arabic_reshaper and get_display and any("\u0600" <= ch <= "\u06FF" for ch in value):
        try:
            return get_display(arabic_reshaper.reshape(value))
        except Exception:
            return value
    return value


def get_logo_path() -> str:
    """Resolve the FFI logo path across dev/docker layouts."""

    candidates = [
        os.path.join(str(settings.BASE_DIR), "static", "email", "ffi-logo.png"),
        os.path.join(str(settings.BASE_DIR), "ffi-logo.png"),
        os.path.join(str(settings.BASE_DIR), "Logo FFI.png"),
        os.path.join(str(settings.BASE_DIR.parent), "FrontEnd", "public", "ffi-logo.png"),
        "/app/static/email/ffi-logo.png",
        "/app/ffi-logo.png",
        "/app/Logo FFI.png",
    ]
    return next((path for path in candidates if os.path.exists(path)), "")


# ---------------------------------------------------------------------------
# Canvas-based request form renderer
# ---------------------------------------------------------------------------


@dataclass
class DetailRow:
    """A single label/value pair rendered bilingually inside a details card."""

    label_en: str
    label_ar: str
    value: str = "-"


@dataclass
class ApprovalStage:
    """One step on the approval timeline."""

    stage_en: str
    stage_ar: str
    actor: str = "-"
    at: str = "-"
    note: str = "-"


@dataclass
class EmployeeBlock:
    """Employee identity block shown near the top of every request form."""

    name: str = "-"
    employee_number: str = "-"
    department: str = "-"
    job_title: str = "-"
    national_id: str = "-"
    mobile: str = "-"

    def as_rows(self) -> list[DetailRow]:
        return [
            DetailRow("Employee", "الموظف", self.name),
            DetailRow("Employee No.", "الرقم الوظيفي", self.employee_number),
            DetailRow("Department", "القسم", self.department),
            DetailRow("Job Title", "المسمى الوظيفي", self.job_title),
            DetailRow("National ID", "الهوية الوطنية", self.national_id),
            DetailRow("Mobile", "الجوال", self.mobile),
        ]


@dataclass
class ExtraSection:
    """Optional additional section (free text) appended below details."""

    title_en: str
    title_ar: str
    body: str = "-"


@dataclass
class RequestDocument:
    title_en: str
    title_ar: str
    reference_no: str
    generated_at: str = field(default_factory=lambda: timezone.localtime().strftime("%Y-%m-%d %H:%M"))
    employee: EmployeeBlock | None = None
    details: Sequence[DetailRow] = field(default_factory=list)
    approvals: Sequence[ApprovalStage] = field(default_factory=list)
    extra: Sequence[ExtraSection] = field(default_factory=list)
    status_label: str = ""


def _draw_page_shell(pdf, width: float, height: float, doc: RequestDocument) -> None:
    # Outer background card
    pdf.setFillColorRGB(*PALETTE_RGB["soft_orange"])
    pdf.roundRect(24, 24, width - 48, height - 48, 20, fill=1, stroke=0)

    # Orange banner
    pdf.setFillColorRGB(*PALETTE_RGB["primary_orange"])
    pdf.roundRect(24, height - 110, width - 48, 80, 18, fill=1, stroke=0)

    # Logo
    logo = get_logo_path()
    if logo:
        try:
            pdf.drawImage(
                ImageReader(logo),
                38,
                height - 96,
                width=56,
                height=44,
                preserveAspectRatio=True,
                mask="auto",
            )
        except Exception:
            pass

    regular, bold = font_pair()

    # Titles
    pdf.setFillColorRGB(1, 1, 1)
    pdf.setFont(bold, 15)
    pdf.drawString(108, height - 62, doc.title_en)
    pdf.setFont(regular, 10)
    pdf.drawString(108, height - 80, f"Ref #{doc.reference_no}  |  Generated {doc.generated_at}")

    pdf.setFont(bold, 13)
    pdf.drawRightString(width - 36, height - 62, shape_ar(doc.title_ar))
    pdf.setFont(regular, 9)
    pdf.drawRightString(
        width - 36,
        height - 80,
        shape_ar(f"المرجع #{doc.reference_no}  |  صدر في {doc.generated_at}"),
    )

    if doc.status_label:
        pdf.setFillColorRGB(*PALETTE_RGB["light_orange"])
        pdf.roundRect(width - 180, height - 102, 144, 22, 10, fill=1, stroke=0)
        pdf.setFillColorRGB(*PALETTE_RGB["primary_orange"])
        pdf.setFont(bold, 9)
        pdf.drawCentredString(width - 108, height - 89, f"Status: {doc.status_label}")


def _draw_section_title(pdf, x: float, y: float, title_en: str, title_ar: str) -> None:
    regular, bold = font_pair()
    pdf.setFillColorRGB(*PALETTE_RGB["primary_orange"])
    pdf.setFont(bold, 12)
    pdf.drawString(x, y, title_en)
    pdf.drawRightString(x + 500, y, shape_ar(title_ar))


def _draw_card(pdf, x: float, y_top: float, width: float, height: float) -> None:
    pdf.setFillColorRGB(1, 1, 1)
    pdf.roundRect(x, y_top - height, width, height, 14, fill=1, stroke=0)
    pdf.setStrokeColorRGB(*PALETTE_RGB["border_orange"])
    pdf.setLineWidth(0.8)
    pdf.roundRect(x, y_top - height, width, height, 14, fill=0, stroke=1)


def _draw_detail_rows(pdf, x: float, y_top: float, width: float, rows: Sequence[DetailRow]) -> float:
    regular, bold = font_pair()
    row_height = 22
    cursor = y_top
    for row in rows:
        value = str(row.value or "-")
        pdf.setFillColorRGB(*PALETTE_RGB["dark_text"])
        pdf.setFont(bold, 9)
        pdf.drawString(x + 12, cursor, row.label_en)
        pdf.setFont(regular, 9)
        pdf.drawRightString(x + width - 12, cursor, shape_ar(row.label_ar))

        pdf.setFillColorRGB(*PALETTE_RGB["muted_text"])
        pdf.setFont(regular, 10)
        lines = simpleSplit(shape_ar(value), regular, 10, width - 24)[:2] or ["-"]
        for index, line in enumerate(lines):
            pdf.drawString(x + 12, cursor - 12 - (index * 12), line)

        # Row separator
        pdf.setStrokeColorRGB(*PALETTE_RGB["border_orange"])
        pdf.setLineWidth(0.2)
        pdf.line(x + 8, cursor - 28, x + width - 8, cursor - 28)
        cursor -= row_height + max(0, (len(lines) - 1) * 12)
    return cursor


def _draw_approval_timeline(pdf, x: float, y_top: float, width: float, stages: Sequence[ApprovalStage]) -> float:
    regular, bold = font_pair()
    row_height = 44
    cursor = y_top
    for index, stage in enumerate(stages):
        dot_x = x + 14
        pdf.setFillColorRGB(*PALETTE_RGB["primary_orange"])
        pdf.circle(dot_x, cursor - 4, 4, fill=1, stroke=0)
        if index != len(stages) - 1:
            pdf.setStrokeColorRGB(*PALETTE_RGB["border_orange"])
            pdf.setLineWidth(0.8)
            pdf.line(dot_x, cursor - 10, dot_x, cursor - row_height - 6)

        pdf.setFillColorRGB(*PALETTE_RGB["dark_text"])
        pdf.setFont(bold, 10)
        pdf.drawString(dot_x + 14, cursor, stage.stage_en)
        pdf.drawRightString(x + width - 12, cursor, shape_ar(stage.stage_ar))

        pdf.setFillColorRGB(*PALETTE_RGB["muted_text"])
        pdf.setFont(regular, 9)
        pdf.drawString(dot_x + 14, cursor - 14, f"{stage.actor}  |  {stage.at}")
        if stage.note and stage.note != "-":
            lines = simpleSplit(str(stage.note), regular, 9, width - 40)[:2]
            for line_index, line in enumerate(lines):
                pdf.drawString(dot_x + 14, cursor - 28 - (line_index * 11), line)
        cursor -= row_height
    return cursor


def _draw_signature_block(pdf, x: float, y_top: float, width: float) -> None:
    regular, bold = font_pair()
    roles = [
        ("Prepared by", "أعدّ بواسطة"),
        ("Reviewed by", "روجِع بواسطة"),
        ("Approved by", "اعتُمد بواسطة"),
        ("Company Stamp", "ختم الشركة"),
    ]
    col_width = width / len(roles)
    height = 70
    pdf.setFillColorRGB(*PALETTE_RGB["primary_orange"])
    pdf.rect(x, y_top - 18, width, 18, fill=1, stroke=0)
    pdf.setFillColorRGB(1, 1, 1)
    pdf.setFont(bold, 9)
    for index, (en, ar) in enumerate(roles):
        cx = x + col_width * index + col_width / 2
        pdf.drawCentredString(cx, y_top - 12, f"{en} / {shape_ar(ar)}")

    pdf.setStrokeColorRGB(*PALETTE_RGB["border_orange"])
    pdf.setLineWidth(0.6)
    pdf.rect(x, y_top - 18 - height, width, height, fill=0, stroke=1)
    for index in range(1, len(roles)):
        cx = x + col_width * index
        pdf.line(cx, y_top - 18, cx, y_top - 18 - height)

    pdf.setFillColorRGB(*PALETTE_RGB["muted_text"])
    pdf.setFont(regular, 8)
    for index, _ in enumerate(roles[:-1]):
        cx = x + col_width * index
        pdf.drawString(cx + 8, y_top - 36, "Name: ______________________")
        pdf.drawString(cx + 8, y_top - 52, "Date: ______________________")
        pdf.drawString(cx + 8, y_top - 68, "Signature: __________________")


def render_request_pdf(doc: RequestDocument) -> bytes:
    """Render a single-page A4 request form PDF from a RequestDocument."""

    register_fonts()
    buffer = io.BytesIO()
    width, height = A4
    pdf = pdf_canvas.Canvas(buffer, pagesize=A4)
    pdf.setTitle(f"{doc.title_en} {doc.reference_no}".strip())

    _draw_page_shell(pdf, width, height, doc)

    # Employee + details card
    details_rows = list(doc.employee.as_rows() if doc.employee else []) + list(doc.details)
    card_top = height - 130
    card_height = max(160, 28 * len(details_rows) + 36)
    _draw_card(pdf, 36, card_top, width - 72, card_height)
    _draw_section_title(pdf, 52, card_top - 18, "Request Details", "تفاصيل الطلب")
    _draw_detail_rows(pdf, 40, card_top - 40, width - 80, details_rows)

    # Extra sections
    cursor_top = card_top - card_height - 16
    for section in doc.extra:
        section_height = 72
        _draw_card(pdf, 36, cursor_top, width - 72, section_height)
        _draw_section_title(pdf, 52, cursor_top - 18, section.title_en, section.title_ar)
        regular, _ = font_pair()
        pdf.setFillColorRGB(*PALETTE_RGB["muted_text"])
        pdf.setFont(regular, 9)
        lines = simpleSplit(str(section.body or "-"), regular, 9, width - 104)[:3]
        for index, line in enumerate(lines):
            pdf.drawString(52, cursor_top - 36 - (index * 12), line)
        cursor_top -= section_height + 14

    # Approval timeline
    if doc.approvals:
        timeline_height = max(120, 48 * len(doc.approvals) + 24)
        _draw_card(pdf, 36, cursor_top, width - 72, timeline_height)
        _draw_section_title(pdf, 52, cursor_top - 18, "Approval Path", "مسار الموافقة")
        _draw_approval_timeline(pdf, 36, cursor_top - 42, width - 72, doc.approvals)
        cursor_top -= timeline_height + 14

    # Signature block pinned above the footer
    signature_top = max(cursor_top, 140)
    _draw_signature_block(pdf, 36, signature_top, width - 72)

    # Footer accent bar + text
    regular, _ = font_pair()
    pdf.setFillColorRGB(*PALETTE_RGB["primary_orange"])
    pdf.rect(36, 48, width - 72, 2, fill=1, stroke=0)
    pdf.setFillColorRGB(*PALETTE_RGB["muted_text"])
    pdf.setFont(regular, 8)
    pdf.drawString(36, 32, "FFI HR System")
    pdf.drawCentredString(width / 2, 32, f"Ref #{doc.reference_no}")
    pdf.drawRightString(width - 36, 32, f"Generated {doc.generated_at}")

    pdf.showPage()
    pdf.save()
    raw = buffer.getvalue()
    label = watermark_for_status(doc.status_label)
    return apply_watermark(raw, label) if label else raw


# ---------------------------------------------------------------------------
# Platypus helpers (for tabular reports — payslips, payroll runs)
# ---------------------------------------------------------------------------


def build_corporate_header(title: str, period_text: str, second_col_width: float):
    """Return a Platypus Table rendering the branded report header.

    Used by payslip / payroll run reports.
    """

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "PdfCorporateTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=15,
        textColor=PALETTE["dark_text"],
        spaceAfter=2,
    )
    subtitle_style = ParagraphStyle(
        "PdfCorporateSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        textColor=PALETTE["muted_text"],
        spaceAfter=6,
    )

    logo_path = get_logo_path()
    logo_cell: object = ""
    if logo_path:
        logo_cell = Image(logo_path, width=32 * mm, height=12 * mm)

    header_table = Table(
        [
            [
                logo_cell,
                [
                    Paragraph("FFI HR SYSTEM", subtitle_style),
                    Paragraph(title, title_style),
                    Paragraph(period_text, subtitle_style),
                ],
            ]
        ],
        colWidths=[38 * mm, second_col_width],
    )
    header_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 1, PALETTE["primary_orange"]),
                ("LINEBELOW", (0, 0), (-1, 0), 1, PALETTE["primary_orange"]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return header_table


def build_signature_stamp_block(total_width: float):
    signer_width = total_width * 0.23
    stamp_width = total_width - (signer_width * 3)
    signature_table = Table(
        [
            ["Prepared By", "Reviewed By", "Approved By", "Company Stamp"],
            [
                "Name: ____________________\nDate: ____________________\nSignature: _______________",
                "Name: ____________________\nDate: ____________________\nSignature: _______________",
                "Name: ____________________\nDate: ____________________\nSignature: _______________",
                "\n\n\n",
            ],
        ],
        colWidths=[signer_width, signer_width, signer_width, stamp_width],
    )
    signature_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PALETTE["primary_orange"]),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("BACKGROUND", (0, 1), (-2, 1), colors.white),
                ("BACKGROUND", (-1, 1), (-1, 1), PALETTE["soft_orange"]),
                ("FONTNAME", (0, 1), (-1, 1), "Helvetica"),
                ("FONTSIZE", (0, 1), (-1, 1), 7),
                ("TEXTCOLOR", (0, 1), (-1, 1), PALETTE["dark_text"]),
                ("BOX", (0, 0), (-1, -1), 0.7, PALETTE["border_orange"]),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, PALETTE["grid_orange"]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return signature_table


def build_platypus_story_pdf(story: Iterable, report_name: str, pagesize=A4) -> bytes:
    """Render a reportlab platypus story with the shared header/footer callback."""

    buffer = io.BytesIO()
    left_margin = 14 * mm
    right_margin = 14 * mm
    doc = SimpleDocTemplate(
        buffer,
        pagesize=pagesize,
        leftMargin=left_margin,
        rightMargin=right_margin,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    generated_at = timezone.now().strftime("%Y-%m-%d %H:%M:%S")

    def _draw_header_footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("Helvetica-Bold", 10)
        canvas.setFillColor(PALETTE["dark_text"])
        canvas.drawString(left_margin, pagesize[1] - (10 * mm), report_name)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(PALETTE["muted_text"])
        canvas.drawString(left_margin, 8 * mm, f"Generated at: {generated_at}")
        canvas.drawRightString(pagesize[0] - right_margin, 8 * mm, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    doc.build(list(story), onFirstPage=_draw_header_footer, onLaterPages=_draw_header_footer)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Post-processing: watermark, merge, encrypt (pypdf)
# ---------------------------------------------------------------------------


def _build_watermark_page(label: str, pagesize=A4) -> bytes:
    register_fonts()
    _, bold = font_pair()
    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=pagesize)
    width, height = pagesize
    c.saveState()
    c.translate(width / 2, height / 2)
    c.rotate(35)
    c.setFont(bold, 96)
    c.setFillColor(colors.HexColor("#f97316"))
    try:
        c.setFillAlpha(0.18)
    except Exception:
        pass
    c.drawCentredString(0, 0, str(label).upper())
    c.restoreState()
    c.save()
    return buf.getvalue()


def apply_watermark(pdf_bytes: bytes, label: str) -> bytes:
    """Overlay a diagonal watermark (DRAFT/CANCELLED) on every page."""

    if not label or PdfReader is None or PdfWriter is None:
        return pdf_bytes
    try:
        base = PdfReader(io.BytesIO(pdf_bytes))
        stamp_page = PdfReader(io.BytesIO(_build_watermark_page(label))).pages[0]
        writer = PdfWriter(clone_from=base)
        for page in writer.pages:
            page.merge_page(stamp_page)
        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:
        return pdf_bytes


def watermark_for_status(status: str | None) -> str:
    """Map a request status to a watermark label, or return '' for none."""

    if not status:
        return ""
    key = str(status).upper()
    if key in {"DRAFT", "PENDING_HR", "PENDING_MANAGER", "PENDING_FINANCE", "PENDING_CFO", "PENDING_CEO"}:
        return "DRAFT"
    if key in {"REJECTED", "CANCELLED", "CANCELED"}:
        return key.replace("CANCELED", "CANCELLED")
    return ""


def merge_pdfs(parts: Iterable[bytes]) -> bytes:
    """Merge multiple PDF byte blobs into one document."""

    if PdfReader is None or PdfWriter is None:
        raise RuntimeError("pypdf is required to merge PDFs")
    writer = PdfWriter()
    for blob in parts:
        if not blob:
            continue
        try:
            reader = PdfReader(io.BytesIO(blob))
        except Exception:
            continue
        for page in reader.pages:
            writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def encrypt_pdf(pdf_bytes: bytes, user_password: str, owner_password: str | None = None) -> bytes:
    """Password-protect a PDF (user password opens, owner password edits)."""

    if PdfReader is None or PdfWriter is None:
        raise RuntimeError("pypdf is required to encrypt PDFs")
    if not user_password:
        return pdf_bytes
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password=user_password, owner_password=owner_password or user_password)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def build_simple_lines_pdf(title: str, lines: Iterable[str]) -> bytes:
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "PdfTitle",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        textColor=PALETTE["dark_text"],
        spaceAfter=8,
    )
    line_style = ParagraphStyle(
        "PdfLine",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#374151"),
    )
    story = [Paragraph(title, title_style), Spacer(1, 4)]
    for line in lines:
        story.append(Paragraph(str(line), line_style))
        story.append(Spacer(1, 2))
    return build_platypus_story_pdf(story, title)
