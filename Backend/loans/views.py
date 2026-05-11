from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from audit.utils import audit
from core.delegation import get_delegated_manager_user_ids
from core.pagination import StandardPagination
from core.permissions import get_role
from core.responses import error, success
from core.services import (
    get_ceo_approver_users,
    get_cfo_approver_users,
    get_direct_manager_user,
    get_disbursement_approver_users,
    get_hr_approver_users,
    notify_users_for_pending_status,
    send_request_submission_email,
    sync_workflow,
)
from leaves.permissions import IsOwnerOrHR

from .models import LoanRequest
from organization.services import filter_queryset_by_accessible_companies, filter_queryset_by_company_scope
from .permissions import (
    IsCEOApproverOrAdmin,
    IsCFOApproverOrAdmin,
    IsEmployeeOnly,
    IsFinanceApproverOrAdmin,
    IsHRApproverOrAdmin,
    IsManagerOrAdmin,
    get_active_workflow_config,
    is_accountant_user,
    is_ceo_approver_user,
    is_cfo_approver_user,
    is_hr_approver_user,
)
from .serializers import LoanRequestActionSerializer, LoanRequestCreateSerializer, LoanRequestReadSerializer

LEGACY_PENDING_HR_STATUSES = [
    LoanRequest.RequestStatus.PENDING_HR,
    LoanRequest.RequestStatus.PENDING_FINANCE,
]


def _flatten_errors(error_dict):
    errors = []
    for field, messages in error_dict.items():
        if isinstance(messages, (list, tuple)):
            for msg in messages:
                errors.append(f"{field}: {msg}")
        else:
            errors.append(f"{field}: {messages}")
    return errors


def _scope_hr_queryset_for_user(user, qs):
    if not is_hr_approver_user(user):
        return qs.none()
    return qs


def _scope_disbursement_queryset_for_user(user, qs):
    if not is_accountant_user(user):
        return qs.none()
    return qs


def _scope_cfo_queryset_for_user(user, qs):
    if not is_cfo_approver_user(user):
        return qs.none()
    return qs


def _scope_ceo_queryset_for_user(user, qs):
    if not is_ceo_approver_user(user):
        return qs.none()
    return qs


def _reject_self_approval(request, instance):
    is_hr_manager_origin = bool(instance.employee and instance.employee.groups.filter(name="HRManager").exists())
    if is_hr_manager_origin and instance.employee_id == request.user.id:
        return error("Validation error", errors=["Self approval is not allowed."], status=422)
    return None


def _next_year_month(year, month):
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _is_hr_manager_user(user):
    return bool(user and user.is_authenticated and user.groups.filter(name="HRManager").exists())


def _resolve_open_loan_target_period():
    """
    Open-loan policy:
    - Deduct in current payroll month by default.
    - If current month payroll is already finalized/paid, move target to next month.
    """
    from payroll.models import PayrollRun

    now = timezone.localtime()
    year, month = now.year, now.month
    current_run = PayrollRun.objects.filter(year=year, month=month).order_by("-id").first()
    if current_run and current_run.status in [PayrollRun.Status.COMPLETED, PayrollRun.Status.PAID]:
        return _next_year_month(year, month)
    return year, month


_LOAN_STATUS_LABELS = {
    LoanRequest.RequestStatus.SUBMITTED: ("Submitted", "مُقدّم"),
    LoanRequest.RequestStatus.PENDING_MANAGER: ("Pending Manager", "بانتظار المدير"),
    LoanRequest.RequestStatus.PENDING_HR: ("Pending HR", "بانتظار الموارد البشرية"),
    LoanRequest.RequestStatus.PENDING_FINANCE: ("Pending Finance", "بانتظار المالية"),
    LoanRequest.RequestStatus.PENDING_CFO: ("Pending CFO", "بانتظار المدير المالي"),
    LoanRequest.RequestStatus.PENDING_CEO: ("Pending CEO", "بانتظار الرئيس التنفيذي"),
    LoanRequest.RequestStatus.PENDING_DISBURSEMENT: ("Pending Disbursement", "بانتظار الصرف"),
    LoanRequest.RequestStatus.APPROVED: ("Approved", "معتمد"),
    LoanRequest.RequestStatus.REJECTED: ("Rejected", "مرفوض"),
    LoanRequest.RequestStatus.CANCELLED: ("Cancelled", "ملغي"),
    LoanRequest.RequestStatus.DEDUCTED: ("Deducted", "مخصوم"),
}

