import logging
import re
from datetime import datetime
from io import BytesIO
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from .models import EmployeeDocument

logger = logging.getLogger(__name__)

OCR_DOCUMENT_TYPES = {
    EmployeeDocument.DocumentType.PASSPORT,
    EmployeeDocument.DocumentType.IQAMA,
    EmployeeDocument.DocumentType.SAUDI_ID,
    EmployeeDocument.DocumentType.VISA,
}


def _first_match(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
    return match.group(1).strip(" :|\t") if match else ""


def _parse_date(raw_value: str):
    value = (raw_value or "").strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _mrz_date(value: str, *, future: bool = False) -> str:
    if not re.fullmatch(r"\d{6}", value or ""):
        return ""
    year = int(value[:2])
    current_two_digit_year = datetime.now().year % 100
    century = 2000 if future or year <= current_two_digit_year else 1900
    try:
        return datetime(century + year, int(value[2:4]), int(value[4:6])).date().isoformat()
    except ValueError:
        return ""


def _read_file_bytes(file_field) -> bytes:
    file_field.open("rb")
    try:
        return file_field.read()
    finally:
        file_field.close()


def _extract_pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(data))
    max_pages = int(getattr(settings, "EMPLOYEE_DOCUMENT_OCR_MAX_PAGES", 3))
    return "\n".join((page.extract_text() or "") for page in reader.pages[:max_pages])


def _render_pdf_images(data: bytes) -> list[Image.Image]:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(data)
    max_pages = min(len(document), int(getattr(settings, "EMPLOYEE_DOCUMENT_OCR_MAX_PAGES", 3)))
    images = []
    try:
        for index in range(max_pages):
            page = document[index]
            try:
                bitmap = page.render(scale=2.5)
                try:
                    images.append(bitmap.to_pil().convert("RGB").copy())
                finally:
                    bitmap.close()
            finally:
                page.close()
    finally:
        document.close()
    return images


def _prepare_image(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    max_dimension = int(getattr(settings, "EMPLOYEE_DOCUMENT_OCR_MAX_IMAGE_DIMENSION", 3000))
    image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
    grayscale = ImageOps.grayscale(image)
    grayscale = ImageOps.autocontrast(grayscale)
    grayscale = ImageEnhance.Contrast(grayscale).enhance(1.4)
    return grayscale.filter(ImageFilter.SHARPEN)


def _ocr_image(image: Image.Image, document_type: str) -> str:
    import pytesseract

    timeout = float(getattr(settings, "EMPLOYEE_DOCUMENT_OCR_TIMEOUT_SECONDS", 20))
    prepared = _prepare_image(image)
    language = "eng" if document_type == EmployeeDocument.DocumentType.PASSPORT else "eng+ara"
    rotations = (0, 90, 180, 270) if document_type == EmployeeDocument.DocumentType.PASSPORT else (0,)
    if document_type == EmployeeDocument.DocumentType.PASSPORT:
        width, height = prepared.size
        mrz_regions = (
            prepared.crop((0, int(height * 0.55), width, height)),
            prepared.crop((0, int(height * 0.70), width, height)),
        )
        for region in mrz_regions:
            for rotation in rotations:
                candidate = region.rotate(rotation, expand=True) if rotation else region
                for psm in (6, 11, 12):
                    text = pytesseract.image_to_string(
                        candidate,
                        lang=language,
                        config=f"--oem 1 --psm {psm}",
                        timeout=timeout,
                    ).strip()
                    clean_text = re.sub(r"[^A-Z0-9<]", "", text.upper())
                    if re.search(r"P\s*<\s*[A-Z]{3}", text.upper()) or "P<" in clean_text:
                        return text
    best_text = ""
    best_score = -1
    for rotation in rotations:
        candidate = prepared.rotate(rotation, expand=True) if rotation else prepared
        text = pytesseract.image_to_string(
            candidate,
            lang=language,
            config="--oem 1 --psm 6",
            timeout=timeout,
        ).strip()
        mrz_score = 10000 if re.search(r"P\s*<\s*[A-Z]{3}", text.upper()) else 0
        keyword_score = sum(
            text.lower().count(keyword) for keyword in ("passport", "nationality", "expiry", "iqama", "هوية", "الجنسية")
        )
        score = mrz_score + (keyword_score * 100) + len(re.findall(r"[A-Za-z0-9]", text))
        if score > best_score:
            best_text = text
            best_score = score
        if mrz_score:
            break
    return best_text


def _extract_document_text(document: EmployeeDocument) -> str:
    data = _read_file_bytes(document.file)
    extension = Path(document.original_filename or document.file.name).suffix.lower()
    if extension == ".pdf":
        embedded_text = _extract_pdf_text(data).strip()
        if len(re.sub(r"\s+", "", embedded_text)) >= 25:
            return embedded_text
        return "\n".join(_ocr_image(image, document.document_type) for image in _render_pdf_images(data)).strip()

    with Image.open(BytesIO(data)) as image:
        return _ocr_image(image.copy(), document.document_type)


def _clean_mrz_line(line: str) -> str:
    return re.sub(r"[^A-Z0-9<]", "", line.upper())


def _extract_passport_mrz(text: str) -> dict[str, str]:
    lines = [_clean_mrz_line(line) for line in text.splitlines()]
    lines = [line for line in lines if len(line) >= 35]
    first_index = next((index for index, line in enumerate(lines) if line.startswith("P<")), None)
    if first_index is None or first_index + 1 >= len(lines):
        return {}

    first = lines[first_index].ljust(44, "<")[:44]
    second = lines[first_index + 1].ljust(44, "<")[:44]
    name_parts = first[5:44].split("<<", 1)
    surname = name_parts[0].replace("<", " ").strip()
    given_names = name_parts[1].replace("<", " ").strip() if len(name_parts) > 1 else ""
    return {
        "passport_number": second[0:9].replace("<", "").strip(),
        "full_name": " ".join(part for part in (given_names, surname) if part),
        "nationality": second[10:13].replace("<", "").strip(),
        "date_of_birth": _mrz_date(second[13:19]),
        "expiry_date": _mrz_date(second[21:27], future=True),
    }


def _label_value(text: str, labels: str, value_pattern: str = r"[^\n|]+") -> str:
    return _first_match(rf"(?:{labels})\s*[:|]?\s*({value_pattern})", text)


def _normalize_digits(value: str) -> str:
    return value.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))


