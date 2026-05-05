import mimetypes
import os
from io import BytesIO
from datetime import date
from glob import glob

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import audit
from core.delegation import get_delegated_manager_user_ids
from core.pagination import StandardPagination
from core.pdf import merge_pdfs
from core.permissions import IsDepartmentCEOApprover, IsHRWorkflowApprover, get_role
from core.responses import error, success
from core.services import (
    can_user_act_on_instance,
    get_ceo_approver_users,
    get_direct_manager_user,
    get_hr_approver_users,
    notify_users_for_pending_status,
    sync_leave_obligations,
    sync_workflow,
    waive_open_blocking_obligations,
)
from core.services.request_obligations import is_business_trip_leave
from employees.models import EmployeeProfile
from employees.permissions import IsHRManagerOrAdmin
from organization.services import filter_queryset_by_company_scope, get_active_company_for_request

from .models import LeaveBalanceAdjustment, LeaveRequest, LeaveType
from .notifications import (
    notify_delegation_assigned,
    notify_leave_approved,
    notify_leave_rejected,
    notify_leave_submitted,
)
from .permissions import (
    IsEmployeeOnly,
    IsLeaveRequestOwner,
    IsManagerOfEmployee,
    IsOwnerOrHR,
)
from .serializers import (
    HRManualLeaveRequestSerializer,
    LeaveBalanceAdjustmentSerializer,
    LeaveBalanceSerializer,
    LeaveRequestDelegationSerializer,
    LeaveRequestActionSerializer,
    LeaveRequestCreateSerializer,
    LeaveRequestSerializer,
    LeaveTypeSerializer,
)
from .utils import calculate_leave_balance, get_leave_days, get_payment_breakdown, get_used_days_for_type, resolve_employee_profile

User = get_user_model()

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except Exception:  # pragma: no cover - fallback until container rebuild installs extras
    arabic_reshaper = None
    get_display = None


def _flatten_errors(error_dict):
    errors = []
    for field, messages in error_dict.items():
        if isinstance(messages, (list, tuple)):
            for msg in messages:
                errors.append(f"{field}: {msg}")
        else:
            errors.append(f"{field}: {messages}")
    return errors


