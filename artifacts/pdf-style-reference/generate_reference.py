"""Create a fictional visual reference using the production PDF overlay renderer."""

from pathlib import Path
import os
import sys


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "Backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from core.pdf_forms import load_form_assets, render_mapped_form  # noqa: E402


OUTPUT = Path(__file__).with_name("leave-request-auto-filled-reference.pdf")


def main() -> None:
    assets = load_form_assets(
        "leave_request_blank.pdf",
        "leave_request_blank_field_map.json",
        aliases=["leave-request-template.pdf"],
    )
    if assets is None:
        raise RuntimeError("The leave PDF template and colocated field map could not be resolved.")

    # Deliberately fictional values. This demonstrates the live mapping and layout
    # without copying a real employee, request, or signature.
    values = {
        "reference_no": "STYLE-REFERENCE-001",
        "request_date": "2026-09-14",
        "filed_date": "2026-09-14",
        "employee_name": "Sample Employee",
        "employee_id": "EMP-00042",
        "department": "Operations",
        "job_title": "Operations Coordinator",
        "line_manager": "Sample Manager",
        "work_location": "Head Office",
        "contact_no": "+966 50 000 0000",
        "email": "sample.employee@example.test",
        "leave_type": "Annual Leave / إجازة سنوية",
        "leave_balance_days": "18",
        "start_date": "2026-10-04",
        "end_date": "2026-10-08",
        "total_days_requested": "5",
        "will_travel": True,
        "reason": "Planned annual leave.",
        "address_during_leave": "Riyadh, Saudi Arabia",
        "contact_no_during_leave": "+966 50 000 0000",
        "substitute_employee_id": "EMP-00073",
        "substitute_employee_name": "Coverage Employee",
        "substitute_department": "Operations",
        "substitute_notes": "Cover daily handover and urgent requests.",
        "destination": "Riyadh, Saudi Arabia",
        "travel_date": "2026-10-04",
        "return_date": "2026-10-08",
        "ticket_required": False,
        "employee_signature_date": "2026-09-14",
        "line_manager_signature_date": "2026-09-15",
        "department_head_signature_date": "",
        "hr_signature_date": "",
    }
    pdf_bytes, _diagnostics = render_mapped_form(assets, values)
    OUTPUT.write_bytes(pdf_bytes)
    print(OUTPUT)


if __name__ == "__main__":
    main()
