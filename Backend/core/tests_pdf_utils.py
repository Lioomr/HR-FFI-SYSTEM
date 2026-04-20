"""Tests for pypdf-backed helpers in core.pdf (watermark, merge, encrypt)."""

from pypdf import PdfReader

from core.pdf import (
    RequestDocument,
    apply_watermark,
    encrypt_pdf,
    merge_pdfs,
    render_request_pdf,
    watermark_for_status,
)


def _sample_pdf(status: str = "") -> bytes:
    return render_request_pdf(
        RequestDocument(
            title_en="Test Doc",
            title_ar="وثيقة اختبار",
            reference_no="T-1",
            status_label=status,
        )
    )


def test_watermark_for_status_maps_draft_and_cancel():
    assert watermark_for_status("DRAFT") == "DRAFT"
    assert watermark_for_status("PENDING_HR") == "DRAFT"
    assert watermark_for_status("CANCELLED") == "CANCELLED"
    assert watermark_for_status("CANCELED") == "CANCELLED"
    assert watermark_for_status("APPROVED") == ""
    assert watermark_for_status("") == ""


def test_apply_watermark_returns_bytes_and_keeps_page_count():
    base = _sample_pdf()
    stamped = apply_watermark(base, "DRAFT")
    assert stamped.startswith(b"%PDF")
    assert len(PdfReader(__import__("io").BytesIO(stamped)).pages) == len(
        PdfReader(__import__("io").BytesIO(base)).pages
    )


def test_render_request_pdf_auto_watermarks_draft_status():
    without = _sample_pdf()
    with_draft = _sample_pdf("DRAFT")
    assert without != with_draft


def test_merge_pdfs_combines_page_counts():
    a = _sample_pdf()
    b = _sample_pdf()
    merged = merge_pdfs([a, b])
    assert merged.startswith(b"%PDF")
    pa = len(PdfReader(__import__("io").BytesIO(a)).pages)
    pm = len(PdfReader(__import__("io").BytesIO(merged)).pages)
    assert pm == pa * 2


def test_encrypt_pdf_produces_encrypted_reader():
    import io as _io

    encrypted = encrypt_pdf(_sample_pdf(), user_password="secret123")
    reader = PdfReader(_io.BytesIO(encrypted))
    assert reader.is_encrypted
    assert reader.decrypt("secret123")
