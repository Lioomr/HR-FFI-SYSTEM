from __future__ import annotations

import json
import os
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

from django.conf import settings
from django.utils import timezone
from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from core.views_templates import resolve_template_path

from .utils import calculate_leave_balance, get_leave_days

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except ImportError:  # pragma: no cover - optional dependency guard
    arabic_reshaper = None
    get_display = None


FIELD_MAP_FILENAME = "leave_request_blank_field_map.json"

LEAVE_TYPE_ARABIC = {
    "ANNUAL": "إجازة سنوية",
    "ANNUAL_LEAVE": "إجازة سنوية",
    "SICK": "إجازة مرضية",
    "SICK_LEAVE": "إجازة مرضية",
    "EMERGENCY": "إجازة طارئة",
    "EMERGENCY_LEAVE": "إجازة طارئة",
    "UNPAID": "إجازة بدون راتب",
    "UNPAID_LEAVE": "إجازة بدون راتب",
    "MARRIAGE": "إجازة زواج",
    "DEATH": "إجازة وفاة",
    "BIRTH": "إجازة مولود",
    "MATERNITY": "إجازة أمومة",
}


def _register_fonts() -> tuple[str, str]:
    candidates = {
        "LeavePDFRegular": [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            r"C:\Windows\Fonts\arial.ttf",
        ],
        "LeavePDFBold": [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            r"C:\Windows\Fonts\arialbd.ttf",
        ],
    }
    selected = {"LeavePDFRegular": "Helvetica", "LeavePDFBold": "Helvetica-Bold"}
    registered = set(pdfmetrics.getRegisteredFontNames())
    for name, paths in candidates.items():
        if name in registered:
            selected[name] = name
            continue
        for path in paths:
            if os.path.exists(path):
                pdfmetrics.registerFont(TTFont(name, path))
                selected[name] = name
                break
    return selected["LeavePDFRegular"], selected["LeavePDFBold"]


def _shape_arabic(value: Any) -> str:
    text = str(value or "").strip()
    if text and arabic_reshaper and get_display and any("\u0600" <= char <= "\u06ff" for char in text):
        return get_display(arabic_reshaper.reshape(text))
    return text


def _is_arabic_heavy(value: Any) -> bool:
    text = str(value or "")
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return False
    arabic = sum("\u0600" <= char <= "\u06ff" for char in letters)
    return arabic >= len(letters) / 2


def _format_date(value: Any) -> str:
    if not value:
        return ""
    try:
        if hasattr(value, "hour"):
            value = timezone.localtime(value)
        return value.strftime("%Y-%m-%d")
    except (AttributeError, TypeError, ValueError):
        return str(value)


def _format_number(value: Any) -> str:
    if value in (None, ""):
        return ""
    try:
        number = float(value)
        return str(int(number)) if number.is_integer() else f"{number:.2f}".rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        return str(value)


def _profile_for(instance) -> Any:
    profile = getattr(instance, "employee_profile", None)
    if profile:
        return profile
    employee = getattr(instance, "employee", None)
    try:
        return employee.employee_profile if employee else None
    except Exception:
        return None


def _user_profile(user) -> Any:
    try:
        return user.employee_profile if user else None
    except Exception:
        return None


def _display_name(user=None, profile=None) -> str:
    profile = profile or _user_profile(user)
    if profile:
        value = (
            getattr(profile, "full_name_en", "")
            or getattr(profile, "full_name", "")
            or getattr(profile, "full_name_ar", "")
        )
        if value:
            return str(value)
    return str(getattr(user, "full_name", "") or getattr(user, "email", "") or "")


def _manager_user_and_profile(profile) -> tuple[Any, Any]:
    if not profile:
        return None, None
    manager_profile = getattr(profile, "manager_profile", None)
    if manager_profile:
        return getattr(manager_profile, "user", None), manager_profile
    manager_user = getattr(profile, "manager", None)
    return manager_user, _user_profile(manager_user)


def _leave_balance(instance, profile) -> str:
    employee = getattr(instance, "employee", None)
    if not employee or not profile:
        return ""
    try:
        balances = calculate_leave_balance(employee, instance.start_date.year, profile=profile)
    except Exception:
        return ""
    for balance in balances:
        if balance.get("leave_type_id") == getattr(instance, "leave_type_id", None):
            return _format_number(balance.get("remaining_days"))
    return ""


def _leave_type_value(leave_type) -> str:
    name = str(getattr(leave_type, "name", "") or "")
    code = str(getattr(leave_type, "code", "") or name).strip().upper().replace(" ", "_")
    arabic = LEAVE_TYPE_ARABIC.get(code, "")
    if arabic and arabic not in name:
        return f"{name} / {arabic}"
    return name