def _extract_identity_fields(document_type: str, text: str) -> dict[str, str]:
    fields = _extract_passport_mrz(text) if document_type == EmployeeDocument.DocumentType.PASSPORT else {}
    common_patterns = {
        "full_name": r"Full\s*Name|Name|الاسم",
        "nationality": r"Nationality|الجنسية",
        "date_of_birth": r"Date\s*of\s*Birth|Birth\s*Date|DOB|تاريخ\s*الميلاد",
        "issue_date": r"Date\s*of\s*Issue|Issue\s*Date|تاريخ\s*الإصدار",
        "expiry_date": r"Date\s*of\s*Expiry|Expiry\s*Date|تاريخ\s*الانتهاء",
        "profession": r"Profession|Occupation|المهنة",
    }
    for key, labels in common_patterns.items():
        value = _label_value(text, labels)
        if value and not fields.get(key):
            fields[key] = value

    if not fields.get("full_name"):
        fallback_name = _first_match(r"^\s*([A-Z]{2,}(?:\s+[A-Z]{2,}){2,})\s*$", text)
        if fallback_name and re.fullmatch(r"[A-Z][A-Z ]{7,}", fallback_name):
            fields["full_name"] = fallback_name
    if not fields.get("nationality"):
        if re.search(r"^\s*مصر\s*$", text, flags=re.MULTILINE):
            fields["nationality"] = "Egypt"
        elif re.search(r"\bEGYPT(?:IAN)?\b", text, flags=re.IGNORECASE):
            fields["nationality"] = "Egyptian"

    if document_type == EmployeeDocument.DocumentType.PASSPORT:
        passport_number = _label_value(text, r"Passport\s*(?:Number|No\.?|#)", r"[A-Z0-9< -]{5,20}")
        if passport_number:
            fields["passport_number"] = passport_number.replace(" ", "").replace("<", "")
    else:
        iqama_number = _label_value(
            text,
            r"(?:Iqama|ID|Identity)\s*(?:Number|No\.?|#)|رقم\s*(?:الهوية|الإقامة)",
            r"[0-9٠-٩ -]{8,20}",
        )
        if not iqama_number:
            iqama_number = _first_match(r"(?<!\d)([0-9٠-٩]{10})(?!\d)", text)
        if iqama_number:
            fields["iqama_number"] = _normalize_digits(re.sub(r"[^0-9٠-٩]", "", iqama_number))
        iqama_expiry = _label_value(text, r"Iqama\s*Expiry|ID\s*Expiry|تاريخ\s*انتهاء\s*الإقامة")
        if not iqama_expiry:
            iqama_expiry = _first_match(
                r"([0-9٠-٩]{1,4}[/-][0-9٠-٩]{1,2}[/-][0-9٠-٩]{1,4})\s*(?:تاريخ\s*)?(?:الانتهاء|الإنتهاء)",
                text,
            )
        if iqama_expiry:
            fields["iqama_expiry_date"] = _normalize_digits(iqama_expiry)
        if not fields.get("profession"):
            profession = _first_match(r"^\s*((?:عامل|مهندس|فني|طبيب|مدير)[^\n]*)$", text)
            if profession:
                fields["profession"] = profession

    return {key: value.strip() for key, value in fields.items() if value and value.strip()}


