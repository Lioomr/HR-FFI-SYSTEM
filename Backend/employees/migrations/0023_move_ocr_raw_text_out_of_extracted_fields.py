"""Move legacy OCR transcripts out of the API-visible extracted_fields JSON.

Before the PaddleOCR pilot, `extract_document_fields` stored the whole OCR
transcript under `extracted_fields["raw_text"]`, and that field is serialised to
HR clients. The transcript is a verbatim copy of a passport or ID card, so it
moves into the private `extraction_raw_text` column. No document is re-OCR'd.
"""

from django.db import migrations

RESERVED_KEYS = ("raw_text", "ocr_raw_text", "raw_ocr_text")
BATCH_SIZE = 500


def move_raw_text(apps, schema_editor):
    EmployeeDocument = apps.get_model("employees", "EmployeeDocument")
    pending = []
    queryset = EmployeeDocument.objects.exclude(extracted_fields={}).only(
        "id", "extracted_fields", "extraction_raw_text"
    )
    for document in queryset.iterator(chunk_size=BATCH_SIZE):
        fields = document.extracted_fields
        if not isinstance(fields, dict):
            continue
        transcript = ""
        changed = False
        for key in RESERVED_KEYS:
            if key in fields:
                transcript = transcript or str(fields.pop(key) or "")
                changed = True
        if not changed:
            continue
        document.extracted_fields = fields
        if transcript and not document.extraction_raw_text:
            document.extraction_raw_text = transcript
        pending.append(document)
        if len(pending) >= BATCH_SIZE:
            EmployeeDocument.objects.bulk_update(pending, ["extracted_fields", "extraction_raw_text"])
            pending = []
    if pending:
        EmployeeDocument.objects.bulk_update(pending, ["extracted_fields", "extraction_raw_text"])


def restore_raw_text(apps, schema_editor):
    """Reverse only the move; the column keeps its copy either way."""

    EmployeeDocument = apps.get_model("employees", "EmployeeDocument")
    pending = []
    queryset = EmployeeDocument.objects.exclude(extraction_raw_text="").only(
        "id", "extracted_fields", "extraction_raw_text"
    )
    for document in queryset.iterator(chunk_size=BATCH_SIZE):
        fields = document.extracted_fields if isinstance(document.extracted_fields, dict) else {}
        if fields.get("raw_text"):
            continue
        fields["raw_text"] = document.extraction_raw_text
        document.extracted_fields = fields
        pending.append(document)
        if len(pending) >= BATCH_SIZE:
            EmployeeDocument.objects.bulk_update(pending, ["extracted_fields"])
            pending = []
    if pending:
        EmployeeDocument.objects.bulk_update(pending, ["extracted_fields"])


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0022_employeedocument_ocr_extraction_metadata"),
    ]

    operations = [
        migrations.RunPython(move_raw_text, restore_raw_text),
    ]
