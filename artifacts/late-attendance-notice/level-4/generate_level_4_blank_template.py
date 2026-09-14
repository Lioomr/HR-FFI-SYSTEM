"""Build the approved Level 4 blank notice design asset.

This design-stage artifact stays outside the backend template directory until
all notice levels have visual approval.
"""

from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


OUT = Path(__file__).resolve().parent
REFERENCE = OUT / "approved-level-4-style-reference.png"
PDF = OUT / "late_attendance_level_4_blank.pdf"


def build() -> None:
    if not REFERENCE.exists():
        raise FileNotFoundError(f"Missing approved style reference: {REFERENCE}")

    page_width, page_height = A4
    image = ImageReader(str(REFERENCE))
    image_width, image_height = image.getSize()
    scale = page_width / image_width
    rendered_height = image_height * scale
    bottom = (page_height - rendered_height) / 2

    pdf = canvas.Canvas(str(PDF), pagesize=A4, pageCompression=1)
    pdf.setTitle("Late Attendance Notice Level 4 Blank Template")
    pdf.setAuthor("Fathi Fouad Itani Contracting Co.")
    pdf.drawImage(
        image,
        0,
        bottom,
        width=page_width,
        height=rendered_height,
        preserveAspectRatio=True,
        mask="auto",
    )

    # Audit identifiers occupy unused header space and have matching mapped
    # fields. They do not alter the approved form hierarchy.
    pdf.setFont("Helvetica", 5.8)
    pdf.setFillColor(HexColor("#6B7280"))
    pdf.drawRightString(507, 778, "Reference")
    pdf.drawRightString(507, 758, "Issued at")
    pdf.setStrokeColor(Color(0.82, 0.84, 0.87))
    pdf.setLineWidth(0.35)
    pdf.line(409, 774, 507, 774)
    pdf.line(409, 754, 507, 754)

    pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    build()