def _to_bool(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _is_hr_manager_user(user):
    return bool(user and user.is_authenticated and user.groups.filter(name="HRManager").exists())


def _is_hr_manager_origin_request(instance: LeaveRequest):
    employee = getattr(instance, "employee", None)
    return bool(employee and employee.groups.filter(name="HRManager").exists())


def _leave_profile(instance: LeaveRequest):
    return getattr(instance, "employee_profile", None) or resolve_employee_profile(getattr(instance, "employee", None))


def _leave_employee_name(instance: LeaveRequest):
    employee = getattr(instance, "employee", None)
    profile = _leave_profile(instance)
    return (
        getattr(employee, "full_name", "")
        or getattr(employee, "email", "")
        or getattr(profile, "full_name", "")
        or getattr(profile, "full_name_en", "")
        or getattr(profile, "employee_id", "")
        or "-"
    )


def _leave_employee_email(instance: LeaveRequest):
    employee = getattr(instance, "employee", None)
    profile = _leave_profile(instance)
    profile_user = getattr(profile, "user", None) if profile else None
    return getattr(employee, "email", "") or getattr(profile_user, "email", "") or "-"


def _leave_manager_user(instance: LeaveRequest):
    profile = _leave_profile(instance)
    if not profile:
        employee = getattr(instance, "employee", None)
        return get_direct_manager_user(employee) if employee else None
    manager_profile = getattr(profile, "manager_profile", None)
    if manager_profile and manager_profile.user:
        return manager_profile.user
    if getattr(profile, "manager", None):
        return profile.manager
    employee = getattr(instance, "employee", None)
    return get_direct_manager_user(employee) if employee else None


def _serve_leave_document(instance, request):
    if not instance.document:
        return error("Not found", errors=["No document attached to this leave request."], status=404)

    try:
        as_attachment = _to_bool(request.query_params.get("download", "0"))
        filename = instance.document.name.split("/")[-1] or f"leave_document_{instance.id}"
        
        # Guess the content type so the browser can preview PDFs/images inline
        content_type, _ = mimetypes.guess_type(filename)
        if not content_type:
            content_type = "application/octet-stream"
            
        return FileResponse(
            instance.document.open("rb"),
            as_attachment=as_attachment,
            filename=filename,
            content_type=content_type,
        )
    except FileNotFoundError:
        return error("Not found", errors=["Document file is missing from storage."], status=404)


def _approval_path_rows(instance: LeaveRequest):
    def _display_user(user):
        if not user:
            return "-"
        return str(getattr(user, "full_name", "") or getattr(user, "email", "") or "-")

    def _display_user_or_none(user):
        if not user:
            return None
        return str(getattr(user, "full_name", "") or getattr(user, "email", "") or "-")

    def _display_manager(employee):
        profile = getattr(employee, "employee_profile", None) if employee else None
        manager_profile = getattr(profile, "manager_profile", None) if profile else None
        manager_user = getattr(manager_profile, "user", None) if manager_profile else None
        manager_name = getattr(manager_profile, "full_name_en", "") or getattr(manager_profile, "full_name", "")
        return str(manager_name or getattr(manager_user, "full_name", "") or getattr(manager_user, "email", "") or "-")

    rows = [
        ("Submitted", instance.created_at, "Request submitted", _leave_employee_name(instance)),
    ]

    if instance.source == LeaveRequest.RequestSource.HR_MANUAL:
        rows.append(
            ("HR Manual Entry", instance.decided_at, instance.manual_entry_reason or "Recorded by HR", _display_user(instance.entered_by or instance.decided_by))
        )
        return rows

    profile = _leave_profile(instance)
    needs_manager = bool(getattr(profile, "manager_id", None) or getattr(profile, "manager_profile_id", None))
    needs_ceo = bool(getattr(instance.leave_type, "requires_ceo_approval", False) or _is_hr_manager_origin_request(instance))

    if instance.delegated_to_id or instance.delegate_decision_at:
        rows.append(
            (
                "Alternative Employee Review",
                instance.delegate_decision_at,
                instance.delegate_decision_note or instance.status,
                _display_user(instance.delegate_decision_by or instance.delegated_to),
            )
        )

    if needs_manager:
        rows.append(
            (
                "Manager Review",
                instance.manager_decision_at,
                instance.manager_decision_note or instance.status,
                _display_user_or_none(instance.manager_decision_by) or _display_manager(getattr(instance, "employee", None)),
            )
        )
    else:
        rows.append(("Manager Review", None, "Not required", "-"))

    rows.append(
        (
            "HR Review",
            instance.decided_at if instance.status != LeaveRequest.RequestStatus.PENDING_CEO else None,
            instance.hr_decision_note or instance.decision_reason or instance.status,
            _display_user(instance.decided_by),
        )
    )

    if needs_ceo or instance.status == LeaveRequest.RequestStatus.PENDING_CEO or instance.ceo_decision_at:
        rows.append(("CEO Review", instance.ceo_decision_at, instance.ceo_decision_note or instance.status, _display_user(instance.ceo_decision_by)))

    return rows


def _leave_type_labels(leave_type: LeaveType | None) -> tuple[str, str]:
    if not leave_type:
        return "-", "-"

    english_name = str(leave_type.name or leave_type.code or "-")
    normalized = str(leave_type.code or english_name).strip().upper().replace(" ", "_")
    arabic_by_code = {
        "ANNUAL": "الإجازة السنوية",
        "ANNUAL_LEAVE": "الإجازة السنوية",
        "SICK": "الإجازة المرضية",
        "SICK_LEAVE": "الإجازة المرضية",
        "EMERGENCY": "إجازة طارئة",
        "EMERGENCY_LEAVE": "إجازة طارئة",
        "UNPAID": "اجازه بدون راتب",
        "UNPAID_LEAVE": "اجازه بدون راتب",
        "EXCEPTIONAL": "اجازه بدون راتب",
        "EXCEPTIONAL_LEAVE": "اجازه بدون راتب",
        "MARRIAGE": "إجازة زواج",
        "MARRIAGE_LEAVE": "إجازة زواج",
        "DEATH": "إجازة وفاة قريب",
        "DEATH_OF_RELATIVE": "إجازة وفاة قريب",
        "BEREAVEMENT": "إجازة وفاة قريب",
        "BEREAVEMENT_LEAVE": "إجازة وفاة قريب",
        "BIRTH": "إجازة مولود",
        "BIRTH_OF_CHILD": "إجازة مولود",
        "PATERNITY": "إجازة مولود",
        "PATERNITY_LEAVE": "إجازة مولود",
        "MATERNITY": "إجازة أمومة",
        "MATERNITY_LEAVE": "إجازة أمومة",
    }
    return english_name, arabic_by_code.get(normalized, english_name)


_LEAVE_STATUS_LABELS = {
    LeaveRequest.RequestStatus.SUBMITTED: ("Submitted", "تم التقديم"),
    LeaveRequest.RequestStatus.PENDING_DELEGATE: ("Pending Alternative Employee", "بانتظار الموظف البديل"),
    LeaveRequest.RequestStatus.PENDING_MANAGER: ("Pending Manager", "بانتظار المدير"),
    LeaveRequest.RequestStatus.PENDING_HR: ("Pending HR", "بانتظار الموارد البشرية"),
    LeaveRequest.RequestStatus.PENDING_CEO: ("Pending CEO", "بانتظار المدير التنفيذي"),
    LeaveRequest.RequestStatus.APPROVED: ("Approved", "معتمد"),
    LeaveRequest.RequestStatus.REJECTED: ("Rejected", "مرفوض"),
    LeaveRequest.RequestStatus.CANCELLED: ("Cancelled", "ملغي"),
}

_LEAVE_STAGE_LABELS = {
    "Submitted": ("Submitted", "تم التقديم"),
    "HR Manual Entry": ("HR Manual Entry", "إدخال يدوي من الموارد البشرية"),
    "Alternative Employee Review": ("Alternative Employee Review", "مراجعة الموظف البديل"),
    "Manager Review": ("Manager Review", "مراجعة المدير"),
    "HR Review": ("HR Review", "مراجعة الموارد البشرية"),
    "CEO Review": ("CEO Review", "مراجعة المدير التنفيذي"),
}


def _leave_document_pdf_bytes(instance: LeaveRequest) -> bytes | None:
    """Return the leave supporting document bytes when it's a PDF."""

    document = getattr(instance, "document", None)
    if not document:
        return None
    name = str(getattr(document, "name", "") or "").lower()
    if not name.endswith(".pdf"):
        return None
    try:
        document.open("rb")
        try:
            return document.read()
        finally:
            document.close()
    except Exception:
        return None


def _build_leave_request_pdf_fallback(instance: LeaveRequest):
    """Render the leave request PDF using the unified core.pdf design."""

    from core.pdf import (
        ApprovalStage,
        DetailRow,
        EmployeeBlock,
        ExtraSection,
        RequestDocument,
        render_request_pdf,
    )

    profile = _leave_profile(instance)
    status_en, _ = _LEAVE_STATUS_LABELS.get(instance.status, (str(instance.status), str(instance.status)))
    leave_type_en, leave_type_ar = _leave_type_labels(instance.leave_type)
    days = str(get_leave_days(instance.start_date, instance.end_date))
    source_en = "Manual HR Record" if instance.source == LeaveRequest.RequestSource.HR_MANUAL else "Employee Request"

    employee = EmployeeBlock(
        name=_leave_employee_name(instance),
        employee_number=getattr(profile, "employee_number", "") or getattr(profile, "employee_id", "") or "-",
        department=getattr(profile, "department_name_en", "") or getattr(profile, "department", "") or "-",
        job_title=getattr(profile, "job_title_en", "") or getattr(profile, "job_title", "") or "-",
        national_id=getattr(profile, "national_id", "") or "-",
        mobile=getattr(profile, "mobile", "") or "-",
    )

    details = [
        DetailRow("Leave Type", "نوع الإجازة", f"{leave_type_en} / {leave_type_ar}"),
        DetailRow("Period", "الفترة", f"{instance.start_date} → {instance.end_date}"),
        DetailRow("Days", "عدد الأيام", days),
        DetailRow("Source", "المصدر", source_en),
    ]

    approvals = []
    for stage, at, note, actor in _approval_path_rows(instance):
        stage_en, stage_ar = _LEAVE_STAGE_LABELS.get(stage, (stage, stage))
        approvals.append(
            ApprovalStage(
                stage_en=stage_en,
                stage_ar=stage_ar,
                actor=str(actor or "-"),
                at=timezone.localtime(at).strftime("%Y-%m-%d %H:%M") if at else "-",
                note=str(note or "-"),
            )
        )

    extra = []
    if instance.reason:
        extra.append(ExtraSection("Reason", "السبب", instance.reason))
    rejection_note = instance.ceo_decision_note or instance.hr_decision_note or instance.manager_decision_note
    if instance.status == LeaveRequest.RequestStatus.REJECTED and rejection_note:
        extra.append(ExtraSection("Rejection Note", "ملاحظة الرفض", rejection_note))

    doc = RequestDocument(
        title_en="Leave Request",
        title_ar="طلب إجازة",
        reference_no=str(instance.id),
        generated_at=timezone.localtime().strftime("%Y-%m-%d %H:%M"),
        employee=employee,
        details=details,
        approvals=approvals,
        extra=extra,
        status_label=status_en,
    )
    return render_request_pdf(doc)


def _build_leave_request_pdf(instance: LeaveRequest):
    def _register_pdf_fonts():
        font_candidates = {
            "DejaVuSans": [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "C:\\Windows\\Fonts\\DejaVuSans.ttf",
                "C:\\Windows\\Fonts\\arial.ttf",
            ],
            "DejaVuSans-Bold": [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "C:\\Windows\\Fonts\\DejaVuSans-Bold.ttf",
                "C:\\Windows\\Fonts\\arialbd.ttf",
            ],
        }
        for font_name, candidates in font_candidates.items():
            if font_name in pdfmetrics.getRegisteredFontNames():
                continue
            for path in candidates:
                if os.path.exists(path):
                    pdfmetrics.registerFont(TTFont(font_name, path))
                    break

    def _shape_ar(text):
        value = str(text or "").strip()
        if not value:
            return ""
        if arabic_reshaper and get_display and any("\u0600" <= ch <= "\u06FF" for ch in value):
            return get_display(arabic_reshaper.reshape(value))
        return value

    def _font_pair():
        regular = "DejaVuSans" if "DejaVuSans" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
        bold = "DejaVuSans-Bold" if "DejaVuSans-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
        return regular, bold

    def _template_path():
        search_roots = [str(settings.BASE_DIR.parent), str(settings.BASE_DIR)]
        explicit_names = [
            "طلب إجازة (AutoRecovered).pdf",
            "طلب إجازة.pdf",
            "leave-request-template.pdf",
        ]
        for root in search_roots:
            for name in explicit_names:
                candidate = os.path.join(root, name)
                if os.path.exists(candidate):
                    return candidate
            for candidate in glob(os.path.join(root, "*.pdf")):
                filename = os.path.basename(candidate)
                if "AutoRecovered" in filename or "طلب إجازة" in filename or "leave request" in filename.lower():
                    return candidate
        return ""

    def _profile_for(user):
        try:
            return user.employee_profile
        except Exception:
            return None

    def _display_name(user):
        return str(getattr(user, "full_name", "") or getattr(user, "email", "") or "-")

    def _display_manager(profile):
        if not profile:
            return "-"
        manager_profile = getattr(profile, "manager_profile", None)
        manager_user = getattr(manager_profile, "user", None) if manager_profile else None
        manager_name = (
            getattr(manager_profile, "full_name_en", "")
            or getattr(manager_profile, "full_name", "")
            or getattr(manager_user, "full_name", "")
            or getattr(manager_user, "email", "")
        )
        return str(manager_name or "-")

    def _project_department(profile):
        if not profile:
            return "-"
        department = getattr(profile, "department_name_en", "") or getattr(profile, "department", "")
        task_group = getattr(getattr(profile, "task_group_ref", None), "name", "")
        parts = [part for part in [department, task_group] if part]
        return " / ".join(parts) if parts else "-"

    def _find_balance(profile):
        if not profile:
            return "-"
        try:
            balances = calculate_leave_balance(instance.employee, instance.start_date.year, profile=profile)
        except Exception:
            return "-"
        for balance in balances:
            if balance["leave_type_id"] == instance.leave_type_id:
                return str(balance["remaining_days"])
        return "-"

    def _leave_flags():
        code = str(instance.leave_type.code or instance.leave_type.name or "").strip().upper().replace(" ", "_")
        accrued = code in {"ANNUAL", "ANNUAL_LEAVE"}
        unpaid = not bool(instance.leave_type.is_paid) or code in {"EXCEPTIONAL", "EXCEPTIONAL_LEAVE"}
        return {
            "accrued": accrued,
            "unpaid": unpaid,
            "other": not accrued and not unpaid,
        }

    def _request_summary():
        summary_parts = [f"Status: {instance.get_status_display()}"]
        if instance.reason:
            summary_parts.append(f"Reason: {instance.reason}")
        if instance.source == LeaveRequest.RequestSource.HR_MANUAL and instance.manual_entry_reason:
            summary_parts.append(f"Manual note: {instance.manual_entry_reason}")
        return " | ".join(summary_parts)

    def _fit_single_line(text, font_name, size, max_width):
        value = _shape_ar(text) or "-"
        if pdfmetrics.stringWidth(value, font_name, size) <= max_width:
            return value

        ellipsis = "..."
        trimmed = value
        while trimmed and pdfmetrics.stringWidth(f"{trimmed}{ellipsis}", font_name, size) > max_width:
            trimmed = trimmed[:-1]
        return f"{trimmed}{ellipsis}" if trimmed else ellipsis

    def _draw_text(pdf, x, y, text, *, size=8, font=None, max_width=110, align="left", max_lines=2):
        value = _shape_ar(text) or "-"
        chosen_font = font or regular_font
        if max_lines == 1:
            lines = [_fit_single_line(value, chosen_font, size, max_width)]
        else:
            lines = simpleSplit(value, chosen_font, size, max_width)[:max_lines] or ["-"]
        pdf.setFont(chosen_font, size)
        for index, line in enumerate(lines):
            line_y = y - (index * (size + 1))
            if align == "right":
                pdf.drawRightString(x, line_y, line)
            elif align == "center":
                pdf.drawCentredString(x, line_y, line)
            else:
                pdf.drawString(x, line_y, line)

    def _draw_checkbox(pdf, x, y, checked):
        if not checked:
            return
        pdf.setFont(bold_font, 11)
        pdf.drawCentredString(x, y, "X")

    template_path = _template_path()
    if not template_path:
        return _build_leave_request_pdf_fallback(instance)

    _register_pdf_fonts()
    regular_font, bold_font = _font_pair()

    reader = PdfReader(template_path)
    base_page = reader.pages[0]
    width = float(base_page.mediabox.width)
    height = float(base_page.mediabox.height)

    profile = _profile_for(instance.employee)
    days = str(get_leave_days(instance.start_date, instance.end_date))
    hr_name = _display_name(instance.decided_by or instance.entered_by) if (instance.decided_by or instance.entered_by) else "-"
    flags = _leave_flags()
    employee_name = (
        getattr(profile, "full_name_en", "")
        or getattr(profile, "full_name", "")
        or getattr(instance.employee, "full_name", "")
        or instance.employee.email
    )
    reference_no = str(instance.id)
    created_date = timezone.localtime(instance.created_at).strftime("%Y-%m-%d")
    department_project = _project_department(profile)

    overlay_buffer = BytesIO()
    pdf = canvas.Canvas(overlay_buffer, pagesize=(width, height))
    pdf.setTitle(f"Leave Request {instance.id}")
    pdf.setFillColorRGB(0.1, 0.1, 0.1)

    # Header
    _draw_text(pdf, 92, height - 69, reference_no, size=8, font=bold_font, max_width=115, max_lines=1)
    _draw_text(pdf, 92, height - 85, created_date, size=8, max_width=115, max_lines=1)

    # Employee info
    _draw_text(pdf, 112, height - 118, employee_name, size=6.4, font=bold_font, max_width=152, max_lines=1)
    _draw_text(
        pdf,
        418,
        height - 118,
        getattr(profile, "employee_number", "") or getattr(profile, "employee_id", "") or "-",
        size=7.0,
        max_width=72,
        max_lines=1,
    )
    _draw_text(pdf, 112, height - 135, department_project, size=6.0, max_width=152, max_lines=1)
    _draw_text(
        pdf,
        418,
        height - 135,
        getattr(profile, "job_title_en", "") or getattr(profile, "job_title", "") or "-",
        size=6.8,
        max_width=72,
        max_lines=1,
    )
    _draw_text(pdf, 112, height - 152, getattr(profile, "national_id", "") or "-", size=6.6, max_width=152, max_lines=1)
    _draw_text(
        pdf,
        418,
        height - 152,
        getattr(profile, "nationality_en", "") or getattr(profile, "nationality", "") or "-",
        size=6.8,
        max_width=72,
        max_lines=1,
    )
    _draw_text(pdf, 112, height - 169, getattr(profile, "mobile", "") or "-", size=6.6, max_width=152, max_lines=1)
    _draw_text(pdf, 418, height - 169, getattr(profile, "passport_no", "") or "-", size=6.6, max_width=72, max_lines=1)

    # Request details
    _draw_checkbox(pdf, 229, height - 191, flags["other"])
    _draw_checkbox(pdf, 355, height - 191, flags["unpaid"])
    _draw_checkbox(pdf, 510, height - 191, flags["accrued"])
    
    # First row: Duration & Substitute Employee
    _draw_text(pdf, 72, height - 222, "-", size=6.2, max_width=98, max_lines=1)
    _draw_text(pdf, 409, height - 222, days, size=6.7, font=bold_font, max_width=24, align="center", max_lines=1)
    
    # Second row: Leave starting day & Substitute Name
    _draw_text(pdf, 72, height - 239, "-", size=5.9, max_width=98, max_lines=1)
    _draw_text(pdf, 392, height - 239, instance.start_date.strftime("%Y-%m-%d"), size=5.9, max_width=52, align="center", max_lines=1)
    
    # Third row: Leave ending day & Substitute Emp No
    _draw_text(pdf, 72, height - 256, "-", size=5.9, max_width=98, max_lines=1)
    _draw_text(pdf, 392, height - 256, instance.end_date.strftime("%Y-%m-%d"), size=5.9, max_width=52, align="center", max_lines=1)
    
    # Fourth row: Destination
    _draw_text(pdf, 392, height - 273, "-", size=5.9, max_width=52, align="center", max_lines=1)
    
    # Fifth row: Actual departure date
    _draw_text(pdf, 392, height - 290, instance.start_date.strftime("%Y-%m-%d"), size=5.9, max_width=52, align="center", max_lines=1)
    
    # Sixth row: Actual return date
    _draw_text(pdf, 392, height - 307, instance.end_date.strftime("%Y-%m-%d"), size=5.9, max_width=52, align="center", max_lines=1)

    # Approval block intentionally left blank; signatures and manager names belong to the manual approval section.

    # HR section
    _draw_text(pdf, 170, height - 703, _request_summary(), size=5.9, max_width=330, max_lines=1)
    _draw_text(pdf, 170, height - 733, instance.source_document_ref or "-", size=5.9, max_width=330, max_lines=1)
    _draw_text(pdf, 475, height - 775, hr_name, size=6.1, max_width=78, align="center", max_lines=1)
    _draw_text(pdf, 298, height - 775, "HR", size=6.1, max_width=60, align="center", max_lines=1)

    pdf.save()
    overlay_buffer.seek(0)

    overlay_page = PdfReader(overlay_buffer).pages[0]
    base_page.merge_page(overlay_page)

    output = BytesIO()
    writer = PdfWriter()
    writer.add_page(base_page)
    writer.write(output)
    output.seek(0)
    return output.getvalue()


class LeaveTypeViewSet(viewsets.ModelViewSet):
    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer
    permission_classes = [IsAuthenticated]  # Overridden by get_permissions

    def get_permissions(self):
        # List/Retrieve: Anyone authenticated can try, but logic filters content
        if self.action in ["list", "retrieve"]:
            return [IsAuthenticated()]

        # Write actions: HR/Admin only
        return [IsAuthenticated(), IsHRManagerOrAdmin()]

    def list(self, request, *args, **kwargs):
        # Employees only see active leave types; HR/Admin see all
        role = get_role(request.user)
        qs = filter_queryset_by_company_scope(self.get_queryset(), request)

        if role == "Employee":
            qs = qs.filter(is_active=True)

        serializer = self.get_serializer(qs, many=True)
        return success(serializer.data)

    def perform_create(self, serializer):
        from organization.services import ensure_company_write_allowed, get_active_company_for_request

        ensure_company_write_allowed(self.request)
        instance = serializer.save(company=get_active_company_for_request(self.request))
        audit(self.request, "leave_type_created", entity="leave_type", entity_id=instance.id, metadata=serializer.data)

    def perform_update(self, serializer):
        instance = serializer.save()
        audit(self.request, "leave_type_updated", entity="leave_type", entity_id=instance.id, metadata=serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.perform_destroy(instance)
        return success({"id": instance.id, "is_active": instance.is_active})

    def perform_destroy(self, instance):
        # Soft-delete implementation
        instance.is_active = False
        instance.save()
        audit(
            self.request,
            "leave_type_deactivated",
            entity="leave_type",
            entity_id=instance.id,
            metadata={"name": instance.name},
        )

    # Wrap responses
    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        return success(response.data, status=response.status_code)

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        return success(response.data)


class LeaveRequestViewSet(viewsets.ModelViewSet):
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "leave_type", "employee"]
    ordering_fields = ["created_at", "start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)
        base_qs = filter_queryset_by_company_scope(
            LeaveRequest.objects.filter(is_active=True).select_related(
                "employee",
                "employee__employee_profile",
                "leave_type",
                "decided_by",
                "manager_decision_by",
                "delegated_to",
                "delegate_decision_by",
                "company",
            ),
            self.request,
        )
        if role in ["SystemAdmin", "HRManager"]:
            return base_qs
        return base_qs.filter(employee=user)

    def get_serializer_class(self):
        if self.action == "create":
            return LeaveRequestCreateSerializer
        return LeaveRequestSerializer

    def _unscoped_queryset(self):
        return filter_queryset_by_company_scope(
            LeaveRequest.objects.filter(is_active=True).select_related(
                "employee",
                "employee__employee_profile",
                "leave_type",
                "decided_by",
                "manager_decision_by",
                "delegated_to",
                "delegate_decision_by",
                "company",
            ),
            self.request,
        )

    def get_permissions(self):
        if self.action == "create":
            return [IsAuthenticated(), IsEmployeeOnly()]

        if self.action == "list":
            return [IsAuthenticated(), IsOwnerOrHR()]

        if self.action == "retrieve":
            return [IsAuthenticated()]

        if self.action in ["document", "pdf"]:
            return [IsAuthenticated(), IsOwnerOrHR()]

        if self.action in ["approve", "reject"]:
            return [IsAuthenticated(), IsHRWorkflowApprover()]

        if self.action in ["delegate_approve", "delegate_reject"]:
            return [IsAuthenticated()]

        if self.action in ["cancel", "set_delegate"]:
            # Owner only
            return [IsAuthenticated()]

        # For update/partial_update/destroy (standard CRUD)
        # Default restricted to HR/Admin
        return [IsAuthenticated(), IsHRManagerOrAdmin()]

    def create(self, request, *args, **kwargs):
        if "employee_id" in request.data:
            return error("Validation error", errors=["employee_id is not allowed."], status=422)
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        self.perform_create(serializer)

        # Return read-serializer
        instance = serializer.instance
        read_serializer = LeaveRequestSerializer(instance, context={"request": request})
        return success(read_serializer.data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        # Determine initial status
        user = self.request.user
        has_manager = False
        # Check both new manager_profile and legacy manager for compatibility
        if hasattr(user, "employee_profile"):
            profile = user.employee_profile
            manager_user_id = profile.manager_id
            if not manager_user_id and profile.manager_profile:
                manager_user_id = profile.manager_profile.user_id
            has_manager = bool(manager_user_id)

        if serializer.validated_data.get("delegated_to"):
            initial_status = LeaveRequest.RequestStatus.PENDING_DELEGATE
        elif _is_hr_manager_user(user):
            initial_status = LeaveRequest.RequestStatus.PENDING_CEO
        elif has_manager:
            initial_status = LeaveRequest.RequestStatus.PENDING_MANAGER
        else:
            initial_status = LeaveRequest.RequestStatus.PENDING_HR

        instance = serializer.save(
            employee=self.request.user,
            employee_profile=getattr(self.request.user, "employee_profile", None),
            company=getattr(getattr(self.request.user, "employee_profile", None), "company", None),
            status=initial_status,
        )
        sync_workflow(instance, actor=self.request.user)
        sync_leave_obligations(instance, actor=self.request.user)
        requested_days = get_leave_days(instance.start_date, instance.end_date)
        used_before = get_used_days_for_type(self.request.user, instance.leave_type, instance.start_date.year)
        payment_breakdown = get_payment_breakdown(
            instance.leave_type,
            used_before,
            requested_days,
            employee_subject=self.request.user,
            year=instance.start_date.year,
            company=instance.company or instance.leave_type.company,
        )

        # Audit
        audit(
            self.request,
            "submit",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={
                "leave_type": instance.leave_type.name,
                "start_date": str(instance.start_date),
                "end_date": str(instance.end_date),
                "duration_days": requested_days,
                "payment_breakdown": payment_breakdown,
                "approval_status": instance.status,
            },
        )
        # Fire-and-log: notifications must never fail the main workflow.
        try:
            if not instance.delegated_to:
                notify_leave_submitted(instance)
        except Exception:
            pass
        try:
            if instance.delegated_to:
                notify_delegation_assigned(instance)
        except Exception:
            pass

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated], url_path="set-delegate")
    def set_delegate(self, request, pk=None):
        try:
            instance = self._unscoped_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)

        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"] and instance.employee_id != request.user.id:
            return error("Not found", errors=["Not found."], status=404)
        if instance.status not in [
            LeaveRequest.RequestStatus.SUBMITTED,
            LeaveRequest.RequestStatus.PENDING_MANAGER,
            LeaveRequest.RequestStatus.PENDING_HR,
            LeaveRequest.RequestStatus.PENDING_CEO,
        ]:
            return error("Validation error", errors=["Delegate can only be updated while the request is pending."], status=422)

        serializer = LeaveRequestDelegationSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        delegated_to = serializer.validated_data["delegated_to"]
        if delegated_to.id == instance.employee_id:
            return error("Validation error", errors=["You cannot delegate the request to the same employee."], status=422)

        instance.delegated_to = delegated_to
        instance.delegation_note = serializer.validated_data.get("delegation_note", instance.delegation_note)
        instance.save(update_fields=["delegated_to", "delegation_note", "updated_at"])
        sync_workflow(instance, actor=request.user)
        sync_leave_obligations(instance, actor=request.user)
        audit(
            request,
            "leave_delegate_updated",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={"delegated_to": delegated_to.id},
        )
        try:
            notify_delegation_assigned(instance)
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated], url_path="delegate-approve")
    def delegate_approve(self, request, pk=None):
        try:
            instance = self._unscoped_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)

        if instance.delegated_to_id != request.user.id:
            return error("Forbidden", errors=["Only the delegated user can approve this step."], status=403)
        if instance.status != LeaveRequest.RequestStatus.PENDING_DELEGATE:
            return error(
                "Validation error",
                errors=["Request is not waiting for delegated user approval."],
                status=422,
            )

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        instance.status = LeaveRequest.RequestStatus.PENDING_HR
        instance.delegate_decision_by = request.user
        instance.delegate_decision_at = timezone.now()
        instance.delegate_decision_note = s.validated_data.get("comment", "")
        instance.save()
        sync_workflow(instance, actor=request.user)

        audit(request, "approve_delegate", entity="LeaveRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Leave Request",
                request_id=instance.id,
                requester_name=_leave_employee_name(instance),
                status_label=instance.status,
                details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {_leave_employee_email(instance)}"],
                action_path=f"/hr/leave/requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated], url_path="delegate-reject")
    def delegate_reject(self, request, pk=None):
        try:
            instance = self._unscoped_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)

        if instance.delegated_to_id != request.user.id:
            return error("Forbidden", errors=["Only the delegated user can reject this step."], status=403)
        if instance.status != LeaveRequest.RequestStatus.PENDING_DELEGATE:
            return error(
                "Validation error",
                errors=["Request is not waiting for delegated user approval."],
                status=422,
            )

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)
        comment = (s.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LeaveRequest.RequestStatus.REJECTED
        instance.delegate_decision_by = request.user
        instance.delegate_decision_at = timezone.now()
        instance.delegate_decision_note = comment
        instance.save()
        sync_workflow(instance, actor=request.user)

        audit(request, "reject_delegate", entity="LeaveRequest", entity_id=instance.id)
        try:
            notify_leave_rejected(instance, comment)
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    def list(self, request, *args, **kwargs):
        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"]:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)
        qs = self.get_queryset()
        params = request.query_params
        status_param = params.get("status")
        if status_param:
            # allowed = {
            #     LeaveRequest.RequestStatus.SUBMITTED,
            #     LeaveRequest.RequestStatus.APPROVED,
            #     LeaveRequest.RequestStatus.REJECTED,
            #     LeaveRequest.RequestStatus.CANCELLED,
            # }
            # Relax validation or allow all for list
            qs = qs.filter(status=status_param)

        employee_id = params.get("employee_id")
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        date_from = params.get("date_from")
        if date_from:
            qs = qs.filter(start_date__gte=date_from)
        date_to = params.get("date_to")
        if date_to:
            qs = qs.filter(end_date__lte=date_to)
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page if page is not None else qs, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(
            {
                "status": "success",
                "data": {
                    "items": serializer.data,
                    "page": 1,
                    "page_size": len(serializer.data),
                    "count": len(serializer.data),
                    "total_pages": 1,
                },
            }
        )

    def retrieve(self, request, *args, **kwargs):
        try:
            instance = self._unscoped_queryset().get(pk=kwargs.get("pk"))
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"] and instance.employee_id != request.user.id:
            if not can_user_act_on_instance(request.user, instance):
                return error("Not found", errors=["Not found."], status=404)
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    def destroy(self, request, *args, **kwargs):
        return error(
            "Hard delete is not allowed.",
            errors=["Hard delete is not allowed."],
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin])
    def approve(self, request, pk=None):
        try:
            instance = self._unscoped_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        if _is_hr_manager_origin_request(instance):
            return error(
                "Validation error",
                errors=["HR manager requests must be approved by CEO."],
                status=422,
            )

        allowed_statuses = [LeaveRequest.RequestStatus.SUBMITTED, LeaveRequest.RequestStatus.PENDING_HR]

        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Request is not in a state to be approved by HR."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        instance.decided_by = request.user
        instance.decided_at = timezone.now()
        note = s.validated_data.get("comment", "")
        instance.hr_decision_note = note

        # Check if CEO approval is required
        if instance.leave_type.requires_ceo_approval:
            instance.status = LeaveRequest.RequestStatus.PENDING_CEO
        else:
            instance.status = LeaveRequest.RequestStatus.APPROVED

        instance.save()
        sync_workflow(instance, actor=request.user)

        requested_days = get_leave_days(instance.start_date, instance.end_date)
        used_before = max(
            0.0,
            get_used_days_for_type(instance.employee, instance.leave_type, instance.start_date.year) - requested_days,
        )
        payment_breakdown = get_payment_breakdown(
            instance.leave_type,
            used_before,
            requested_days,
            employee_subject=instance.employee_profile or instance.employee,
            year=instance.start_date.year,
            company=instance.company or instance.leave_type.company,
        )

        audit(
            request,
            "approve",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={
                "duration_days": requested_days,
                "payment_breakdown": payment_breakdown,
                "approval_status": instance.status,
            },
        )
        try:
            notify_leave_approved(instance)
        except Exception:
            pass
        if instance.status == LeaveRequest.RequestStatus.PENDING_CEO:
            try:
                notify_users_for_pending_status(
                    users=get_ceo_approver_users(),
                    request_type="Leave Request",
                    request_id=instance.id,
                    requester_name=instance.employee.full_name or instance.employee.email,
                    status_label=instance.status,
                    details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {instance.employee.email}"],
                    action_path="/ceo/leave/requests",
                )
            except Exception:
                pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin])
    def reject(self, request, pk=None):
        try:
            instance = self._unscoped_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        if _is_hr_manager_origin_request(instance):
            return error(
                "Validation error",
                errors=["HR manager requests must be approved by CEO."],
                status=422,
            )

        # HR can reject at any pending stage? Or only pending HR?
        # Let's allow rejecting from PENDING_HR or SUBMITTED
        allowed_statuses = [
            LeaveRequest.RequestStatus.SUBMITTED,
            LeaveRequest.RequestStatus.PENDING_HR,
            LeaveRequest.RequestStatus.PENDING_MANAGER,
        ]

        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Request cannot be rejected."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)
        comment = (s.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LeaveRequest.RequestStatus.REJECTED
        instance.decided_by = request.user
        instance.decided_at = timezone.now()
        instance.hr_decision_note = comment
        instance.save()
        sync_workflow(instance, actor=request.user)

        audit(request, "reject", entity="LeaveRequest", entity_id=instance.id)
        try:
            notify_leave_rejected(instance, comment)
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRWorkflowApprover], url_path="send-to-ceo")
    def send_to_ceo(self, request, pk=None):
        try:
            instance = self._unscoped_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        if _is_hr_manager_origin_request(instance):
            return error(
                "Validation error",
                errors=["Request is already under CEO workflow."],
                status=422,
            )

        allowed_statuses = [
            LeaveRequest.RequestStatus.SUBMITTED,
            LeaveRequest.RequestStatus.PENDING_HR,
            LeaveRequest.RequestStatus.PENDING_MANAGER,
            LeaveRequest.RequestStatus.PENDING_CEO,
        ]
        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Request cannot be sent to CEO in current state."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        note = (s.validated_data.get("comment") or "").strip()
        if note:
            instance.hr_decision_note = note
        instance.status = LeaveRequest.RequestStatus.PENDING_CEO
        instance.decided_by = request.user
        instance.decided_at = timezone.now()
        instance.save()
        sync_workflow(instance, actor=request.user)

        audit(
            request,
            "send_to_ceo",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={"status": instance.status, "note": note},
        )
        try:
            notify_users_for_pending_status(
                users=get_ceo_approver_users(),
                request_type="Leave Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {instance.employee.email}"],
                action_path="/ceo/leave/requests",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsLeaveRequestOwner])
    def cancel(self, request, pk=None):
        try:
            instance = LeaveRequest.objects.get(pk=pk, employee=request.user, is_active=True)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)

        allowed_statuses = [
            LeaveRequest.RequestStatus.SUBMITTED,
            LeaveRequest.RequestStatus.PENDING_HR,
            LeaveRequest.RequestStatus.PENDING_MANAGER,
        ]

        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Only pending requests can be cancelled."], status=422)

        instance.status = LeaveRequest.RequestStatus.CANCELLED
        instance.save()
        sync_workflow(instance, actor=request.user)

        audit(request, "cancel", entity="LeaveRequest", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsOwnerOrHR])
    def document(self, request, pk=None):
        try:
            instance = self.get_object()
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        return _serve_leave_document(instance, request)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsOwnerOrHR])
    def pdf(self, request, pk=None):
        try:
            instance = self.get_object()
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)

        pdf_bytes = _build_leave_request_pdf(instance)
        packet = _to_bool(request.query_params.get("packet", "0"))
        filename = f"leave_request_{instance.id}.pdf"
        if packet:
            doc_bytes = _leave_document_pdf_bytes(instance)
            if doc_bytes:
                pdf_bytes = merge_pdfs([pdf_bytes, doc_bytes])
                filename = f"leave_request_{instance.id}_packet.pdf"
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        disposition = "attachment" if _to_bool(request.query_params.get("download", "1")) else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response


