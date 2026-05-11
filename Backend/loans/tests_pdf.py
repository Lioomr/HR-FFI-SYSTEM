from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace

from pypdf import PdfReader

from loans.models import LoanRequest
from loans.views import _build_loan_request_pdf


def test_build_loan_request_pdf_returns_pdf_bytes():
    profile = SimpleNamespace(
        full_name_en="John Smith",
        full_name=None,
        employee_id="E-001",
        department_name_en="Finance",
        department="Finance",
        job_title_en="Accountant",
        job_title="Accountant",
        national_id="1234567890",
        mobile="+966500000000",
    )
    employee = SimpleNamespace(full_name="John Smith", email="john@ffi.com")

    instance = SimpleNamespace(
        id=42,
        employee=employee,
        employee_profile=profile,
        status=LoanRequest.RequestStatus.PENDING_HR,
        loan_type=LoanRequest.LoanType.INSTALLMENT,
        requested_amount=Decimal("10000.00"),
        approved_amount=None,
        installment_months=10,
        target_deduction_year=2026,
        target_deduction_month=5,
        reason="Family medical expenses",
        created_at=None,
        manager_decision_by=None,
        manager_decision_at=None,
        manager_decision_note="",
        manager_recommendation=None,
        finance_decision_by=None,
        finance_decision_at=None,
        finance_decision_note="",
        hr_recommendation=None,
        cfo_decision_by=None,
        cfo_decision_at=None,
        cfo_decision_note="",
        ceo_decision_by=None,
        ceo_decision_at=None,
        ceo_decision_note="",
        disbursed_by=None,
        disbursed_at=None,
        disbursement_note="",
    )

    pdf_bytes = _build_loan_request_pdf(instance)

    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 500
    reader = PdfReader(BytesIO(pdf_bytes))
    extracted_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert len(reader.pages) == 1
    assert "Loan Request" in extracted_text
    assert "Installment Loan" in extracted_text
    assert "pending_hr" not in extracted_text
