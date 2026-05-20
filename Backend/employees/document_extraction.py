import re
from datetime import datetime

from .models import EmployeeDocument


def _first_match(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _parse_exit_before(raw_value: str):
    value = (raw_value or "").strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _extract_pdf_text(file_field) -> str:
    from pypdf import PdfReader

    file_field.open("rb")
    try:
        reader = PdfReader(file_field)
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    finally:
        file_field.close()


def extract_visa_fields(document: EmployeeDocument) -> list[str]:
    warnings = []
    if document.document_type != EmployeeDocument.DocumentType.VISA:
        document.extraction_status = EmployeeDocument.ExtractionStatus.PENDING
        document.extracted_fields = {}
        document.extraction_error = ""
        document.save(update_fields=["extraction_status", "extracted_fields", "extraction_error", "updated_at"])
        return warnings

    try:
        text = _extract_pdf_text(document.file)
    except Exception as exc:
        document.extraction_status = EmployeeDocument.ExtractionStatus.FAILED
        document.extraction_error = str(exc)
        document.extracted_fields = {}
        document.save(update_fields=["extraction_status", "extraction_error", "extracted_fields", "updated_at"])
        return ["Visa document could not be read for extraction."]

    visa_number = _first_match(r"Visa\s+Number\s*:\s*([A-Za-z0-9-]+)", text)
    exit_before_raw = _first_match(r"Exit\s+Before\s*:\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4})", text)
    visa_duration_raw = _first_match(r"Visa\s+Duration\s*:\s*([0-9]+)", text)
    exit_before = _parse_exit_before(exit_before_raw)
    visa_duration = int(visa_duration_raw) if visa_duration_raw.isdigit() else None

    missing = []
    if not visa_number:
        missing.append("Visa Number")
    if not exit_before_raw:
        missing.append("Exit Before")
    if not visa_duration_raw:
        missing.append("Visa Duration")
    if exit_before_raw and exit_before is None:
        warnings.append("Exit Before was extracted but could not be normalized as a date.")

    extracted_fields = {
        "visa_number": visa_number,
        "exit_before_raw": exit_before_raw,
        "visa_duration_raw": visa_duration_raw,
        "raw_text": text,
    }
    if missing:
        warnings.append(f"Could not extract: {', '.join(missing)}.")

    document.visa_number = visa_number
    document.exit_before = exit_before
    document.exit_before_raw = exit_before_raw
    document.visa_duration = visa_duration
    document.visa_duration_raw = visa_duration_raw
    document.extracted_fields = extracted_fields
    document.extraction_error = ""
    document.extraction_status = (
        EmployeeDocument.ExtractionStatus.SUCCESS
        if not missing and exit_before is not None
        else EmployeeDocument.ExtractionStatus.PARTIAL
    )
    document.save(
        update_fields=[
            "visa_number",
            "exit_before",
            "exit_before_raw",
            "visa_duration",
            "visa_duration_raw",
            "extracted_fields",
            "extraction_error",
            "extraction_status",
            "updated_at",
        ]
    )
    return warnings
