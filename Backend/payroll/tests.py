from decimal import Decimal
from types import SimpleNamespace

from payroll.views import _build_payroll_report_pdf, _build_simple_lines_pdf


def test_build_payroll_report_pdf_returns_pdf_bytes():
    run = SimpleNamespace(
        id=7,
        month=2,
        year=2026,
        status="COMPLETED",
        total_employees=1,
        total_net=Decimal("5200.00"),
    )
    items = [
        SimpleNamespace(
            employee_id="EMP-001",
            employee_name="Jane Doe",
            department="Finance",
            position="Analyst",
            basic_salary=Decimal("4000.00"),
            total_allowances=Decimal("1500.00"),
            total_deductions=Decimal("300.00"),
            net_salary=Decimal("5200.00"),
        )
    ]

    pdf_bytes = _build_payroll_report_pdf(run, items)

    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 500


def test_build_simple_lines_pdf_returns_pdf_bytes():
    pdf_bytes = _build_simple_lines_pdf("Payslip 21", ["Period: 2026-02", "Net Salary: 5200.00"])

    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
