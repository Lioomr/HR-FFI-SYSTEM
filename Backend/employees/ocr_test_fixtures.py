"""Synthetic, redacted identity-document fixtures for OCR integration tests.

Nothing here is derived from a real employee document. Names are placeholders,
identity numbers are constructed to satisfy the published checksum rules, and the
layouts are simplified reproductions of the field arrangement the parsers target
(bilingual label/value rows on Saudi cards, an ICAO TD3 band on passports).

Images are drawn at render time so no binary fixture is committed.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFont

# Constructed to pass the Saudi Luhn-variant checksum; not issued to anyone.
SAMPLE_IQAMA_NUMBER = "2345678904"
SAMPLE_SAUDI_ID_NUMBER = "1234567897"
SAMPLE_PASSPORT_NUMBER = "X12345678"
SAMPLE_VISA_NUMBER = "4455667788"

CARD_SIZE = (1000, 640)
PASSPORT_SIZE = (1100, 760)

_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/tahoma.ttf",
)
_MONO_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/cour.ttf",
)


def _font(size: int, mono: bool = False):
    for path in _MONO_CANDIDATES if mono else _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _shape_arabic(text: str) -> str:
    """Render Arabic the way a printed card does: shaped and right-to-left.

    Without this the glyphs draw isolated and left-to-right, which is not what
    the recognition model was trained on and would make the fixture unfair.
    """

    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        return get_display(arabic_reshaper.reshape(text))
    except Exception:
        return text


@dataclass
class DocumentFixture:
    name: str
    document_type: str
    size: tuple[int, int]
    rows: list[tuple[int, int, str, int, bool]] = field(default_factory=list)
    expected: dict = field(default_factory=dict)

    def render(self, *, rotate: int = 0, scale: float = 1.0, noise: bool = False) -> Image.Image:
        width, height = self.size
        image = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle([(8, 8), (width - 8, height - 8)], outline="black", width=3)

        for x, y, text, size, mono in self.rows:
            content = _shape_arabic(text) if any("؀" <= ch <= "ۿ" for ch in text) else text
            draw.text((x, y), content, fill="black", font=_font(size, mono))

        if scale != 1.0:
            image = image.resize((int(width * scale), int(height * scale)), Image.Resampling.LANCZOS)
        if noise:
            from PIL import ImageFilter

            image = image.filter(ImageFilter.GaussianBlur(radius=0.8))
        if rotate:
            image = image.rotate(rotate, expand=True, fillcolor="white")
        return image

    def png_bytes(self, **kwargs) -> bytes:
        buffer = io.BytesIO()
        self.render(**kwargs).save(buffer, format="PNG")
        return buffer.getvalue()

    def pdf_bytes(self, **kwargs) -> bytes:
        """A scanned PDF: the page is an image, so there is no text layer."""

        buffer = io.BytesIO()
        self.render(**kwargs).convert("RGB").save(buffer, format="PDF", resolution=150.0)
        return buffer.getvalue()


def _mrz_check_digit(value: str) -> str:
    weights = (7, 3, 1)
    total = 0
    for index, char in enumerate(value):
        if char == "<":
            numeric = 0
        elif char.isdigit():
            numeric = int(char)
        else:
            numeric = ord(char) - ord("A") + 10
        total += numeric * weights[index % 3]
    return str(total % 10)


def build_td3_mrz(
    *,
    document_number: str = SAMPLE_PASSPORT_NUMBER,
    nationality: str = "EGY",
    birth: str = "900101",
    sex: str = "M",
    expiry: str = "300101",
) -> tuple[str, str]:
    name_field = "TESTCASE<<SAMPLE<EMPLOYEE".ljust(39, "<")[:39]
    line1 = f"P<{nationality}{name_field}"
    body = (
        f"{document_number}{_mrz_check_digit(document_number)}{nationality}"
        f"{birth}{_mrz_check_digit(birth)}{sex}{expiry}{_mrz_check_digit(expiry)}"
        f"{'<' * 14}<"
    )
    composite = body[0:10] + body[13:20] + body[21:43]
    return line1, f"{body}{_mrz_check_digit(composite)}"


ENGLISH_IQAMA = DocumentFixture(
    name="english_iqama",
    document_type="IQAMA",
    size=CARD_SIZE,
    rows=[
        (40, 30, "KINGDOM OF SAUDI ARABIA", 34, False),
        (40, 90, "RESIDENT IDENTITY", 30, False),
        (40, 170, "Full Name: SAMPLE EMPLOYEE TESTCASE", 30, False),
        (40, 230, "Nationality: EGYPT", 30, False),
        (40, 290, "Date of Birth: 01/01/1990", 30, False),
        (40, 350, f"Iqama Number: {SAMPLE_IQAMA_NUMBER}", 30, False),
        (40, 410, "Iqama Expiry: 21/11/2030", 30, False),
        (40, 470, "Profession: Construction Worker", 30, False),
    ],
    expected={
        "iqama_number": SAMPLE_IQAMA_NUMBER,
        "iqama_expiry_date": "21/11/2030",
        "status": "success",
    },
)

BILINGUAL_IQAMA = DocumentFixture(
    name="bilingual_iqama",
    document_type="IQAMA",
    size=CARD_SIZE,
    rows=[
        (40, 30, "KINGDOM OF SAUDI ARABIA", 32, False),
        (600, 30, "المملكة العربية السعودية", 32, False),
        (40, 150, "Full Name: SAMPLE EMPLOYEE TESTCASE", 28, False),
        (640, 150, "الاسم", 28, False),
        (40, 220, "Nationality: EGYPT", 28, False),
        (640, 220, "الجنسية", 28, False),
        (40, 290, f"Iqama Number: {SAMPLE_IQAMA_NUMBER}", 28, False),
        (640, 290, "رقم الهوية", 28, False),
        (40, 360, "Iqama Expiry: 21/11/2030", 28, False),
        (640, 360, "تاريخ الانتهاء", 28, False),
        (40, 430, "Profession: Construction Worker", 28, False),
        (640, 430, "المهنة", 28, False),
    ],
    expected={
        "iqama_number": SAMPLE_IQAMA_NUMBER,
        "iqama_expiry_date": "21/11/2030",
        "status": "success",
    },
)

ARABIC_IQAMA = DocumentFixture(
    name="arabic_iqama",
    document_type="IQAMA",
    size=CARD_SIZE,
    rows=[
        (400, 30, "المملكة العربية السعودية", 34, False),
        (40, 150, "SAMPLE EMPLOYEE TESTCASE", 30, False),
        (40, 230, f"رقم الهوية: {SAMPLE_IQAMA_NUMBER}", 30, False),
        (40, 310, "تاريخ الانتهاء: 21/11/2030", 30, False),
        (40, 390, "مصر", 30, False),
        (40, 460, "عامل انشاءات", 30, False),
    ],
    expected={"iqama_number": SAMPLE_IQAMA_NUMBER, "status": "success"},
)

BILINGUAL_SAUDI_ID = DocumentFixture(
    name="bilingual_saudi_id",
    document_type="SAUDI_ID",
    size=CARD_SIZE,
    rows=[
        (40, 30, "NATIONAL IDENTITY", 32, False),
        (620, 30, "الهوية الوطنية", 32, False),
        (40, 160, "Full Name: SAMPLE EMPLOYEE TESTCASE", 28, False),
        (660, 160, "الاسم", 28, False),
        (40, 240, "Nationality: SAUDI", 28, False),
        (660, 240, "الجنسية", 28, False),
        (40, 320, f"ID Number: {SAMPLE_SAUDI_ID_NUMBER}", 28, False),
        (660, 320, "رقم الهوية", 28, False),
        (40, 400, "Expiry Date: 15/06/2032", 28, False),
        (660, 400, "تاريخ الانتهاء", 28, False),
    ],
    expected={
        "iqama_number": SAMPLE_SAUDI_ID_NUMBER,
        "iqama_expiry_date": "15/06/2032",
        "status": "success",
    },
)

VISA = DocumentFixture(
    name="visa",
    document_type="VISA",
    size=CARD_SIZE,
    rows=[
        (40, 30, "EXIT RE-ENTRY VISA", 34, False),
        (600, 30, "تأشيرة خروج وعودة", 32, False),
        (40, 170, f"Visa Number: {SAMPLE_VISA_NUMBER}", 30, False),
        (40, 250, "Exit Before: 30/06/2026", 30, False),
        (40, 330, "Visa Duration: 45", 30, False),
        (40, 410, "Employer: SAMPLE COMPANY LTD", 30, False),
    ],
    expected={
        "visa_number": SAMPLE_VISA_NUMBER,
        "exit_before_raw": "30/06/2026",
        "visa_duration_raw": "45",
        "status": "success",
    },
)

_MRZ_LINE_1, _MRZ_LINE_2 = build_td3_mrz()

PASSPORT = DocumentFixture(
    name="passport",
    document_type="PASSPORT",
    size=PASSPORT_SIZE,
    rows=[
        (40, 30, "PASSPORT", 36, False),
        (40, 110, "Surname: TESTCASE", 28, False),
        (40, 170, "Given Names: SAMPLE EMPLOYEE", 28, False),
        (40, 230, "Nationality: EGY", 28, False),
        (40, 290, "Date of Birth: 01 JAN 1990", 28, False),
        (40, 350, "Date of Expiry: 01 JAN 2030", 28, False),
        (30, 580, _MRZ_LINE_1, 27, True),
        (30, 640, _MRZ_LINE_2, 27, True),
    ],
    expected={
        "passport_number": SAMPLE_PASSPORT_NUMBER,
        "nationality": "EGY",
        "date_of_birth": "1990-01-01",
        "expiry_date": "2030-01-01",
        "status": "success",
    },
)

ALL_FIXTURES = (
    ENGLISH_IQAMA,
    BILINGUAL_IQAMA,
    ARABIC_IQAMA,
    BILINGUAL_SAUDI_ID,
    VISA,
    PASSPORT,
)
