import mimetypes
import os
from io import BytesIO
from datetime import date

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
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import IsDepartmentCEOApprover, get_role
from core.responses import error, success
from core.services import (
    get_ceo_approver_users,
    get_direct_manager_user,
    get_hr_approver_users,
    notify_users_for_pending_status,
    send_leave_rejected_email,
    send_request_submission_email,
)
from employees.models import EmployeeProfile
from employees.permissions import IsHRManagerOrAdmin

from .models import LeaveBalanceAdjustment, LeaveRequest, LeaveType
from .notifications import (
    send_leave_request_approved_whatsapp,
    send_leave_request_rejected_whatsapp,
    send_leave_request_submitted_whatsapp,
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
    LeaveRequestActionSerializer,
    LeaveRequestCreateSerializer,
    LeaveRequestSerializer,
    LeaveTypeSerializer,
)
from .utils import calculate_leave_balance, get_leave_days, get_payment_breakdown, get_used_days_for_type

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
        profile = getattr(employee, "employee_profile", None)
        manager_profile = getattr(profile, "manager_profile", None) if profile else None
        manager_user = getattr(manager_profile, "user", None) if manager_profile else None
        manager_name = getattr(manager_profile, "full_name_en", "") or getattr(manager_profile, "full_name", "")
        return str(manager_name or getattr(manager_user, "full_name", "") or getattr(manager_user, "email", "") or "-")

    rows = [
        ("Submitted", instance.created_at, "Request submitted", _display_user(instance.employee)),
    ]

    if instance.source == LeaveRequest.RequestSource.HR_MANUAL:
        rows.append(
            ("HR Manual Entry", instance.decided_at, instance.manual_entry_reason or "Recorded by HR", _display_user(instance.entered_by or instance.decided_by))
        )
        return rows

    needs_manager = bool(getattr(getattr(instance.employee, "employee_profile", None), "manager_id", None))
    needs_ceo = bool(getattr(instance.leave_type, "requires_ceo_approval", False) or _is_hr_manager_origin_request(instance))

    if needs_manager:
        rows.append(
            (
                "Manager Review",
                instance.manager_decision_at,
                instance.manager_decision_note or instance.status,
                _display_user_or_none(instance.manager_decision_by) or _display_manager(instance.employee),
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
        "EXCEPTIONAL": "إجازة استثنائية",
        "EXCEPTIONAL_LEAVE": "إجازة استثنائية",
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


def _build_leave_request_pdf_legacy(instance: LeaveRequest):
    def _register_pdf_fonts():
        regular_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if "DejaVuSans" not in pdfmetrics.getRegisteredFontNames() and os.path.exists(regular_path):
            pdfmetrics.registerFont(TTFont("DejaVuSans", regular_path))
        if "DejaVuSans-Bold" not in pdfmetrics.getRegisteredFontNames() and os.path.exists(bold_path):
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", bold_path))

    def _shape_ar(text):
        value = str(text or "")
        if not value:
            return "-"
        if arabic_reshaper and get_display:
            return get_display(arabic_reshaper.reshape(value))
        return value

    def _logo_path():
        candidates = [
            os.path.join(str(settings.BASE_DIR), "static", "email", "ffi-logo.png"),
            os.path.join(str(settings.BASE_DIR.parent), "Logo FFI.png"),
            os.path.join(str(settings.BASE_DIR.parent), "FrontEnd", "public", "ffi-logo.png"),
            "/app/static/email/ffi-logo.png",
            "/app/Logo FFI.png",
        ]
        return next((path for path in candidates if os.path.exists(path)), "")

    def _draw_labeled_rows(pdf, x, y, width, rows, rtl=False):
        current_y = y
        label_font = "DejaVuSans-Bold"
        value_font = "DejaVuSans"
        for label, value in rows:
            pdf.setFillColorRGB(0.07, 0.09, 0.15)
            pdf.setFont(label_font, 10)
            if rtl:
                pdf.drawRightString(x + width, current_y, _shape_ar(label))
                pdf.setFont(value_font, 10)
                pdf.setFillColorRGB(0.28, 0.33, 0.41)
                pdf.drawRightString(x + width - 120, current_y, _shape_ar(value))
            else:
                pdf.drawString(x, current_y, str(label))
                pdf.setFont(value_font, 10)
                pdf.setFillColorRGB(0.28, 0.33, 0.41)
                pdf.drawString(x + 115, current_y, str(value))
            current_y -= 18
        return current_y

    def _status_label(status_value):
        mapping = {
            LeaveRequest.RequestStatus.SUBMITTED: ("Submitted", "تم التقديم"),
            LeaveRequest.RequestStatus.PENDING_MANAGER: ("Pending Manager", "بانتظار المدير"),
            LeaveRequest.RequestStatus.PENDING_HR: ("Pending HR", "بانتظار الموارد البشرية"),
            LeaveRequest.RequestStatus.PENDING_CEO: ("Pending CEO", "بانتظار المدير التنفيذي"),
            LeaveRequest.RequestStatus.APPROVED: ("Approved", "معتمد"),
            LeaveRequest.RequestStatus.REJECTED: ("Rejected", "مرفوض"),
            LeaveRequest.RequestStatus.CANCELLED: ("Cancelled", "ملغي"),
        }
        return mapping.get(status_value, (str(status_value), str(status_value)))

    _register_pdf_fonts()
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    accent = (244 / 255, 121 / 255, 32 / 255)
    accent_soft = (255 / 255, 244 / 255, 235 / 255)
    border = (253 / 255, 186 / 255, 116 / 255)
    generated_at = timezone.localtime(timezone.now()).strftime("%Y-%m-%d %H:%M")
    days = str(get_leave_days(instance.start_date, instance.end_date))
    status_en, status_ar = _status_label(instance.status)
    leave_type_en, leave_type_ar = _leave_type_labels(instance.leave_type)
    source_en = "Manual HR Record" if instance.source == LeaveRequest.RequestSource.HR_MANUAL else "Employee Request"
    source_ar = "سجل يدوي من الموارد البشرية" if instance.source == LeaveRequest.RequestSource.HR_MANUAL else "طلب موظف"
    rejection_note = instance.ceo_decision_note or instance.hr_decision_note or instance.manager_decision_note or "-"
    approval_rows = _approval_path_rows(instance)

    pdf.setTitle(f"Leave Request {instance.id}")
    pdf.setFillColorRGB(*accent)
    pdf.roundRect(24, height - 105, width - 48, 68, 18, fill=1, stroke=0)

    logo = _logo_path()
    if logo:
        pdf.drawImage(ImageReader(logo), 34, height - 92, width=54, height=42, preserveAspectRatio=True, mask="auto")

    pdf.setFillColorRGB(1, 1, 1)
    pdf.setFont("DejaVuSans-Bold", 18)
    pdf.drawString(100, height - 62, f"Leave Request #{instance.id}")
    pdf.setFont("DejaVuSans", 10)
    pdf.drawString(100, height - 82, f"Generated | {generated_at}")

    pdf.setFillColorRGB(*accent_soft)
    pdf.roundRect(24, 36, width - 48, height - 160, 20, fill=1, stroke=0)

    pdf.setFillColorRGB(1, 1, 1)
    pdf.roundRect(36, height - 340, width - 72, 206, 18, fill=1, stroke=0)
    pdf.roundRect(36, 56, width - 72, 260, 18, fill=1, stroke=0)

    pdf.setStrokeColorRGB(*border)
    pdf.setLineWidth(1)
    pdf.roundRect(36, height - 340, width - 72, 206, 18, fill=0, stroke=1)
    pdf.roundRect(36, 56, width - 72, 260, 18, fill=0, stroke=1)

    pdf.setFillColorRGB(*accent)
    pdf.setFont("DejaVuSans-Bold", 13)
    pdf.drawString(48, height - 154, "Arabic / العربية")
    pdf.drawRightString(width - 48, height - 154, _shape_ar("العربية / Arabic"))

    arabic_rows = [
        ("الموظف", instance.employee.full_name or instance.employee.email),
        ("البريد الإلكتروني", instance.employee.email),
        ("نوع الإجازة", leave_type_ar),
        ("الحالة", status_ar),
        ("الفترة", f"{instance.start_date} - {instance.end_date}"),
        ("عدد الأيام", days),
        ("المصدر", source_ar),
        ("السبب", instance.reason or "-"),
    ]
    if instance.status == LeaveRequest.RequestStatus.REJECTED:
        arabic_rows.append(("ملاحظة الرفض", rejection_note))

    english_rows = [
        ("Employee", instance.employee.full_name or instance.employee.email),
        ("Email", instance.employee.email),
        ("Leave Type", leave_type_en),
        ("Status", status_en),
        ("Period", f"{instance.start_date} to {instance.end_date}"),
        ("Days", days),
        ("Source", source_en),
        ("Reason", instance.reason or "-"),
    ]
    if instance.status == LeaveRequest.RequestStatus.REJECTED:
        english_rows.append(("Rejection Note", rejection_note))

    _draw_labeled_rows(pdf, 56, height - 184, 220, arabic_rows, rtl=True)
    _draw_labeled_rows(pdf, 56, height - 184, 470, english_rows, rtl=False)

    pdf.setFillColorRGB(*accent)
    pdf.setFont("DejaVuSans-Bold", 13)
    pdf.drawString(48, 294, "Approval Path")
    pdf.drawRightString(width - 48, 294, _shape_ar("مسار الموافقة"))

    timeline_y = 266
    left_x = 56
    right_x = width / 2 + 12

    for index, (stage, at, note, actor) in enumerate(approval_rows):
        y = timeline_y - (index * 56)
        pdf.setFillColorRGB(*accent)
        pdf.circle(left_x + 8, y + 4, 4, fill=1, stroke=0)
        if index < len(approval_rows) - 1:
            pdf.setStrokeColorRGB(*border)
            pdf.line(left_x + 8, y - 6, left_x + 8, y - 42)

        pdf.setFillColorRGB(0.07, 0.09, 0.15)
        pdf.setFont("DejaVuSans-Bold", 10)
        pdf.drawString(left_x + 22, y + 2, str(stage))
        pdf.setFont("DejaVuSans", 9)
        pdf.setFillColorRGB(0.28, 0.33, 0.41)
        pdf.drawString(left_x + 22, y - 12, timezone.localtime(at).strftime("%Y-%m-%d %H:%M") if at else "-")
        pdf.drawString(left_x + 22, y - 26, str(actor or "-")[:54])
        pdf.drawString(left_x + 22, y - 40, str(note or "-")[:54])

        stage_ar = {
            "Submitted": "تم التقديم",
            "HR Manual Entry": "إدخال يدوي من الموارد البشرية",
            "Manager Review": "مراجعة المدير",
            "HR Review": "مراجعة الموارد البشرية",
            "CEO Review": "مراجعة المدير التنفيذي",
        }.get(stage, stage)
        pdf.setFillColorRGB(*accent)
        pdf.circle(right_x + 180, y + 4, 4, fill=1, stroke=0)
        if index < len(approval_rows) - 1:
            pdf.setStrokeColorRGB(*border)
            pdf.line(right_x + 180, y - 6, right_x + 180, y - 42)

        pdf.setFillColorRGB(0.07, 0.09, 0.15)
        pdf.setFont("DejaVuSans-Bold", 10)
        pdf.drawRightString(right_x + 168, y + 2, _shape_ar(stage_ar))
        pdf.setFont("DejaVuSans", 9)
        pdf.setFillColorRGB(0.28, 0.33, 0.41)
        pdf.drawRightString(right_x + 168, y - 12, _shape_ar(timezone.localtime(at).strftime("%Y-%m-%d %H:%M") if at else "-"))
        pdf.drawRightString(right_x + 168, y - 26, _shape_ar(str(actor or "-")[:36]))
        pdf.drawRightString(right_x + 168, y - 40, _shape_ar(str(note or "-")[:36]))

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()


def _build_leave_request_pdf(instance: LeaveRequest):
    def _register_pdf_fonts():
        regular_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if "DejaVuSans" not in pdfmetrics.getRegisteredFontNames() and os.path.exists(regular_path):
            pdfmetrics.registerFont(TTFont("DejaVuSans", regular_path))
        if "DejaVuSans-Bold" not in pdfmetrics.getRegisteredFontNames() and os.path.exists(bold_path):
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", bold_path))

    def _shape_ar(text):
        value = str(text or "")
        if not value:
            return "-"
        if arabic_reshaper and get_display:
            return get_display(arabic_reshaper.reshape(value))
        return value

    def _logo_path():
        candidates = [
            os.path.join(str(settings.BASE_DIR), "static", "email", "ffi-logo.png"),
            os.path.join(str(settings.BASE_DIR.parent), "Logo FFI.png"),
            os.path.join(str(settings.BASE_DIR.parent), "FrontEnd", "public", "ffi-logo.png"),
            "/app/static/email/ffi-logo.png",
            "/app/Logo FFI.png",
        ]
        return next((path for path in candidates if os.path.exists(path)), "")

    def _status_label(status_value):
        mapping = {
            LeaveRequest.RequestStatus.SUBMITTED: ("Submitted", "تم التقديم"),
            LeaveRequest.RequestStatus.PENDING_MANAGER: ("Pending Manager", "بانتظار المدير"),
            LeaveRequest.RequestStatus.PENDING_HR: ("Pending HR", "بانتظار الموارد البشرية"),
            LeaveRequest.RequestStatus.PENDING_CEO: ("Pending CEO", "بانتظار المدير التنفيذي"),
            LeaveRequest.RequestStatus.APPROVED: ("Approved", "معتمد"),
            LeaveRequest.RequestStatus.REJECTED: ("Rejected", "مرفوض"),
            LeaveRequest.RequestStatus.CANCELLED: ("Cancelled", "ملغي"),
        }
        return mapping.get(status_value, (str(status_value), str(status_value)))

    stage_labels = {
        "Submitted": ("Submitted", "تم التقديم"),
        "HR Manual Entry": ("HR Manual Entry", "إدخال يدوي من الموارد البشرية"),
        "Manager Review": ("Manager Review", "مراجعة المدير"),
        "HR Review": ("HR Review", "مراجعة الموارد البشرية"),
        "CEO Review": ("CEO Review", "مراجعة المدير التنفيذي"),
    }
    note_labels = {
        "Request submitted": ("Request submitted", "تم تقديم الطلب"),
        "Recorded by HR": ("Recorded by HR", "تم تسجيل الطلب من الموارد البشرية"),
        "Not required": ("Not required", "غير مطلوب"),
    }

    def _localized_note(note):
        if not note:
            return "-", "-"
        normalized = str(note).strip()
        if normalized in note_labels:
            return note_labels[normalized]
        if normalized in {value for value, _ in LeaveRequest.RequestStatus.choices}:
            return _status_label(normalized)
        return normalized, normalized

    def _draw_page_shell(pdf, width, height, accent, accent_soft, generated_at, page_title, *, rtl=False, subtitle=None):
        pdf.setFillColorRGB(*accent_soft)
        pdf.roundRect(24, 24, width - 48, height - 48, 20, fill=1, stroke=0)
        pdf.setFillColorRGB(*accent)
        pdf.roundRect(24, height - 94, width - 48, 58, 18, fill=1, stroke=0)

        logo = _logo_path()
        if logo:
            pdf.drawImage(ImageReader(logo), 36, height - 84, width=48, height=36, preserveAspectRatio=True, mask="auto")

        pdf.setFillColorRGB(1, 1, 1)
        pdf.setFont("DejaVuSans-Bold", 18)
        if rtl:
            pdf.drawRightString(width - 36, height - 60, _shape_ar(page_title))
        else:
            pdf.drawString(94, height - 60, page_title)
        pdf.setFont("DejaVuSans", 10)
        subtitle_text = subtitle or f"Generated | {generated_at}"
        if rtl:
            pdf.drawRightString(width - 36, height - 78, _shape_ar(subtitle_text))
        else:
            pdf.drawString(94, height - 78, subtitle_text)

    def _draw_section_card(pdf, x, y_top, width, height, accent, border, title_en, title_ar, *, rtl=False):
        pdf.setFillColorRGB(1, 1, 1)
        pdf.roundRect(x, y_top - height, width, height, 18, fill=1, stroke=0)
        pdf.setStrokeColorRGB(*border)
        pdf.setLineWidth(1)
        pdf.roundRect(x, y_top - height, width, height, 18, fill=0, stroke=1)
        pdf.setFillColorRGB(*accent)
        pdf.setFont("DejaVuSans-Bold", 13)
        if rtl:
            pdf.drawRightString(x + width - 16, y_top - 22, _shape_ar(title_ar))
        else:
            pdf.drawString(x + 16, y_top - 22, str(title_en))

    def _draw_detail_rows(pdf, x, y_top, width, rows, rtl=False):
        current_y = y_top
        label_width = 120
        value_width = width - label_width - 10
        for label, value in rows:
            label_text = _shape_ar(label) if rtl else str(label)
            value_text = str(value) if rtl else str(value)
            wrapped = simpleSplit(value_text, "DejaVuSans", 10, value_width) or ["-"]
            block_height = max(24, len(wrapped) * 12 + 8)

            pdf.setFillColorRGB(0.07, 0.09, 0.15)
            pdf.setFont("DejaVuSans-Bold", 10)
            if rtl:
                pdf.drawRightString(x + width, current_y, label_text)
            else:
                pdf.drawString(x, current_y, label_text)

            pdf.setFillColorRGB(0.28, 0.33, 0.41)
            pdf.setFont("DejaVuSans", 10)
            for index, line in enumerate(wrapped):
                line_y = current_y - (index * 12)
                if rtl:
                    pdf.drawRightString(x + width - label_width, line_y, _shape_ar(line))
                else:
                    pdf.drawString(x + label_width, line_y, line)
            current_y -= block_height

    def _draw_timeline(pdf, x, y_top, width, rows, accent, border, rtl=False):
        dot_x = x + width - 8 if rtl else x + 8
        text_x = x + 26
        text_right = x + width - 22
        row_gap = 70
        note_width = width - 40

        for index, (stage, at, note, actor) in enumerate(rows):
            stage_en, stage_ar = stage_labels.get(stage, (stage, stage))
            note_en, note_ar = _localized_note(note)
            actor_en, actor_ar = actor or "-", actor or "-"
            stage_text = _shape_ar(stage_ar) if rtl else stage_en
            note_text = _shape_ar(note_ar) if rtl else note_en
            actor_text = _shape_ar(actor_ar) if rtl else actor_en
            timestamp = timezone.localtime(at).strftime("%Y-%m-%d %H:%M") if at else "-"
            if rtl:
                timestamp = _shape_ar(timestamp)

            row_top = y_top - (index * row_gap)
            pdf.setFillColorRGB(*accent)
            pdf.circle(dot_x, row_top - 2, 4, fill=1, stroke=0)
            if index < len(rows) - 1:
                pdf.setStrokeColorRGB(*border)
                pdf.line(dot_x, row_top - 10, dot_x, row_top - 46)

            pdf.setFillColorRGB(0.07, 0.09, 0.15)
            pdf.setFont("DejaVuSans-Bold", 10)
            if rtl:
                pdf.drawRightString(text_right, row_top, stage_text)
            else:
                pdf.drawString(text_x, row_top, stage_text)

            pdf.setFillColorRGB(0.28, 0.33, 0.41)
            pdf.setFont("DejaVuSans", 9)
            note_lines = simpleSplit(note_text, "DejaVuSans", 9, note_width)[:2] or ["-"]
            actor_lines = simpleSplit(actor_text, "DejaVuSans", 9, note_width)[:1] or ["-"]
            if rtl:
                pdf.drawRightString(text_right, row_top - 16, timestamp)
                for line_index, line in enumerate(actor_lines):
                    pdf.drawRightString(text_right, row_top - 30 - (line_index * 12), line)
                for line_index, line in enumerate(note_lines):
                    pdf.drawRightString(text_right, row_top - 42 - (line_index * 12), line)
            else:
                pdf.drawString(text_x, row_top - 16, timestamp)
                for line_index, line in enumerate(actor_lines):
                    pdf.drawString(text_x, row_top - 30 - (line_index * 12), line)
                for line_index, line in enumerate(note_lines):
                    pdf.drawString(text_x, row_top - 42 - (line_index * 12), line)

    _register_pdf_fonts()
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    accent = (244 / 255, 121 / 255, 32 / 255)
    accent_soft = (255 / 255, 244 / 255, 235 / 255)
    border = (253 / 255, 186 / 255, 116 / 255)
    generated_at = timezone.localtime(timezone.now()).strftime("%Y-%m-%d %H:%M")
    days = str(get_leave_days(instance.start_date, instance.end_date))
    status_en, status_ar = _status_label(instance.status)
    leave_type_en, leave_type_ar = _leave_type_labels(instance.leave_type)
    source_en = "Manual HR Record" if instance.source == LeaveRequest.RequestSource.HR_MANUAL else "Employee Request"
    source_ar = "سجل يدوي من الموارد البشرية" if instance.source == LeaveRequest.RequestSource.HR_MANUAL else "طلب موظف"
    rejection_note = instance.ceo_decision_note or instance.hr_decision_note or instance.manager_decision_note or "-"
    approval_rows = _approval_path_rows(instance)

    arabic_rows = [
        ("الموظف", instance.employee.full_name or instance.employee.email),
        ("البريد الإلكتروني", instance.employee.email),
        ("نوع الإجازة", leave_type_ar),
        ("الحالة", status_ar),
        ("الفترة", f"{instance.start_date} - {instance.end_date}"),
        ("عدد الأيام", days),
        ("المصدر", source_ar),
        ("السبب", instance.reason or "-"),
    ]
    if instance.status == LeaveRequest.RequestStatus.REJECTED:
        arabic_rows.append(("ملاحظة الرفض", rejection_note))

    english_rows = [
        ("Employee", instance.employee.full_name or instance.employee.email),
        ("Email", instance.employee.email),
        ("Leave Type", leave_type_en),
        ("Status", status_en),
        ("Period", f"{instance.start_date} to {instance.end_date}"),
        ("Days", days),
        ("Source", source_en),
        ("Reason", instance.reason or "-"),
    ]
    if instance.status == LeaveRequest.RequestStatus.REJECTED:
        english_rows.append(("Rejection Note", rejection_note))

    pdf.setTitle(f"Leave Request {instance.id}")

    details_card_height = 250
    timeline_card_height = max(258, 118 + (len(approval_rows) * 70))

    _draw_page_shell(
        pdf,
        width,
        height,
        accent,
        accent_soft,
        generated_at,
        f"طلب إجازة رقم {instance.id}",
        rtl=True,
        subtitle=f"تاريخ الإنشاء | {generated_at}",
    )
    _draw_section_card(pdf, 36, height - 118, width - 72, details_card_height, accent, border, "Arabic", "العربية", rtl=True)
    _draw_detail_rows(pdf, 56, height - 166, width - 112, arabic_rows, rtl=True)
    _draw_section_card(
        pdf, 36, height - 388, width - 72, timeline_card_height, accent, border, "Approval Path", "مسار الموافقة", rtl=True
    )
    _draw_timeline(pdf, 56, height - 438, width - 112, approval_rows, accent, border, rtl=True)

    pdf.showPage()

    _draw_page_shell(pdf, width, height, accent, accent_soft, generated_at, f"Leave Request #{instance.id} - English")
    _draw_section_card(
        pdf, 36, height - 118, width - 72, details_card_height, accent, border, "Request Summary", "Request Summary"
    )
    _draw_detail_rows(pdf, 56, height - 166, width - 112, english_rows, rtl=False)
    _draw_section_card(
        pdf, 36, height - 388, width - 72, timeline_card_height, accent, border, "Approval Path", "Approval Path"
    )
    _draw_timeline(pdf, 56, height - 438, width - 112, approval_rows, accent, border, rtl=False)

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()


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
        qs = self.get_queryset()

        if role == "Employee":
            qs = qs.filter(is_active=True)

        serializer = self.get_serializer(qs, many=True)
        return success(serializer.data)

    def perform_create(self, serializer):
        instance = serializer.save()
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
        base_qs = LeaveRequest.objects.filter(is_active=True).select_related(
            "employee", "employee__employee_profile", "leave_type", "decided_by", "manager_decision_by"
        )
        if role in ["SystemAdmin", "HRManager"]:
            return base_qs
        return base_qs.filter(employee=user)

    def get_serializer_class(self):
        if self.action == "create":
            return LeaveRequestCreateSerializer
        return LeaveRequestSerializer

    def get_permissions(self):
        if self.action == "create":
            return [IsAuthenticated(), IsEmployeeOnly()]

        if self.action in ["list", "retrieve", "document", "pdf"]:
            # HR/Admin OR Owner (retrieve), HR-only for list enforced in list()
            return [IsAuthenticated(), IsOwnerOrHR()]

        if self.action in ["approve", "reject"]:
            # HR/Admin only
            return [IsAuthenticated(), IsHRManagerOrAdmin()]

        if self.action == "cancel":
            # Owner only
            return [IsAuthenticated(), IsLeaveRequestOwner()]

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
        read_serializer = LeaveRequestSerializer(instance)
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

        if _is_hr_manager_user(user):
            initial_status = LeaveRequest.RequestStatus.PENDING_CEO
        elif has_manager:
            initial_status = LeaveRequest.RequestStatus.PENDING_MANAGER
        else:
            initial_status = LeaveRequest.RequestStatus.PENDING_HR

        instance = serializer.save(employee=self.request.user, status=initial_status)
        requested_days = get_leave_days(instance.start_date, instance.end_date)
        used_before = get_used_days_for_type(self.request.user, instance.leave_type, instance.start_date.year)
        payment_breakdown = get_payment_breakdown(instance.leave_type, used_before, requested_days)

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
        # Fire-and-log pattern: leave workflow should not fail on notification issues.
        try:
            send_leave_request_submitted_whatsapp(instance)
        except Exception:
            pass
        try:
            send_request_submission_email(
                to_email=getattr(instance.employee, "email", None),
                employee_name=instance.employee.full_name or instance.employee.email,
                request_type="Leave Request",
                request_id=instance.id,
                status_label=instance.status,
                details=[
                    f"Leave Type: {instance.leave_type.name}",
                    f"From: {instance.start_date}",
                    f"To: {instance.end_date}",
                ],
                action_path="/employee/leave/requests",
            )
        except Exception:
            pass
        try:
            requester_name = instance.employee.full_name or instance.employee.email
            details = [
                f"Leave Type: {instance.leave_type.name}",
                f"From: {instance.start_date}",
                f"To: {instance.end_date}",
            ]
            if instance.status == LeaveRequest.RequestStatus.PENDING_MANAGER:
                manager = get_direct_manager_user(instance.employee)
                if manager:
                    notify_users_for_pending_status(
                        users=[manager],
                        request_type="Leave Request",
                        request_id=instance.id,
                        requester_name=requester_name,
                        status_label=instance.status,
                        details=details,
                        action_path=f"/manager/leave/requests/{instance.id}",
                    )
            elif instance.status == LeaveRequest.RequestStatus.PENDING_HR:
                notify_users_for_pending_status(
                    users=get_hr_approver_users(),
                    request_type="Leave Request",
                    request_id=instance.id,
                    requester_name=requester_name,
                    status_label=instance.status,
                    details=details,
                    action_path=f"/hr/leave/requests/{instance.id}",
                )
            elif instance.status == LeaveRequest.RequestStatus.PENDING_CEO:
                notify_users_for_pending_status(
                    users=get_ceo_approver_users(),
                    request_type="Leave Request",
                    request_id=instance.id,
                    requester_name=requester_name,
                    status_label=instance.status,
                    details=details,
                    action_path=f"/ceo/leave/requests/{instance.id}",
                )
        except Exception:
            pass

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
        role = get_role(request.user)
        qs = self.get_queryset()
        if role not in ["SystemAdmin", "HRManager"]:
            qs = qs.filter(employee=request.user)
        try:
            instance = qs.get(pk=kwargs.get("pk"))
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        return success(LeaveRequestSerializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        return error(
            "Hard delete is not allowed.",
            errors=["Hard delete is not allowed."],
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin])
    def approve(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
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

        requested_days = get_leave_days(instance.start_date, instance.end_date)
        used_before = max(
            0.0,
            get_used_days_for_type(instance.employee, instance.leave_type, instance.start_date.year) - requested_days,
        )
        payment_breakdown = get_payment_breakdown(instance.leave_type, used_before, requested_days)

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
            send_leave_request_approved_whatsapp(instance)
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
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin])
    def reject(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
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

        audit(request, "reject", entity="LeaveRequest", entity_id=instance.id)
        try:
            send_leave_request_rejected_whatsapp(instance, comment)
        except Exception:
            pass
        try:
            send_leave_rejected_email(
                to_email=instance.employee.email,
                employee_name=instance.employee.full_name or instance.employee.email,
                leave_type=instance.leave_type.name,
                start_date=str(instance.start_date),
                end_date=str(instance.end_date),
                rejection_reason=comment,
                action_url=f"{settings.FRONTEND_URL.rstrip('/')}/employee/leave/requests",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

    @action(
        detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin], url_path="send-to-ceo"
    )
    def send_to_ceo(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
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
        return success(LeaveRequestSerializer(instance).data)

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

        audit(request, "cancel", entity="LeaveRequest", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)

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
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        filename = f"leave_request_{instance.id}.pdf"
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
    ).select_related("employee", "leave_type", "employee__employee_profile")
    serializer_class = HRManualLeaveRequestSerializer
    http_method_names = ["post", "patch", "delete", "get", "head", "options"]

    def _notify_manager(self, instance: LeaveRequest, action_label: str):
        try:
            manager = get_direct_manager_user(instance.employee)
            if not manager:
                return
            notify_users_for_pending_status(
                users=[manager],
                request_type="Manual Leave Record",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
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

        data = LeaveRequestSerializer(instance).data
        data["warning_messages"] = warnings
        return success(data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        updated = serializer.save()
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

        data = LeaveRequestSerializer(updated).data
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
        base_qs = LeaveRequest.objects.filter(is_active=True).select_related(
            "employee", "leave_type", "employee__employee_profile", "employee__employee_profile__manager_profile"
        )
        if role == "SystemAdmin":
            return base_qs

        manager_profile_match = Q()
        if hasattr(self.request.user, "employee_profile"):
            manager_profile_match = Q(employee__employee_profile__manager_profile=self.request.user.employee_profile)

        return base_qs.filter(
            (
                Q(employee__employee_profile__manager_profile__user=self.request.user)
                | Q(employee__employee_profile__manager=self.request.user)
                | manager_profile_match
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
        return success(LeaveRequestSerializer(instance).data)

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

        audit(request, "reject", entity="LeaveRequest", entity_id=instance.id)
        try:
            send_leave_request_rejected_whatsapp(instance, comment)
        except Exception:
            pass
        try:
            send_leave_rejected_email(
                to_email=instance.employee.email,
                employee_name=instance.employee.full_name or instance.employee.email,
                leave_type=instance.leave_type.name,
                start_date=str(instance.start_date),
                end_date=str(instance.end_date),
                rejection_reason=comment,
                action_url=f"{settings.FRONTEND_URL.rstrip('/')}/employee/leave/requests",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

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

        balances = calculate_leave_balance(request.user, year)

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


class LeaveBalanceAdjustmentViewSet(viewsets.ModelViewSet):
    """
    CRUD for manual leave balance adjustments.
    """

    queryset = LeaveBalanceAdjustment.objects.all().order_by("-created_at")
    serializer_class = LeaveBalanceAdjustmentSerializer
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["employee", "leave_type"]

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user)
        audit(
            self.request,
            "create_adjustment",
            entity="leave_balance_adjustment",
            entity_id=instance.id,
            metadata={"employee_id": instance.employee.id, "days": float(instance.adjustment_days)},
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
        return LeaveRequest.objects.filter(
            status=LeaveRequest.RequestStatus.PENDING_CEO,
            is_active=True,
        ).select_related("employee", "leave_type", "employee__employee_profile")

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

        instance.status = LeaveRequest.RequestStatus.APPROVED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = s.validated_data.get("comment", "")
        instance.save()

        audit(request, "approve_ceo", entity="LeaveRequest", entity_id=instance.id)
        try:
            send_leave_request_approved_whatsapp(instance)
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

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

        audit(request, "reject_ceo", entity="LeaveRequest", entity_id=instance.id)
        try:
            send_leave_request_rejected_whatsapp(instance, comment)
        except Exception:
            pass
        try:
            send_leave_rejected_email(
                to_email=instance.employee.email,
                employee_name=instance.employee.full_name or instance.employee.email,
                leave_type=instance.leave_type.name,
                start_date=str(instance.start_date),
                end_date=str(instance.end_date),
                rejection_reason=comment,
                action_url=f"{settings.FRONTEND_URL.rstrip('/')}/employee/leave/requests",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["get"])
    def document(self, request, pk=None):
        instance = self.get_object()
        return _serve_leave_document(instance, request)