def build_leave_request_values(instance) -> dict[str, Any]:
    profile = _profile_for(instance)
    employee = getattr(instance, "employee", None)
    manager_user, manager_profile = _manager_user_and_profile(profile)
    delegated_user = getattr(instance, "delegated_to", None)
    delegated_profile = _user_profile(delegated_user)
    company = getattr(profile, "company", None) or getattr(instance, "company", None)
    task_group = getattr(profile, "task_group_ref", None) if profile else None

    manager_decided_at = getattr(instance, "manager_decision_at", None)
    manager_decided_by = getattr(instance, "manager_decision_by", None) or manager_user
    later_stage_decision = bool(
        getattr(instance, "ceo_decision_at", None)
        or getattr(instance, "decided_at", None)
        or getattr(instance, "hr_completed_at", None)
    )
    rejected_by_manager = bool(
        manager_decided_at
        and not later_stage_decision
        and getattr(instance, "status", "") == getattr(instance.RequestStatus, "REJECTED", "rejected")
    )
    manager_recommended = None
    if manager_decided_at:
        manager_recommended = not rejected_by_manager

    ceo_user = getattr(instance, "ceo_decision_by", None)
    hr_user = (
        getattr(instance, "hr_completed_by", None)
        or getattr(instance, "decided_by", None)
        or getattr(instance, "entered_by", None)
    )
    hr_date = getattr(instance, "hr_completed_at", None) or getattr(instance, "decided_at", None)

    destination = str(
        getattr(instance, "airplane_ticket_address", "")
        or getattr(instance, "other_leave_description", "")
        or ""
    )
    ticket_required = bool(
        getattr(instance, "airplane_ticket_payer", "") or getattr(instance, "airplane_ticket_address", "")
    )
    address_parts = [
        str(value)
        for value in (getattr(instance, "full_address", ""), getattr(instance, "po_box", ""))
        if value
    ]
    profile_mobile = str(getattr(profile, "mobile", "") or "")
    department = str(
        getattr(profile, "department_name_en", "")
        or getattr(profile, "department", "")
        or getattr(profile, "department_name_ar", "")
        or ""
    )
    delegated_department = str(
        getattr(delegated_profile, "department_name_en", "")
        or getattr(delegated_profile, "department", "")
        or getattr(delegated_profile, "department_name_ar", "")
        or ""
    )
    employee_name = _display_name(employee, profile)
    request_date = getattr(instance, "created_at", None)

    return {
        "reference_no": f"LR-{instance.id:05d}" if getattr(instance, "id", None) else "",
        "request_date": _format_date(request_date),
        "employee_name": employee_name,
        "employee_id": str(
            getattr(profile, "employee_number", "") or getattr(profile, "employee_id", "") or ""
        ),
        "department": department,
        "job_title": str(
            getattr(profile, "job_title_en", "")
            or getattr(profile, "job_title", "")
            or getattr(profile, "job_title_ar", "")
            or ""
        ),
        "line_manager": _display_name(manager_user, manager_profile),
        "work_location": str(getattr(task_group, "name", "") or getattr(company, "name", "") or ""),
        "contact_no": profile_mobile,
        "email": str(getattr(employee, "email", "") or ""),
        "leave_type": _leave_type_value(getattr(instance, "leave_type", None)),
        "leave_balance_days": _leave_balance(instance, profile),
        "end_date": _format_date(getattr(instance, "end_date", None)),
        "start_date": _format_date(getattr(instance, "start_date", None)),
        "total_days_requested": _format_number(
            get_leave_days(getattr(instance, "start_date", None), getattr(instance, "end_date", None))
        ),
        "will_travel": ticket_required,
        "reason": str(getattr(instance, "reason", "") or ""),
        "address_during_leave": " | ".join(address_parts),
        "contact_no_during_leave": profile_mobile,
        "substitute_employee_id": str(
            getattr(delegated_profile, "employee_number", "")
            or getattr(delegated_profile, "employee_id", "")
            or ""
        ),
        "substitute_employee_name": _display_name(delegated_user, delegated_profile),
        "substitute_department": delegated_department,
        "substitute_notes": str(getattr(instance, "delegation_note", "") or ""),
        "destination": destination,
        "travel_date": _format_date(getattr(instance, "start_date", None)),
        "return_date": _format_date(
            getattr(instance, "date_of_rejoin", None) or getattr(instance, "end_date", None)
        ),
        "ticket_required": ticket_required,
        "manager_recommended": manager_recommended,
        "approval_date": _format_date(manager_decided_at),
        "approval_comments": str(getattr(instance, "manager_decision_note", "") or ""),
        "employee_signature": employee_name,
        "employee_signature_date": _format_date(request_date),
        "line_manager_signature": _display_name(manager_decided_by) if manager_decided_at else "",
        "line_manager_signature_date": _format_date(manager_decided_at),
        "department_head_signature": _display_name(ceo_user) if getattr(instance, "ceo_decision_at", None) else "",
        "department_head_signature_date": _format_date(getattr(instance, "ceo_decision_at", None)),
        "hr_signature": _display_name(hr_user) if hr_date else "",
        "hr_signature_date": _format_date(hr_date),
    }


