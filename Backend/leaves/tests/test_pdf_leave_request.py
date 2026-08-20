from io import BytesIO
from pathlib import Path

from django.conf import settings
from pypdf import PdfReader

from leaves.pdf_leave_request import load_field_map, render_leave_request_pdf


def test_field_map_uses_one_page_rtl_date_flow():
    field_map = load_field_map()

    assert field_map["start_date"]["page"] == 1
    assert field_map["end_date"]["page"] == 1
    assert field_map["start_date"]["x"] > field_map["end_date"]["x"]


def test_field_map_contains_final_fields_and_excludes_hr_only_fields():
    field_map = load_field_map()
    required = {
        "reference_no",
        "request_date",
        "employee_name",
        "employee_id",
        "department",
        "job_title",
        "line_manager",
        "work_location",
        "contact_no",
        "email",
        "leave_type",
        "leave_balance_days",
        "end_date",
        "start_date",
        "total_days_requested",
        "will_travel",
        "reason",
        "address_during_leave",
        "contact_no_during_leave",
        "substitute_employee_id",
        "substitute_employee_name",
        "substitute_department",
        "substitute_notes",
        "destination",
        "travel_date",
        "return_date",
        "ticket_required",
        "manager_recommended",
        "approval_date",
        "approval_comments",
        "employee_signature",
        "employee_signature_date",
        "line_manager_signature",
        "line_manager_signature_date",
        "department_head_signature",
        "department_head_signature_date",
        "hr_signature",
        "hr_signature_date",
    }
    removed = {
        "cost_center",
        "employment_type",
        "is_half_day",
        "half_day_type",
        "hr_received_date",
        "processed_by",
        "hr_remarks",
        "hr_use_only",
        "leave_balance_after_approval",
        "date_approved",
    }

    assert required <= field_map.keys()
    assert removed.isdisjoint(field_map)


def test_rendered_leave_request_is_one_page_and_contains_overlay_values():
    template = Path(settings.BASE_DIR) / "static" / "pdf_templates" / "leave_request_blank.pdf"
    values = {
        "reference_no": "LR-01234",
        "employee_name": "A Very Long Employee Name for PDF Layout Verification",
        "department": "إدارة المشاريع والعمليات",
        "end_date": "2026-09-19",
        "start_date": "2026-09-14",
        "reason": "ظرف عائلي يتطلب السفر خلال فترة الإجازة",
        "manager_recommended": True,
        "ticket_required": False,
    }

    rendered = render_leave_request_pdf(template, values)
    reader = PdfReader(BytesIO(rendered))
    extracted = "\n".join(page.extract_text() or "" for page in reader.pages)

    assert len(reader.pages) == 1
    assert "LR-01234" in extracted
    assert "2026-09-14" in extracted
    assert "2026-09-19" in extracted
