from leaves.models import LeaveRequest
from leaves.utils import get_leave_days
from core.whatsapp_service import BirdWhatsAppTemplateService


def _employee_name(user) -> str:
    return getattr(user, "full_name", "") or getattr(user, "email", "") or "Employee"


def _employee_phone(user) -> str:
    profile = getattr(user, "employee_profile", None)
    return getattr(profile, "mobile", "") if profile else ""


def send_leave_request_submitted_whatsapp(leave_request: LeaveRequest, language: str = "en") -> dict:
    profile = getattr(leave_request.employee, "employee_profile", None)
    manager_profile = getattr(profile, "manager_profile", None)
    manager = getattr(manager_profile, "user", None) or getattr(profile, "manager", None)
    if not manager:
        return {"sent": False, "provider": "bird_whatsapp", "reason": "Employee has no manager assigned."}

    manager_phone = _employee_phone(manager)
    service = BirdWhatsAppTemplateService()
    return service.send_template(
        phone_number=manager_phone,
        template_key="leave_request_submitted_v1",
        language=language,
        variables={
            "manager_name": _employee_name(manager),
            "employee_name": _employee_name(leave_request.employee),
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "total_days": get_leave_days(leave_request.start_date, leave_request.end_date),
        },
        context={"event": "leave_request_submitted", "leave_request_id": leave_request.id},
    )


def send_leave_request_approved_whatsapp(leave_request: LeaveRequest, language: str = "en") -> dict:
    employee_phone = _employee_phone(leave_request.employee)
    service = BirdWhatsAppTemplateService()
    return service.send_template(
        phone_number=employee_phone,
        template_key="leave_request_approved_v1",
        language=language,
        variables={
            "employee_name": _employee_name(leave_request.employee),
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "total_days": get_leave_days(leave_request.start_date, leave_request.end_date),
        },
        context={"event": "leave_request_approved", "leave_request_id": leave_request.id},
    )


def send_leave_request_rejected_whatsapp(
    leave_request: LeaveRequest, rejection_reason: str, language: str = "en"
) -> dict:
    employee_phone = _employee_phone(leave_request.employee)
    service = BirdWhatsAppTemplateService()
    return service.send_template(
        phone_number=employee_phone,
        template_key="leave_request_rejected_v1",
        language=language,
        variables={
            "employee_name": _employee_name(leave_request.employee),
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "rejection_reason": rejection_reason or "Not specified",
        },
        context={"event": "leave_request_rejected", "leave_request_id": leave_request.id},
    )