def load_field_map() -> dict[str, dict]:
    path = Path(settings.BASE_DIR) / "static" / "pdf_templates" / FIELD_MAP_FILENAME
    return json.loads(path.read_text(encoding="utf-8"))


def _fit_size(value: str, font_name: str, preferred: float, max_width: float, minimum: float = 5.1) -> float:
    size = preferred
    while size > minimum and pdfmetrics.stringWidth(value, font_name, size) > max_width:
        size -= 0.2
    return max(size, minimum)


def _wrap_lines(value: str, font_name: str, size: float, max_width: float, max_lines: int) -> list[str]:
    words = str(value or "").split()
    if not words:
        return []
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and pdfmetrics.stringWidth(_shape_arabic(candidate), font_name, size) > max_width:
            lines.append(current)
            current = word
            if len(lines) == max_lines:
                break
        else:
            current = candidate
    if current and len(lines) < max_lines:
        lines.append(current)
    return lines[:max_lines]


def _draw_field(pdf: canvas.Canvas, spec: dict, value: Any, font_name: str) -> None:
    text = str(value or "").strip()
    if not text:
        return
    x = float(spec["x"])
    y = float(spec["y"])
    width = float(spec["width"])
    height = float(spec["height"])
    preferred_size = float(spec.get("font_size", 7.5))
    padding = 4.0
    max_width = width - padding * 2
    is_rtl = _is_arabic_heavy(text)

    if spec.get("multiline"):
        size = preferred_size
        max_lines = int(spec.get("max_lines", 2))
        lines = _wrap_lines(text, font_name, size, max_width, max_lines)
        line_height = size + 1.2
        start_y = y + (height + len(lines) * line_height) / 2 - size
        pdf.setFont(font_name, size)
        pdf.setFillColorRGB(0.08, 0.08, 0.08)
        for index, line in enumerate(lines):
            shaped = _shape_arabic(line)
            line_y = start_y - index * line_height
            if _is_arabic_heavy(line):
                pdf.drawRightString(x + width - padding, line_y, shaped)
            else:
                pdf.drawString(x + padding, line_y, shaped)
        return

    shaped = _shape_arabic(text)
    size = _fit_size(shaped, font_name, preferred_size, max_width)
    pdf.setFont(font_name, size)
    pdf.setFillColorRGB(0.08, 0.08, 0.08)
    baseline = y + (height - size) / 2 + 1.4
    if is_rtl:
        pdf.drawRightString(x + width - padding, baseline, shaped)
    else:
        pdf.drawString(x + padding, baseline, shaped)


def _draw_checkbox(pdf: canvas.Canvas, spec: dict, selected: Any, font_name: str) -> None:
    if selected is None:
        return
    key = "yes" if bool(selected) else "no"
    center = spec.get("checkboxes", {}).get(key)
    if not center:
        return
    pdf.setFont(font_name, 8.5)
    pdf.setFillColorRGB(0, 0, 0)
    pdf.drawCentredString(float(center[0]), float(center[1]) - 3.1, "X")


def render_leave_request_pdf(template_path: str | Path, values: dict[str, Any]) -> bytes:
    field_map = load_field_map()
    reader = PdfReader(str(template_path))
    if not reader.pages:
        raise ValueError("Leave request template has no pages.")
    base_page = reader.pages[0]
    width = float(base_page.mediabox.width)
    height = float(base_page.mediabox.height)
    regular_font, bold_font = _register_fonts()

    overlay_buffer = BytesIO()
    pdf = canvas.Canvas(overlay_buffer, pagesize=(width, height), pageCompression=1)
    for key, value in values.items():
        spec = field_map.get(key)
        if not spec:
            continue
        if "checkboxes" in spec:
            _draw_checkbox(pdf, spec, value, bold_font)
        else:
            _draw_field(pdf, spec, value, regular_font)
    pdf.save()
    overlay_buffer.seek(0)
    base_page.merge_page(PdfReader(overlay_buffer).pages[0])

    output = BytesIO()
    writer = PdfWriter()
    writer.add_page(base_page)
    writer.write(output)
    return output.getvalue()


def build_leave_request_pdf(instance, fallback: Callable[[Any], bytes] | None = None) -> bytes:
    template_path = resolve_template_path("leave_request_blank.pdf", aliases=["leave-request-template.pdf"])
    if not template_path:
        if fallback:
            return fallback(instance)
        raise FileNotFoundError("leave_request_blank.pdf could not be resolved")
    return render_leave_request_pdf(template_path, build_leave_request_values(instance))