_LOAN_TYPE_LABELS = {
    LoanRequest.LoanType.OPEN: ("Open Loan", "سلفة مفتوحة"),
    LoanRequest.LoanType.INSTALLMENT: ("Installment Loan", "سلفة بالتقسيط"),
}


def _to_bool(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _display_user(user):
    if not user:
        return "-"
    return str(getattr(user, "full_name", "") or getattr(user, "email", "") or "-")


def _fmt_dt(value):
    if not value:
        return "-"
    try:
        return timezone.localtime(value).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(value)


def _build_loan_request_pdf_fallback(instance: LoanRequest) -> bytes:
    from core.pdf import (
        ApprovalStage,
        DetailRow,
        EmployeeBlock,
        ExtraSection,
        RequestDocument,
        render_request_pdf,
    )

    profile = instance.employee_profile
    employee = instance.employee
    status_en, _ = _LOAN_STATUS_LABELS.get(instance.status, (str(instance.status), str(instance.status)))
    loan_type_en, loan_type_ar = _LOAN_TYPE_LABELS.get(
        instance.loan_type, (str(instance.loan_type), str(instance.loan_type))
    )

    name = (
        getattr(profile, "full_name_en", None)
        or getattr(profile, "full_name", None)
        or getattr(employee, "full_name", None)
        or getattr(employee, "email", None)
        or "-"
    )
    department = (
        getattr(profile, "department_name_en", None) or getattr(profile, "department", None) or "-"
    )
    job_title = getattr(profile, "job_title_en", None) or getattr(profile, "job_title", None) or "-"

    employee_block = EmployeeBlock(
        name=str(name),
        employee_number=str(getattr(profile, "employee_id", "-") or "-"),
        department=str(department),
        job_title=str(job_title),
        national_id=str(getattr(profile, "national_id", "-") or "-"),
        mobile=str(getattr(profile, "mobile", "-") or "-"),
    )

    details = [
        DetailRow("Loan Type", "نوع السلفة", f"{loan_type_en} / {loan_type_ar}"),
        DetailRow("Requested Amount", "المبلغ المطلوب", f"{instance.requested_amount}"),
        DetailRow(
            "Approved Amount",
            "المبلغ المعتمد",
            f"{instance.approved_amount}" if instance.approved_amount is not None else "-",
        ),
        DetailRow(
            "Installment Months",
            "عدد الأشهر",
            str(instance.installment_months) if instance.installment_months else "-",
        ),
        DetailRow(
            "Target Deduction",
            "شهر الخصم",
            f"{instance.target_deduction_year}-{instance.target_deduction_month:02d}"
            if instance.target_deduction_year and instance.target_deduction_month
            else "-",
        ),
        DetailRow("Current Status", "الحالة الحالية", status_en),
    ]

    approvals = [
        ApprovalStage(
            stage_en="Submitted",
            stage_ar="تقديم الطلب",
            actor=_display_user(employee),
            at=_fmt_dt(instance.created_at),
            note="Loan request created",
        ),
        ApprovalStage(
            stage_en="Manager Review",
            stage_ar="مراجعة المدير",
            actor=_display_user(instance.manager_decision_by),
            at=_fmt_dt(instance.manager_decision_at),
            note=instance.manager_decision_note or (instance.manager_recommendation or "-"),
        ),
        ApprovalStage(
            stage_en="HR Review",
            stage_ar="مراجعة الموارد البشرية",
            actor=_display_user(instance.finance_decision_by),
            at=_fmt_dt(instance.finance_decision_at),
            note=instance.finance_decision_note or (instance.hr_recommendation or "-"),
        ),
        ApprovalStage(
            stage_en="CFO Review",
            stage_ar="مراجعة المدير المالي",
            actor=_display_user(instance.cfo_decision_by),
            at=_fmt_dt(instance.cfo_decision_at),
            note=instance.cfo_decision_note or "-",
        ),
        ApprovalStage(
            stage_en="CEO Review",
            stage_ar="مراجعة الرئيس التنفيذي",
            actor=_display_user(instance.ceo_decision_by),
            at=_fmt_dt(instance.ceo_decision_at),
            note=instance.ceo_decision_note or "-",
        ),
        ApprovalStage(
            stage_en="Disbursement",
            stage_ar="الصرف",
            actor=_display_user(instance.disbursed_by),
            at=_fmt_dt(instance.disbursed_at),
            note=instance.disbursement_note or "-",
        ),
    ]

    extra = []
    if instance.reason:
        extra.append(ExtraSection(title_en="Reason", title_ar="السبب", body=str(instance.reason)))

    doc = RequestDocument(
        title_en="Loan Request",
        title_ar="طلب سلفة",
        reference_no=str(instance.id),
        employee=employee_block,
        details=details,
        approvals=approvals,
        extra=extra,
        status_label=status_en,
    )
    return render_request_pdf(doc)


def _build_loan_request_pdf(instance: LoanRequest) -> bytes:
    from io import BytesIO

    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.utils import simpleSplit
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfgen import canvas

    from core.pdf import font_pair, shape_ar
    from core.views_templates import resolve_template_path

    template_path = resolve_template_path("loan_request_blank.pdf", aliases=["loan-request-template.pdf"])
    if not template_path:
        return _build_loan_request_pdf_fallback(instance)

    reader = PdfReader(template_path)
    page = reader.pages[0]
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    regular_font, bold_font = font_pair()

    profile = instance.employee_profile
    employee = instance.employee
    status_en, _ = _LOAN_STATUS_LABELS.get(instance.status, (str(instance.status), str(instance.status)))
    loan_type_en, loan_type_ar = _LOAN_TYPE_LABELS.get(
        instance.loan_type, (str(instance.loan_type), str(instance.loan_type))
    )

    def _blank(value):
        value = str(value or "").strip()
        return "" if value in {"-", "None"} else value

    def _display_user(user):
        return _blank(getattr(user, "full_name", "") or getattr(user, "email", ""))

    def _fmt_date(value):
        if not value:
            return ""
        try:
            if hasattr(value, "hour"):
                value = timezone.localtime(value)
            return value.strftime("%Y-%m-%d")
        except Exception:
            return str(value)

    def _money(value):
        if value is None:
            return ""
        try:
            return f"{value:,.2f}"
        except Exception:
            return str(value)

    def _employee_name():
        return _blank(
            getattr(profile, "full_name_en", "")
            or getattr(profile, "full_name", "")
            or getattr(employee, "full_name", "")
            or getattr(employee, "email", "")
        )

    def _employee_number():
        return _blank(getattr(profile, "employee_number", "") or getattr(profile, "employee_id", ""))

    def _department():
        return _blank(getattr(profile, "department_name_en", "") or getattr(profile, "department", ""))

    def _job_title():
        return _blank(getattr(profile, "job_title_en", "") or getattr(profile, "job_title", ""))

    def _basic_salary():
        return _money(getattr(profile, "basic_salary", None))

    def _target_deduction():
        year = getattr(instance, "target_deduction_year", None)
        month = getattr(instance, "target_deduction_month", None)
        if year and month:
            return f"{year}-{month:02d}"
        return ""

    def _latest_decision_stage():
        decisions = [
            ("Manager", instance.manager_decision_at),
            ("HR", instance.finance_decision_at),
            ("CFO", instance.cfo_decision_at),
            ("CEO", instance.ceo_decision_at),
            ("Disbursement", instance.disbursed_at),
        ]
        dated = [(stage, at) for stage, at in decisions if at]
        if not dated:
            return None
        return max(dated, key=lambda item: item[1])[0]

    def _stage_status(stage, at, pending_status):
        if at:
            if instance.status == LoanRequest.RequestStatus.REJECTED and _latest_decision_stage() == stage:
                return "Rejected"
            return "Approved"
        if instance.status == pending_status:
            return "Pending"
        return ""

    def _fit(text, font_name, size, max_width):
        value = shape_ar(_blank(text))
        if not value:
            return ""
        if pdfmetrics.stringWidth(value, font_name, size) <= max_width:
            return value
        ellipsis = "..."
        trimmed = value
        while trimmed and pdfmetrics.stringWidth(f"{trimmed}{ellipsis}", font_name, size) > max_width:
            trimmed = trimmed[:-1]
        return f"{trimmed}{ellipsis}" if trimmed else ellipsis

    def _draw_text(pdf, x, y, text, *, size=8.2, font=None, max_width=120, align="center", max_lines=1):
        value = shape_ar(_blank(text))
        if not value:
            return
        chosen_font = font or regular_font
        if max_lines == 1:
            lines = [_fit(value, chosen_font, size, max_width)]
        else:
            lines = simpleSplit(value, chosen_font, size, max_width)[:max_lines]
        pdf.setFont(chosen_font, size)
        pdf.setFillColorRGB(0.1, 0.1, 0.1)
        for index, line in enumerate(lines):
            line_y = y - (index * (size + 1.2))
            if align == "right":
                pdf.drawRightString(x, line_y, line)
            elif align == "left":
                pdf.drawString(x, line_y, line)
            else:
                pdf.drawCentredString(x, line_y, line)

    def _mask_input_lines(pdf):
        pdf.setFillColorRGB(1, 0.985, 0.965)
        line_specs = [
            (38, 752, 530),
            (38, 686, 260), (308, 686, 260),
            (38, 658, 260), (308, 658, 260),
            (38, 630, 260), (308, 630, 260),
            (38, 566, 260), (308, 566, 260),
            (38, 538, 260), (308, 538, 260),
            (38, 510, 260), (308, 510, 260),
            (38, 414, 530),
        ]
        for x, y, line_width in line_specs:
            pdf.rect(x, y - 3, line_width, 6, stroke=0, fill=1)
        pdf.setFillColorRGB(0.1, 0.1, 0.1)

    overlay = BytesIO()
    pdf = canvas.Canvas(overlay, pagesize=(width, height))
    pdf.setTitle(f"Loan Request {instance.id}")
    _mask_input_lines(pdf)

    left_x = 175
    right_x = 445
    left_w = 130
    right_w = 120

    _draw_text(pdf, left_x, 748, f"LN-{instance.id:05d}", size=9.2, font=bold_font, max_width=left_w)
    _draw_text(pdf, right_x, 748, _fmt_date(getattr(instance, "created_at", None)), size=9.2, font=bold_font, max_width=right_w)

    _draw_text(pdf, left_x, 682, _employee_name(), size=8.6, font=bold_font, max_width=left_w)
    _draw_text(pdf, right_x, 682, _employee_number(), size=8.6, font=bold_font, max_width=right_w)
    _draw_text(pdf, left_x, 654, _department(), size=8.2, max_width=left_w)
    _draw_text(pdf, right_x, 654, _job_title(), size=8.2, max_width=right_w)
    _draw_text(pdf, left_x, 626, getattr(profile, "mobile", ""), size=8.2, max_width=left_w)
    _draw_text(pdf, right_x, 626, _basic_salary(), size=8.2, max_width=right_w)

    _draw_text(pdf, left_x, 562, f"{loan_type_en} / {loan_type_ar}", size=7.4, max_width=left_w)
    _draw_text(pdf, right_x, 562, _money(instance.requested_amount), size=8.4, font=bold_font, max_width=right_w)
    _draw_text(
        pdf,
        left_x,
        534,
        str(instance.installment_months) if instance.installment_months else "",
        size=8.4,
        font=bold_font,
        max_width=left_w,
    )
    _draw_text(pdf, right_x, 534, _target_deduction(), size=8.4, max_width=right_w)
    payroll_ref = ""
    if getattr(instance, "deduction_payroll_run_id", None):
        payroll_ref = f"Payroll #{instance.deduction_payroll_run_id}"
    elif getattr(instance, "approved_year", None) and getattr(instance, "approved_month", None):
        payroll_ref = f"{instance.approved_year}-{instance.approved_month:02d}"
    _draw_text(pdf, left_x, 506, payroll_ref, size=8.2, max_width=left_w)
    _draw_text(pdf, right_x, 506, _employee_name(), size=8.2, font=bold_font, max_width=right_w)

    _draw_text(pdf, width / 2, 410, instance.reason, size=8.0, max_width=500, max_lines=2)

    stages = [
        (
            "Manager",
            instance.manager_decision_by,
            instance.manager_decision_at,
            LoanRequest.RequestStatus.PENDING_MANAGER,
        ),
        (
            "HR",
            instance.finance_decision_by,
            instance.finance_decision_at,
            LoanRequest.RequestStatus.PENDING_HR,
        ),
        ("CFO", instance.cfo_decision_by, instance.cfo_decision_at, LoanRequest.RequestStatus.PENDING_CFO),
        ("CEO", instance.ceo_decision_by, instance.ceo_decision_at, LoanRequest.RequestStatus.PENDING_CEO),
        (
            "Disbursement",
            instance.disbursed_by,
            instance.disbursed_at,
            LoanRequest.RequestStatus.PENDING_DISBURSEMENT,
        ),
    ]
    row_y = [333, 307, 281, 255, 229]
    name_x = 227
    decision_x = 339
    date_x = 432
    signature_x = 502
    for y, (stage, actor, at, pending_status) in zip(row_y, stages, strict=False):
        decision = _stage_status(stage, at, pending_status)
        actor_name = _display_user(actor) if at or decision == "Pending" else ""
        _draw_text(pdf, name_x, y, actor_name, size=6.8, font=bold_font, max_width=106)
        _draw_text(pdf, decision_x, y, decision, size=6.8, max_width=88)
        _draw_text(pdf, date_x, y, _fmt_date(at), size=6.8, max_width=68)
        _draw_text(pdf, signature_x, y, "Signed" if at else "", size=6.6, max_width=48)

    pdf.save()
    overlay.seek(0)
    page.merge_page(PdfReader(overlay).pages[0])

    output = BytesIO()
    writer = PdfWriter()
    for item in reader.pages:
        writer.add_page(item)
    writer.write(output)
    output.seek(0)
    return output.getvalue()


class LoanRequestViewSet(viewsets.ModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "employee"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_permissions(self):
        if self.action == "create":
            return [IsAuthenticated(), IsEmployeeOnly()]
        if self.action in ["list", "retrieve", "approve", "reject"]:
            return [IsAuthenticated(), IsHRApproverOrAdmin()]
        if self.action == "cancel":
            return [IsAuthenticated(), IsEmployeeOnly()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile", "company")
        if self.action == "list":
            return filter_queryset_by_company_scope(qs, self.request)
        return filter_queryset_by_accessible_companies(qs, self.request)

    def get_serializer_class(self):
        if self.action == "create":
            return LoanRequestCreateSerializer
        return LoanRequestReadSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        profile = serializer.validated_data["employee_profile"]
        manager_user = None
        if profile.manager_profile and profile.manager_profile.user_id:
            manager_user = profile.manager_profile.user
        elif profile.manager_id:
            manager_user = profile.manager

        config = get_active_workflow_config()
        if _is_hr_manager_user(request.user):
            initial_status = LoanRequest.RequestStatus.PENDING_CEO
        elif manager_user and config.require_manager_stage:
            initial_status = LoanRequest.RequestStatus.PENDING_MANAGER
        else:
            initial_status = LoanRequest.RequestStatus.PENDING_HR

        instance = LoanRequest.objects.create(
            employee=request.user,
            employee_profile=profile,
            company=profile.company,
            requested_amount=serializer.validated_data["amount"],
            loan_type=serializer.validated_data.get("loan_type", LoanRequest.LoanType.OPEN),
            installment_months=serializer.validated_data.get("installment_months"),
            reason=serializer.validated_data.get("reason", ""),
            status=initial_status,
        )
        sync_workflow(instance, actor=request.user)

        audit(
            request,
            "loan_request_submitted",
            entity="LoanRequest",
            entity_id=instance.id,
            metadata={"amount": str(instance.requested_amount), "status": instance.status},
        )
        try:
            send_request_submission_email(
                to_email=getattr(request.user, "email", None),
                employee_name=request.user.full_name or request.user.email,
                request_type="Loan Request",
                request_id=instance.id,
                status_label=instance.status,
                details=[
                    f"Loan Type: {instance.loan_type}",
                    f"Requested Amount: {instance.requested_amount}",
                ],
                action_path=f"/employee/loans/{instance.id}",
            )
        except Exception:
            pass
        try:
            requester_name = request.user.full_name or request.user.email
            details = [f"Loan Type: {instance.loan_type}", f"Requested Amount: {instance.requested_amount}"]
            if instance.status == LoanRequest.RequestStatus.PENDING_MANAGER:
                manager = get_direct_manager_user(request.user)
                if manager:
                    notify_users_for_pending_status(
                        users=[manager],
                        request_type="Loan Request",
                        request_id=instance.id,
                        requester_name=requester_name,
                        status_label=instance.status,
                        details=details,
                        action_path=f"/manager/loan-requests/{instance.id}",
                    )
            elif instance.status in LEGACY_PENDING_HR_STATUSES:
                notify_users_for_pending_status(
                    users=get_hr_approver_users(),
                    request_type="Loan Request",
                    request_id=instance.id,
                    requester_name=requester_name,
                    status_label=instance.status,
                    details=details,
                    action_path=f"/finance/loan-requests/{instance.id}",
                )
            elif instance.status == LoanRequest.RequestStatus.PENDING_CEO:
                notify_users_for_pending_status(
                    users=get_ceo_approver_users(),
                    request_type="Loan Request",
                    request_id=instance.id,
                    requester_name=requester_name,
                    status_label=instance.status,
                    details=details,
                    action_path=f"/ceo/loan-requests/{instance.id}",
                )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data, status=status.HTTP_201_CREATED)

    def list(self, request, *args, **kwargs):
        qs = _scope_hr_queryset_for_user(request.user, self.get_queryset())
        status_param = request.query_params.get("status")
        if status_param:
            if status_param == LoanRequest.RequestStatus.PENDING_HR:
                qs = qs.filter(status__in=LEGACY_PENDING_HR_STATUSES)
            else:
                qs = qs.filter(status=status_param)
        else:
            qs = qs.filter(status__in=LEGACY_PENDING_HR_STATUSES)

        employee_id = request.query_params.get("employee_id")
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        date_from = request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)

        date_to = request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        page = self.paginate_queryset(qs)
        serializer = LoanRequestReadSerializer(page if page is not None else qs, many=True)
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
        instance = _scope_hr_queryset_for_user(request.user, self.get_queryset()).filter(pk=kwargs.get("pk")).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        return success(LoanRequestReadSerializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        return error("Hard delete is not allowed.", errors=["Hard delete is not allowed."], status=405)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRApproverOrAdmin])
    def approve(self, request, pk=None):
        instance = _scope_hr_queryset_for_user(request.user, self.get_queryset()).filter(pk=pk).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status not in LEGACY_PENDING_HR_STATUSES:
            return error("Validation error", errors=["Request is not pending HR approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.PENDING_CFO
        instance.finance_decision_by = request.user
        instance.finance_decision_at = timezone.now()
        instance.finance_decision_note = serializer.validated_data.get("comment", "")
        instance.hr_recommendation = LoanRequest.Recommendation.APPROVE
        instance.save(
            update_fields=[
                "status",
                "finance_decision_by",
                "finance_decision_at",
                "finance_decision_note",
                "hr_recommendation",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_recommended_hr_approve", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_cfo_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "HR recommendation: approve"],
                action_path=f"/cfo/loan-requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRApproverOrAdmin])
    def reject(self, request, pk=None):
        instance = _scope_hr_queryset_for_user(request.user, self.get_queryset()).filter(pk=pk).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status not in LEGACY_PENDING_HR_STATUSES:
            return error("Validation error", errors=["Request is not pending HR approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.PENDING_CFO
        instance.finance_decision_by = request.user
        instance.finance_decision_at = timezone.now()
        instance.finance_decision_note = serializer.validated_data.get("comment", "")
        instance.hr_recommendation = LoanRequest.Recommendation.REJECT
        instance.save(
            update_fields=[
                "status",
                "finance_decision_by",
                "finance_decision_at",
                "finance_decision_note",
                "hr_recommendation",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_recommended_hr_reject", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_cfo_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "HR recommendation: reject"],
                action_path=f"/cfo/loan-requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsEmployeeOnly])
    def cancel(self, request, pk=None):
        instance = self.get_object()
        if instance.employee_id != request.user.id:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)

        allowed_statuses = [
            LoanRequest.RequestStatus.SUBMITTED,
            LoanRequest.RequestStatus.PENDING_MANAGER,
            LoanRequest.RequestStatus.PENDING_HR,
            LoanRequest.RequestStatus.PENDING_FINANCE,
            LoanRequest.RequestStatus.PENDING_CFO,
            LoanRequest.RequestStatus.PENDING_CEO,
        ]
        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Only pending requests can be cancelled."], status=422)

        instance.status = LoanRequest.RequestStatus.CANCELLED
        instance.save(update_fields=["status", "updated_at"])
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_cancelled", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsOwnerOrHR])
    def pdf(self, request, pk=None):
        instance = self.get_queryset().filter(pk=pk).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        self.check_object_permissions(request, instance)

        pdf_bytes = _build_loan_request_pdf(instance)
        audit(
            request,
            "loan_request_exported_pdf",
            entity="LoanRequest",
            entity_id=instance.id,
        )
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        filename = f"loan_request_{instance.id}.pdf"
        disposition = "attachment" if _to_bool(request.query_params.get("download", "1")) else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response


class EmployeeLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsEmployeeOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        return LoanRequest.objects.filter(employee=self.request.user, is_active=True).select_related(
            "employee", "employee_profile", "company"
        )

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        status_param = request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page if page is not None else qs, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": len(serializer.data)})

    def retrieve(self, request, *args, **kwargs):
        return success(super().retrieve(request, *args, **kwargs).data)


class ManagerLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsManagerOrAdmin]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_queryset(self):
        role = get_role(self.request.user)
        qs = LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile", "company")
        if self.action == "list":
            base_qs = filter_queryset_by_company_scope(qs, self.request)
        else:
            base_qs = filter_queryset_by_accessible_companies(qs, self.request)
        if role == "SystemAdmin":
            return base_qs

        manager_profile = getattr(self.request.user, "employee_profile", None)
        manager_match = Q(employee_profile__manager=self.request.user)
        if manager_profile:
            manager_match = manager_match | Q(employee_profile__manager_profile=manager_profile)
        delegated_manager_ids = get_delegated_manager_user_ids(self.request.user)
        if delegated_manager_ids:
            manager_match = manager_match | Q(employee_profile__manager_id__in=delegated_manager_ids) | Q(
                employee_profile__manager_profile__user_id__in=delegated_manager_ids
            )

        return base_qs.filter(manager_match | Q(manager_decision_by=self.request.user)).distinct()

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOrAdmin])
    def approve(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_MANAGER:
            return error("Validation error", errors=["Request is not pending manager approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.PENDING_HR
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = serializer.validated_data.get("comment", "")
        instance.manager_recommendation = LoanRequest.Recommendation.APPROVE
        instance.save(
            update_fields=[
                "status",
                "manager_decision_by",
                "manager_decision_at",
                "manager_decision_note",
                "manager_recommendation",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_recommended_manager_approve", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "Manager recommendation: approve"],
                action_path=f"/finance/loan-requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOrAdmin])
    def reject(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_MANAGER:
            return error("Validation error", errors=["Request is not pending manager approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.PENDING_HR
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = serializer.validated_data.get("comment", "")
        instance.manager_recommendation = LoanRequest.Recommendation.REJECT
        instance.save(
            update_fields=[
                "status",
                "manager_decision_by",
                "manager_decision_at",
                "manager_decision_note",
                "manager_recommendation",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_recommended_manager_reject", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "Manager recommendation: reject"],
                action_path=f"/finance/loan-requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data)


class CFOLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsCFOApproverOrAdmin]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile", "company")
        if self.action == "list":
            qs = filter_queryset_by_company_scope(qs, self.request)
        else:
            qs = filter_queryset_by_accessible_companies(qs, self.request)
        qs = _scope_cfo_queryset_for_user(self.request.user, qs)
        status_param = self.request.query_params.get("status")
        if status_param:
            return qs.filter(status=status_param)
        return qs.filter(status=LoanRequest.RequestStatus.PENDING_CFO)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsCFOApproverOrAdmin])
    def approve(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_CFO:
            return error("Validation error", errors=["Request is not pending CFO approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        approved_year, approved_month = timezone.localtime().year, timezone.localtime().month
        target_year = None
        target_month = None
        if instance.loan_type == LoanRequest.LoanType.OPEN:
            target_year, target_month = _resolve_open_loan_target_period()
        instance.status = LoanRequest.RequestStatus.PENDING_DISBURSEMENT
        instance.approved_amount = instance.requested_amount
        instance.approved_year = approved_year
        instance.approved_month = approved_month
        instance.target_deduction_year = target_year
        instance.target_deduction_month = target_month
        instance.cfo_decision_by = request.user
        instance.cfo_decision_at = timezone.now()
        instance.cfo_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "approved_amount",
                "approved_year",
                "approved_month",
                "target_deduction_year",
                "target_deduction_month",
                "cfo_decision_by",
                "cfo_decision_at",
                "cfo_decision_note",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_approved_cfo", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_disbursement_approver_users(),
                request_type="Loan Disbursement",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Approved Amount: {instance.approved_amount or instance.requested_amount}"],
                action_path=f"/finance/loan-requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsCFOApproverOrAdmin])
    def reject(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_CFO:
            return error("Validation error", errors=["Request is not pending CFO approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        comment = serializer.validated_data.get("comment", "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LoanRequest.RequestStatus.REJECTED
        instance.cfo_decision_by = request.user
        instance.cfo_decision_at = timezone.now()
        instance.cfo_decision_note = comment
        instance.save(
            update_fields=[
                "status",
                "cfo_decision_by",
                "cfo_decision_at",
                "cfo_decision_note",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_rejected_cfo", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], url_path="refer-to-ceo", permission_classes=[IsAuthenticated, IsCFOApproverOrAdmin])
    def refer_to_ceo(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_CFO:
            return error("Validation error", errors=["Request is not pending CFO approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        comment = serializer.validated_data.get("comment", "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LoanRequest.RequestStatus.PENDING_CEO
        instance.cfo_decision_by = request.user
        instance.cfo_decision_at = timezone.now()
        instance.cfo_decision_note = comment
        instance.save(
            update_fields=[
                "status",
                "cfo_decision_by",
                "cfo_decision_at",
                "cfo_decision_note",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_referred_to_ceo", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_ceo_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "Referred by CFO"],
                action_path=f"/ceo/loan-requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data)


class CEOLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsCEOApproverOrAdmin]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile", "company")
        if self.action == "list":
            qs = filter_queryset_by_company_scope(qs, self.request)
        else:
            qs = filter_queryset_by_accessible_companies(qs, self.request)
        qs = _scope_ceo_queryset_for_user(self.request.user, qs)
        status_param = self.request.query_params.get("status")
        if status_param:
            return qs.filter(status=status_param)
        return qs.filter(status=LoanRequest.RequestStatus.PENDING_CEO)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsCEOApproverOrAdmin])
    def approve(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        approved_year, approved_month = timezone.localtime().year, timezone.localtime().month
        target_year = None
        target_month = None
        if instance.loan_type == LoanRequest.LoanType.OPEN:
            target_year, target_month = _resolve_open_loan_target_period()
        instance.status = LoanRequest.RequestStatus.PENDING_DISBURSEMENT
        instance.approved_amount = instance.requested_amount
        instance.approved_year = approved_year
        instance.approved_month = approved_month
        instance.target_deduction_year = target_year
        instance.target_deduction_month = target_month
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "approved_amount",
                "approved_year",
                "approved_month",
                "target_deduction_year",
                "target_deduction_month",
                "ceo_decision_by",
                "ceo_decision_at",
                "ceo_decision_note",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_approved_ceo", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_disbursement_approver_users(),
                request_type="Loan Disbursement",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Approved Amount: {instance.approved_amount or instance.requested_amount}"],
                action_path=f"/finance/loan-requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsCEOApproverOrAdmin])
    def reject(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        comment = serializer.validated_data.get("comment", "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LoanRequest.RequestStatus.REJECTED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = comment
        instance.save(
            update_fields=[
                "status",
                "ceo_decision_by",
                "ceo_decision_at",
                "ceo_decision_note",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_rejected_ceo", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)


class DisbursementLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsFinanceApproverOrAdmin]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile", "company")
        if self.action == "list":
            qs = filter_queryset_by_company_scope(qs, self.request)
        else:
            qs = filter_queryset_by_accessible_companies(qs, self.request)
        qs = _scope_disbursement_queryset_for_user(self.request.user, qs)
        status_param = self.request.query_params.get("status")
        if status_param:
            return qs.filter(status=status_param)
        return qs.filter(status=LoanRequest.RequestStatus.PENDING_DISBURSEMENT)

    @action(detail=True, methods=["post"], url_path="mark-disbursed", permission_classes=[IsAuthenticated, IsFinanceApproverOrAdmin])
    def mark_disbursed(self, request, pk=None):
        instance = self.get_object()
        if instance.status != LoanRequest.RequestStatus.PENDING_DISBURSEMENT:
            return error("Validation error", errors=["Request is not pending disbursement."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.APPROVED
        instance.disbursed_by = request.user
        instance.disbursed_at = timezone.now()
        instance.disbursement_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "disbursed_by",
                "disbursed_at",
                "disbursement_note",
                "updated_at",
            ]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "loan_request_disbursed", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)