def _extract_visa_values(text: str) -> dict[str, str]:
    return {
        "visa_number": _first_match(r"Visa\s+Number\s*:\s*([A-Za-z0-9-]+)", text),
        "exit_before_raw": _first_match(r"Exit\s+Before\s*:\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4})", text),
        "visa_duration_raw": _first_match(r"Visa\s+Duration\s*:\s*([0-9]+)", text),
    }


def _save_extraction_failure(document: EmployeeDocument, message: str) -> list[str]:
    document.extraction_status = EmployeeDocument.ExtractionStatus.FAILED
    document.extraction_error = message
    document.save(update_fields=["extraction_status", "extraction_error", "updated_at"])
    return [message]


def extract_document_fields(document: EmployeeDocument) -> list[str]:
    """Extract fields for the stored classification without ever changing document_type."""
    if document.document_type not in OCR_DOCUMENT_TYPES:
        document.extraction_status = EmployeeDocument.ExtractionStatus.SUCCESS
        document.extraction_error = ""
        document.save(update_fields=["extraction_status", "extraction_error", "updated_at"])
        return []

    try:
        text = _extract_document_text(document)
    except Exception:
        logger.exception("employee_document_ocr_failed", extra={"document_id": document.id})
        return _save_extraction_failure(document, "Document OCR failed. Check the OCR worker logs.")
    if not text.strip():
        return _save_extraction_failure(document, "Document OCR did not detect readable text.")

    if document.document_type == EmployeeDocument.DocumentType.VISA:
        fields = _extract_visa_values(text)
        required_fields = ("visa_number", "exit_before_raw", "visa_duration_raw")
        document.visa_number = fields["visa_number"]
        document.exit_before_raw = fields["exit_before_raw"]
        document.exit_before = _parse_date(fields["exit_before_raw"])
        document.visa_duration_raw = fields["visa_duration_raw"]
        document.visa_duration = int(fields["visa_duration_raw"]) if fields["visa_duration_raw"].isdigit() else None
    else:
        fields = _extract_identity_fields(document.document_type, text)
        required_fields = (
            ("passport_number", "full_name", "nationality", "date_of_birth", "expiry_date")
            if document.document_type == EmployeeDocument.DocumentType.PASSPORT
            else ("iqama_number", "full_name", "nationality", "iqama_expiry_date")
        )

    missing = [field.replace("_", " ").title() for field in required_fields if not fields.get(field)]
    document.extracted_fields = {**fields, "raw_text": text}
    document.extraction_error = ""
    document.extraction_status = (
        EmployeeDocument.ExtractionStatus.SUCCESS if not missing else EmployeeDocument.ExtractionStatus.PARTIAL
    )
    update_fields = ["extracted_fields", "extraction_error", "extraction_status", "updated_at"]
    if document.document_type == EmployeeDocument.DocumentType.VISA:
        update_fields.extend(["visa_number", "exit_before", "exit_before_raw", "visa_duration", "visa_duration_raw"])
    document.save(update_fields=update_fields)
    return [f"Could not extract: {', '.join(missing)}."] if missing else []


def extract_visa_fields(document: EmployeeDocument) -> list[str]:
    """Backward-compatible entry point used by the business-trip completion workflow."""
    if document.document_type != EmployeeDocument.DocumentType.VISA:
        return []
    return extract_document_fields(document)
