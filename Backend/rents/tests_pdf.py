from decimal import Decimal
from types import SimpleNamespace

from rents.models import Rent
from rents.views import _build_rent_pdf


def test_build_rent_pdf_returns_pdf_bytes():
    rent_type = SimpleNamespace(name_en="Office Lease", name_ar="إيجار مكتب", code="OFFICE")
    rent = SimpleNamespace(
        id=7,
        rent_type=rent_type,
        asset=None,
        property_name_en="HQ Building",
        property_name_ar="مبنى الإدارة",
        property_address="Riyadh",
        recurrence=Rent.Recurrence.MONTHLY,
        lease_start_date=None,
        lease_end_date=None,
        annual_rent_value=Decimal("60000.00"),
        security_deposit=Decimal("5000.00"),
        payment_schedule="Monthly on the 1st",
        auto_renewal=True,
        notice="30 days",
        amount=Decimal("5000.00"),
        one_time_due_date=None,
        start_date=None,
        due_day=1,
        created_by=SimpleNamespace(full_name="HR Admin", email="hr@ffi.com"),
        updated_by=SimpleNamespace(full_name="HR Admin", email="hr@ffi.com"),
        created_at=None,
        updated_at=None,
    )

    pdf_bytes = _build_rent_pdf(rent)
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 500