class HRManualLeaveRequestViewSet(viewsets.ModelViewSet):
    """
    HR-only endpoints for creating/updating/deleting manual leave records.
    Manual records are always auto-approved and flagged as HR manual source.
    """

    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    queryset = LeaveRequest.objects.filter(
        is_active=True,
        source=LeaveRequest.RequestSource.HR_MANUAL,
    ).select_related("employee", "leave_type", "employee__employee_profile", "employee_profile", "employee_profile__user")
    serializer_class = HRManualLeaveRequestSerializer
    http_method_names = ["post", "patch", "delete", "get", "head", "options"]

    def get_queryset(self):
        return filter_queryset_by_company_scope(super().get_queryset(), self.request)

    def _notify_manager(self, instance: LeaveRequest, action_label: str):
        try:
            manager = _leave_manager_user(instance)
            if not manager:
                return
            notify_users_for_pending_status(
                users=[manager],
                request_type="Manual Leave Record",
                request_id=instance.id,
                requester_name=_leave_employee_name(instance),
                status_label=action_label,
                details=[
                    f"Leave Type: {instance.leave_type.name}",
                    f"From: {instance.start_date}",
                    f"To: {instance.end_date}",
                ],
                action_path=f"/hr/leave/requests/{instance.id}",
            )
        except Exception:
            pass

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance = serializer.save()
        sync_workflow(instance, actor=request.user)
        warnings = serializer.policy_warnings

        audit(
            request,
            "manual_leave_record_created",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={
                "employee_id": instance.employee_id,
                "source": instance.source,
                "manual_entry_reason": instance.manual_entry_reason,
                "source_document_ref": instance.source_document_ref,
                "warning_messages": warnings,
            },
        )
        self._notify_manager(instance, "manual_record_created")
        if instance.delegated_to:
            try:
                notify_delegation_assigned(instance)
            except Exception:
                pass

        data = LeaveRequestSerializer(instance, context={"request": request}).data
        data["warning_messages"] = warnings
        return success(data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        updated = serializer.save()
        sync_workflow(updated, actor=request.user)
        warnings = serializer.policy_warnings

        audit(
            request,
            "manual_leave_record_updated",
            entity="LeaveRequest",
            entity_id=updated.id,
            metadata={
                "employee_id": updated.employee_id,
                "source": updated.source,
                "manual_entry_reason": updated.manual_entry_reason,
                "source_document_ref": updated.source_document_ref,
                "warning_messages": warnings,
            },
        )
        self._notify_manager(updated, "manual_record_updated")
        if updated.delegated_to:
            try:
                notify_delegation_assigned(updated)
            except Exception:
                pass

        data = LeaveRequestSerializer(updated, context={"request": request}).data
        data["warning_messages"] = warnings
        return success(data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.deleted_by = request.user
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_active", "deleted_by", "deleted_at", "updated_at"])
        sync_workflow(instance, actor=request.user)

        audit(
            request,
            "manual_leave_record_deleted",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={
                "employee_id": instance.employee_id,
                "source": instance.source,
                "manual_entry_reason": instance.manual_entry_reason,
                "source_document_ref": instance.source_document_ref,
            },
        )
        self._notify_manager(instance, "manual_record_deleted")
        return success({})


class ManagerLeaveRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Endpoints for managers to view and act on their direct reports' leave requests.
    """

    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated]  # Filtering logic handles scope
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "leave_type"]
    ordering_fields = ["created_at", "start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        role = get_role(self.request.user)
        base_qs = filter_queryset_by_company_scope(
            LeaveRequest.objects.filter(is_active=True).select_related(
                "employee", "leave_type", "employee__employee_profile", "employee__employee_profile__manager_profile"
            ),
            self.request,
        )
        if role == "SystemAdmin":
            return base_qs

        manager_profile_match = Q()
        if hasattr(self.request.user, "employee_profile"):
            manager_profile_match = Q(employee__employee_profile__manager_profile=self.request.user.employee_profile)

        delegated_manager_ids = get_delegated_manager_user_ids(self.request.user)
        delegated_manager_match = Q()
        if delegated_manager_ids:
            delegated_manager_match = Q(employee__employee_profile__manager_id__in=delegated_manager_ids) | Q(
                employee__employee_profile__manager_profile__user_id__in=delegated_manager_ids
            )

        return base_qs.filter(
            (
                Q(employee__employee_profile__manager_profile__user=self.request.user)
                | Q(employee__employee_profile__manager=self.request.user)
                | manager_profile_match
                | delegated_manager_match
            )
        )

    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        # Implicitly checks queryset filter
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def approve(self, request, pk=None):
        instance = self.get_object()

        allowed_statuses = [LeaveRequest.RequestStatus.SUBMITTED, LeaveRequest.RequestStatus.PENDING_MANAGER]

        if instance.status not in allowed_statuses:
            return error(
                "Validation error", errors=["Request is not in a state to be approved by manager."], status=422
            )

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        instance.status = LeaveRequest.RequestStatus.PENDING_HR
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = s.validated_data.get("comment", "")
        instance.save()
        sync_workflow(instance, actor=request.user)

        audit(request, "approve", entity="LeaveRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Leave Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {instance.employee.email}"],
                action_path=f"/hr/leave/requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def reject(self, request, pk=None):
        instance = self.get_object()

        allowed_statuses = [LeaveRequest.RequestStatus.SUBMITTED, LeaveRequest.RequestStatus.PENDING_MANAGER]

        if instance.status not in allowed_statuses:
            return error(
                "Validation error", errors=["Request is not in a state to be rejected by manager."], status=422
            )

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)
        comment = (s.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LeaveRequest.RequestStatus.REJECTED
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = comment
        instance.save()
        sync_workflow(instance, actor=request.user)

        audit(request, "reject", entity="LeaveRequest", entity_id=instance.id)
        try:
            notify_leave_rejected(instance, comment)
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def document(self, request, pk=None):
        instance = self.get_object()
        return _serve_leave_document(instance, request)


class LeaveBalanceViewSet(viewsets.ViewSet):
    """
    HR/Admin endpoint for viewing any employee's leave balance.
    GET /leave-balances/?employee_id=...&year=...
    """

    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def list(self, request):
        employee_id = request.query_params.get("employee_id")
        year = request.query_params.get("year")

        if not employee_id:
            return error("Validation error", errors=["employee_id is required."], status=422)
        if not year:
            return error("Validation error", errors=["year is required."], status=422)

        try:
            year = int(year)
        except ValueError:
            return error("Validation error", errors=["year must be a valid integer."], status=422)

        # Get Employee User
        from employees.models import EmployeeProfile

        try:
            profile = EmployeeProfile.objects.get(id=employee_id)
            user = profile.user
        except (EmployeeProfile.DoesNotExist, ValueError):
            return error("Not found", errors=["Not found."], status=404)

        balances = calculate_leave_balance(user, year, profile=profile)

        # Audit
        audit(
            request, "leave_balance.viewed_hr", entity="employee_profile", entity_id=profile.id, metadata={"year": year}
        )

        serializer = LeaveBalanceSerializer(balances, many=True)
        return success(serializer.data)


class EmployeeLeaveBalanceView(APIView):
    """
    Employee endpoint for viewing their own leave balance.
    GET /employee/leave-balance/?year=...
    """

    permission_classes = [IsAuthenticated, IsEmployeeOnly]

    def get(self, request):
        year = request.query_params.get("year")

        if not year:
            year = date.today().year
        else:
            try:
                year = int(year)
            except ValueError:
                return error("Validation error", errors=["year must be a valid integer."], status=422)

        balances = calculate_leave_balance(
            request.user,
            year,
            company=get_active_company_for_request(request),
        )

        # Audit
        audit(request, "leave_balance.viewed", entity="user", entity_id=request.user.id, metadata={"year": year})

        serializer = LeaveBalanceSerializer(balances, many=True)
        return success(serializer.data)


class EmployeeLeaveRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated, IsEmployeeOnly]
    pagination_class = None

    def get_queryset(self):
        return LeaveRequest.objects.filter(
            employee=self.request.user,
            is_active=True,
        ).select_related("employee", "leave_type", "decided_by")

    def list(self, request, *args, **kwargs):
        if "employee_id" in request.query_params:
            return error("Validation error", errors=["employee_id is not allowed."], status=422)
        qs = self.get_queryset()
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = self.get_serializer(page if page is not None else qs, many=True)
        if page is not None:
            return paginator.get_paginated_response(serializer.data)
        return Response(
            {
                "status": "success",
                "data": {
                    "items": serializer.data,
                    "page": 1,
                    "page_size": len(serializer.data),
                    "count": len(serializer.data),
                    "total_pages": 1,
                },
            }
        )


class EmployeeDelegatedLeaveRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated, IsEmployeeOnly]
    pagination_class = None
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "leave_type"]
    ordering_fields = ["created_at", "start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return LeaveRequest.objects.filter(
            delegated_to=self.request.user,
            is_active=True,
        ).select_related(
            "employee",
            "employee__employee_profile",
            "leave_type",
            "decided_by",
            "manager_decision_by",
            "delegated_to",
            "delegate_decision_by",
            "company",
        )

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = self.get_serializer(page if page is not None else qs, many=True)
        if page is not None:
            return paginator.get_paginated_response(serializer.data)
        return Response(
            {
                "status": "success",
                "data": {
                    "items": serializer.data,
                    "page": 1,
                    "page_size": len(serializer.data),
                    "count": len(serializer.data),
                    "total_pages": 1,
                },
            }
        )


class LeaveBalanceAdjustmentViewSet(viewsets.ModelViewSet):
    """
    CRUD for manual leave balance adjustments.
    """

    queryset = LeaveBalanceAdjustment.objects.all().order_by("-created_at")
    serializer_class = LeaveBalanceAdjustmentSerializer
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["employee", "leave_type"]

    def get_queryset(self):
        return filter_queryset_by_company_scope(super().get_queryset(), self.request)

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user)
        audit(
            self.request,
            "create_adjustment",
            entity="leave_balance_adjustment",
            entity_id=instance.id,
            metadata={
                "employee_id": instance.employee_id,
                "employee_profile_id": instance.employee_profile_id,
                "days": float(instance.adjustment_days),
            },
        )


class CEOLeaveRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Endpoints for CEO to view and act on pending leave requests.
    """

    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated, IsDepartmentCEOApprover]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "leave_type"]
    ordering_fields = ["created_at", "start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        # CEO sees all requests pending CEO approval
        return filter_queryset_by_company_scope(
            LeaveRequest.objects.filter(
                status=LeaveRequest.RequestStatus.PENDING_CEO,
                is_active=True,
            ).select_related("employee", "leave_type", "employee__employee_profile"),
            self.request,
        )

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        instance = self.get_object()

        if instance.status != LeaveRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not in a state to be approved by CEO."], status=422)
        if _is_hr_manager_origin_request(instance) and instance.employee_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)
        waiver_reason = (s.validated_data.get("waiver_reason") or "").strip()
        obligations_summary = sync_leave_obligations(instance, actor=request.user)
        if is_business_trip_leave(instance) and obligations_summary.get("blocking_open", 0) > 0:
            if not waiver_reason:
                return Response(
                    {
                        "status": "error",
                        "message": "Business Trip obligations must be resolved or waived by CEO before approval.",
                        "errors": [
                            {
                                "message": "Business Trip obligations must be resolved or waived by CEO before approval.",
                            }
                        ],
                        "data": {"obligations_summary": obligations_summary},
                    },
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            waive_open_blocking_obligations(instance, actor=request.user, reason=waiver_reason, request=request)

        instance.status = LeaveRequest.RequestStatus.APPROVED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = s.validated_data.get("comment", "")
        instance.save()
        sync_workflow(instance, actor=request.user)
        sync_leave_obligations(instance, actor=request.user)

        audit(request, "approve_ceo", entity="LeaveRequest", entity_id=instance.id)
        try:
            notify_leave_approved(instance)
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        instance = self.get_object()

        if instance.status != LeaveRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not in a state to be rejected by CEO."], status=422)
        if _is_hr_manager_origin_request(instance) and instance.employee_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)
        comment = (s.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LeaveRequest.RequestStatus.REJECTED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = comment
        instance.save()
        sync_workflow(instance, actor=request.user)

        audit(request, "reject_ceo", entity="LeaveRequest", entity_id=instance.id)
        try:
            notify_leave_rejected(instance, comment)
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def document(self, request, pk=None):
        instance = self.get_object()
        return _serve_leave_document(instance, request)
