from types import SimpleNamespace

from assets.models import AssetDamageReport, AssetReturnRequest
from assets.services.label_pdf import render_labels_pdf
from assets.views import _build_damage_report_pdf, _build_return_request_pdf


def _make_profile():
    return SimpleNamespace(
        full_name_en="Jane Doe",
        full_name=None,
        employee_id="E-002",
        department_name_en="Operations",
        department="Operations",
        job_title_en="Operator",
        job_title="Operator",
        national_id="1111111111",
        mobile="+966511111111",
        user=SimpleNamespace(full_name="Jane Doe", email="jane@ffi.com"),
    )


def _make_asset():
    return SimpleNamespace(
        asset_code="LAP-00042",
        name_en="Dell Laptop",
        name_ar="حاسوب ديل",
        type="LAPTOP",
        serial_number="SN-99",
    )


def test_build_damage_report_pdf_returns_pdf_bytes():
    report = SimpleNamespace(
        id=11,
        asset=_make_asset(),
        employee=_make_profile(),
        description="Screen cracked",
        status=AssetDamageReport.RequestStatus.PENDING_HR,
        reported_at=None,
        hr_decision_by=None,
        hr_decision_at=None,
        hr_decision_note="",
        ceo_decision_by=None,
        ceo_decision_at=None,
        ceo_decision_note="",
    )

    pdf_bytes = _build_damage_report_pdf(report)
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 500


def test_build_return_request_pdf_returns_pdf_bytes():
    req = SimpleNamespace(
        id=12,
        asset=_make_asset(),
        employee=_make_profile(),
        note="No longer needed",
        status=AssetReturnRequest.RequestStatus.PENDING,
        requested_at=None,
        manager_decision_by=None,
        manager_decision_at=None,
        manager_decision_note="",
        hr_decision_by=None,
        hr_decision_at=None,
        hr_decision_note="",
        ceo_decision_by=None,
        ceo_decision_at=None,
        ceo_decision_note="",
        processed_by=None,
        processed_at=None,
    )

    pdf_bytes = _build_return_request_pdf(req)
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 500


def test_render_labels_pdf_returns_pdf_bytes():
    asset = SimpleNamespace(
        asset_code="LAP-00042",
        name_en="Dell Laptop",
        name_ar="حاسوب ديل",
        company=SimpleNamespace(name="FFI"),
    )

    pdf_bytes = render_labels_pdf([asset], "50X30")

    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 500


def test_render_labels_pdf_arabic_name_does_not_crash():
    asset = SimpleNamespace(
        asset_code="LAP-00099",
        name_en="",
        name_ar="حاسوب محمول",
        company=SimpleNamespace(name="شركة"),
    )

    pdf_bytes = render_labels_pdf(
        [asset], "60X40", name_language="ar", qr_base_url="https://hr.example.com"
    )

    assert pdf_bytes.startswith(b"%PDF")
