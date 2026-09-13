"""Human labels and employee display fields shared by the API and the PDF form."""

from __future__ import annotations

from typing import Any

from .models import PermissionRequest

Status = PermissionRequest.Status
ExitType = PermissionRequest.ExitType

#: status -> (English, Arabic). Raw enums are never shown to people.
STATUS_LABELS = {
    Status.PENDING_MANAGER: ("Pending Manager", "بانتظار المدير المباشر"),
    Status.PENDING_HR: ("Pending HR", "بانتظار الموارد البشرية"),
    Status.APPROVED: ("Approved", "معتمد"),
    Status.REJECTED: ("Rejected", "مرفوض"),
    Status.CANCELLED: ("Cancelled", "ملغي"),
}

#: exit type -> (English, Arabic), matching the labels printed on the template.
EXIT_TYPE_LABELS = {
    ExitType.BUSINESS: ("Business", "عمل"),
    ExitType.PERSONAL: ("Personal", "شخصي"),
    ExitType.EMERGENCY: ("Emergency", "طارئ"),
}


def _first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text and text not in {"-", "None"}:
            return text
    return ""


def profile_employee_number(profile: Any) -> str:
    return _first_text(getattr(profile, "employee_number", ""), getattr(profile, "employee_id", ""))


def profile_department(profile: Any) -> str:
    return _first_text(
        getattr(profile, "department_name_en", ""),
        getattr(profile, "department", ""),
        getattr(getattr(profile, "department_ref", None), "name", ""),
        getattr(profile, "department_name_ar", ""),
    )


def profile_job_title(profile: Any) -> str:
    return _first_text(
        getattr(profile, "job_title_en", ""),
        getattr(profile, "job_title", ""),
        getattr(getattr(profile, "position_ref", None), "name", ""),
        getattr(profile, "job_title_ar", ""),
    )
