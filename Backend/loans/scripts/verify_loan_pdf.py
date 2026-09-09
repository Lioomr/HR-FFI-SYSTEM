"""Generate a representative loan PDF and a PNG for manual visual QA.

The default destination is the operating-system temp directory so evidence is
not added to tracked source files.  Run from ``Backend``:

    python loans/scripts/verify_loan_pdf.py
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace


def _sample() -> SimpleNamespace:
    def actor(name: str) -> SimpleNamespace:
        return SimpleNamespace(full_name=name, email=f"{name.lower().replace(' ', '.')}@ffi.example")

    created = datetime(2026, 9, 3, 10, 30, tzinfo=timezone.utc)
    return SimpleNamespace(
        id=20260903,
        employee=actor("Aisha Al Harbi"),
        employee_profile=SimpleNamespace(
            full_name_en="Aisha Al Harbi / عائشة الحربي",
            full_name_ar="عائشة الحربي",
            employee_id="FFI-2048",
            department_name_en="Operations and Project Delivery",
            job_title_en="Senior Project Coordination Specialist",
            mobile="+966 50 123 4567",
            basic_salary=Decimal("12500.00"),
        ),
        status="pending_disbursement",
        loan_type="installment",
        requested_amount=Decimal("10000.00"),
        installment_months=10,
        target_deduction_year=2026,
        target_deduction_month=10,
        approved_year=2026,
        approved_month=9,
        deduction_payroll_run_id=None,
        reason=(
            "Family medical expenses and temporary relocation costs. "
            "طلب سلفة لتغطية المصاريف الطبية العائلية وتكاليف الانتقال المؤقت."
        ),
        created_at=created,
        manager_decision_by=actor("Mona Al Qahtani"),
        manager_decision_at=created,
        manager_recommendation="approve",
        finance_decision_by=actor("Khalid Al Otaibi"),
        finance_decision_at=created,
        hr_recommendation="approve",
        cfo_decision_by=actor("Nora Al Zahrani"),
        cfo_decision_at=created,
        ceo_decision_by=None,
        ceo_decision_at=None,
        disbursed_by=None,
        disbursed_at=None,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path(tempfile.gettempdir()) / "ffi-loan-pdf-qa")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    backend_root = Path(__file__).resolve().parents[2]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django

    django.setup()
    import pymupdf

    from loans.pdf_loan_request import build_loan_request_pdf

    def map_unavailable(_: object) -> bytes:
        raise RuntimeError("Loan field map is unavailable.")

    pdf_bytes = build_loan_request_pdf(_sample(), fallback=map_unavailable)
    pdf_path = args.output_dir / "loan-request-representative.pdf"
    png_path = args.output_dir / "loan-request-representative-page-1.png"
    pdf_path.write_bytes(pdf_bytes)
    document = pymupdf.open(pdf_path)
    document[0].get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False).save(png_path)
    print(f"PDF: {pdf_path}")
    print(f"PNG: {png_path}")


if __name__ == "__main__":
    main()
