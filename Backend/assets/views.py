from datetime import timedelta
from uuid import uuid4

from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Count, F, Q
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from audit.utils import audit
from core.delegation import get_delegated_manager_user_ids
from core.pagination import StandardPagination
from core.pdf import merge_pdfs
from core.permissions import IsDepartmentCEOApprover, get_role
from core.responses import error, success
from core.services import (
    get_ceo_approver_users,
    get_direct_manager_user,
    get_hr_approver_users,
    notify_users_for_pending_status,
    send_request_submission_email,
    sync_leave_obligations,
    sync_workflow,
)
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest
from loans.permissions import IsManagerOrAdmin, get_active_workflow_config
from organization.services import (
    ensure_company_write_allowed,
    filter_queryset_by_accessible_companies,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
)

from .models import Asset, AssetAssignment, AssetDamageReport, AssetReturnRequest, PrintedLabelJob
from .permissions import IsEmployeeSelfAsset, IsHRManagerOrSystemAdmin
from .serializers import (
    AssetAssignmentCreateSerializer,
    AssetDamageReportCreateSerializer,
    AssetDamageReportSerializer,
    AssetLabelsPrintSerializer,
    AssetLookupSerializer,
    AssetRequestActionSerializer,
    AssetReturnRequestCreateSerializer,
    AssetReturnRequestSerializer,
    AssetReturnSerializer,
    AssetSerializer,
    PrintedLabelJobSerializer,
)
from .services.label_pdf import render_labels_pdf


def _is_hr_manager_user(user):
    return bool(user and user.is_authenticated and user.groups.filter(name="HRManager").exists())


def _is_hr_manager_profile(profile):
    user = getattr(profile, "user", None)
    return bool(user and user.groups.filter(name="HRManager").exists())


def _flatten_errors(error_dict):
    errors = []
    for field, messages in error_dict.items():
        if isinstance(messages, (list, tuple)):
            for msg in messages:
                errors.append(f"{field}: {msg}")
        else:
            errors.append(f"{field}: {messages}")
    return errors


def _asset_invoice_pdf_bytes(asset) -> bytes | None:
    """Read the asset's invoice file bytes when it's a PDF attachment."""

    invoice = getattr(asset, "invoice_file", None)
    if not invoice:
        return None
    name = str(getattr(invoice, "name", "") or "").lower()
    if not name.endswith(".pdf"):
        return None
    try:
        invoice.open("rb")
        try:
            return invoice.read()
        finally:
            invoice.close()
    except Exception:
        return None


def _reject_self_approval(request, profile):
    if _is_hr_manager_profile(profile) and getattr(profile, "user_id", None) == request.user.id:
        return error("Validation error", errors=["Self approval is not allowed."], status=422)
    return None


def _resolve_manager_user(profile: EmployeeProfile | None):
    if not profile:
        return None
    if getattr(profile, "manager_profile_id", None) and getattr(profile.manager_profile, "user_id", None):
        return profile.manager_profile.user
    if getattr(profile, "manager_id", None):
        return profile.manager
    user = getattr(profile, "user", None)
    return get_direct_manager_user(user) if user else None


_DAMAGE_STATUS_LABELS = {
    AssetDamageReport.RequestStatus.PENDING_HR: ("Pending HR", "بانتظار الموارد البشرية"),
    AssetDamageReport.RequestStatus.PENDING_CEO: ("Pending CEO", "بانتظار الرئيس التنفيذي"),
    AssetDamageReport.RequestStatus.APPROVED: ("Approved", "معتمد"),
    AssetDamageReport.RequestStatus.REJECTED: ("Rejected", "مرفوض"),
}

_RETURN_STATUS_LABELS = {
    AssetReturnRequest.RequestStatus.PENDING_MANAGER: ("Pending Manager", "بانتظار المدير"),
    AssetReturnRequest.RequestStatus.PENDING: ("Pending", "قيد الانتظار"),
    AssetReturnRequest.RequestStatus.PENDING_CEO: ("Pending CEO", "بانتظار الرئيس التنفيذي"),
    AssetReturnRequest.RequestStatus.APPROVED: ("Approved", "معتمد"),
    AssetReturnRequest.RequestStatus.PROCESSED: ("Processed", "تم التنفيذ"),
    AssetReturnRequest.RequestStatus.REJECTED: ("Rejected", "مرفوض"),
}


def _to_bool(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _display_user_asset(user):
    if not user:
        return "-"
    return str(getattr(user, "full_name", "") or getattr(user, "email", "") or "-")


def _fmt_dt_asset(value):
    if not value:
        return "-"
    try:
        return timezone.localtime(value).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(value)


def _asset_employee_block(profile: EmployeeProfile | None):
    from core.pdf import EmployeeBlock

    if not profile:
        return EmployeeBlock()
    user = getattr(profile, "user", None)
    name = (
        getattr(profile, "full_name_en", None)
        or getattr(profile, "full_name", None)
        or getattr(user, "full_name", None)
        or getattr(user, "email", None)
        or "-"
    )
    department = (
        getattr(profile, "department_name_en", None) or getattr(profile, "department", None) or "-"
    )
    job_title = getattr(profile, "job_title_en", None) or getattr(profile, "job_title", None) or "-"
    return EmployeeBlock(
        name=str(name),
        employee_number=str(getattr(profile, "employee_id", "-") or "-"),
        department=str(department),
        job_title=str(job_title),
        national_id=str(getattr(profile, "national_id", "-") or "-"),
        mobile=str(getattr(profile, "mobile", "-") or "-"),
    )


def _build_damage_report_pdf(report: AssetDamageReport) -> bytes:
    from core.pdf import (
        ApprovalStage,
        DetailRow,
        ExtraSection,
        RequestDocument,
        render_request_pdf,
    )

    status_en, _ = _DAMAGE_STATUS_LABELS.get(report.status, (str(report.status), str(report.status)))
    asset = report.asset

    details = [
        DetailRow("Asset Code", "رمز الأصل", str(asset.asset_code or "-")),
        DetailRow("Asset Name", "اسم الأصل", str(asset.name_en or asset.name_ar or "-")),
        DetailRow("Asset Type", "نوع الأصل", str(asset.type or "-")),
        DetailRow("Serial Number", "الرقم التسلسلي", str(asset.serial_number or "-")),
        DetailRow("Reported At", "تاريخ البلاغ", _fmt_dt_asset(report.reported_at)),
        DetailRow("Current Status", "الحالة الحالية", status_en),
    ]

    approvals = [
        ApprovalStage(
            stage_en="Reported",
            stage_ar="التبليغ",
            actor=_display_user_asset(getattr(report.employee, "user", None)),
            at=_fmt_dt_asset(report.reported_at),
            note="Damage reported",
        ),
        ApprovalStage(
            stage_en="HR Review",
            stage_ar="مراجعة الموارد البشرية",
            actor=_display_user_asset(report.hr_decision_by),
            at=_fmt_dt_asset(report.hr_decision_at),
            note=report.hr_decision_note or "-",
        ),
        ApprovalStage(
            stage_en="CEO Review",
            stage_ar="مراجعة الرئيس التنفيذي",
            actor=_display_user_asset(report.ceo_decision_by),
            at=_fmt_dt_asset(report.ceo_decision_at),
            note=report.ceo_decision_note or "-",
        ),
    ]

    extra = []
    if report.description:
        extra.append(
            ExtraSection(title_en="Damage Description", title_ar="وصف الضرر", body=str(report.description))
        )

    doc = RequestDocument(
        title_en="Asset Damage Report",
        title_ar="تقرير ضرر أصل",
        reference_no=str(report.id),
        employee=_asset_employee_block(report.employee),
        details=details,
        approvals=approvals,
        extra=extra,
        status_label=status_en,
    )
    return render_request_pdf(doc)


def _build_return_request_pdf(req: AssetReturnRequest) -> bytes:
    from core.pdf import (
        ApprovalStage,
        DetailRow,
        ExtraSection,
        RequestDocument,
        render_request_pdf,
    )

    status_en, _ = _RETURN_STATUS_LABELS.get(req.status, (str(req.status), str(req.status)))
    asset = req.asset

    details = [
        DetailRow("Asset Code", "رمز الأصل", str(asset.asset_code or "-")),
        DetailRow("Asset Name", "اسم الأصل", str(asset.name_en or asset.name_ar or "-")),
        DetailRow("Asset Type", "نوع الأصل", str(asset.type or "-")),
        DetailRow("Serial Number", "الرقم التسلسلي", str(asset.serial_number or "-")),
        DetailRow("Requested At", "تاريخ الطلب", _fmt_dt_asset(req.requested_at)),
        DetailRow("Current Status", "الحالة الحالية", status_en),
    ]

    approvals = [
        ApprovalStage(
            stage_en="Requested",
            stage_ar="تقديم الطلب",
            actor=_display_user_asset(getattr(req.employee, "user", None)),
            at=_fmt_dt_asset(req.requested_at),
            note="Return requested",
        ),
        ApprovalStage(
            stage_en="Manager Review",
            stage_ar="مراجعة المدير",
            actor=_display_user_asset(req.manager_decision_by),
            at=_fmt_dt_asset(req.manager_decision_at),
            note=req.manager_decision_note or "-",
        ),
        ApprovalStage(
            stage_en="HR Review",
            stage_ar="مراجعة الموارد البشرية",
            actor=_display_user_asset(req.hr_decision_by),
            at=_fmt_dt_asset(req.hr_decision_at),
            note=req.hr_decision_note or "-",
        ),
        ApprovalStage(
            stage_en="CEO Review",
            stage_ar="مراجعة الرئيس التنفيذي",
            actor=_display_user_asset(req.ceo_decision_by),
            at=_fmt_dt_asset(req.ceo_decision_at),
            note=req.ceo_decision_note or "-",
        ),
        ApprovalStage(
            stage_en="Processed",
            stage_ar="التنفيذ",
            actor=_display_user_asset(req.processed_by),
            at=_fmt_dt_asset(req.processed_at),
            note="-",
        ),
    ]

    extra = []
    if req.note:
        extra.append(ExtraSection(title_en="Reason / Notes", title_ar="السبب / ملاحظات", body=str(req.note)))

    doc = RequestDocument(
        title_en="Asset Return Request",
        title_ar="طلب إعادة أصل",
        reference_no=str(req.id),
        employee=_asset_employee_block(req.employee),
        details=details,
        approvals=approvals,
        extra=extra,
        status_label=status_en,
    )
    return render_request_pdf(doc)


class AssetViewSet(viewsets.ModelViewSet):
    serializer_class = AssetSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter, filters.SearchFilter]
    filterset_fields = ["type", "status", "vendor", "purchase_date", "warranty_expiry"]
    search_fields = ["asset_code", "name_en", "name_ar", "serial_number", "plate_number", "mac_address"]
    ordering_fields = ["created_at", "updated_at", "warranty_expiry", "asset_code"]
    ordering = ["-created_at"]

    def get_permissions(self):
        if self.action in [
            "list",
            "retrieve",
            "create",
            "update",
            "partial_update",
            "destroy",
            "assign",
            "return_asset",
            "dashboard_summary",
            "damage_reports",
            "return_requests",
            "approve_return_request",
            "reject_return_request",
            "lookup",
            "labels_print",
            "label_jobs",
            "label_job_pdf",
        ]:
            permission_classes = [IsAuthenticated, IsHRManagerOrSystemAdmin]
        elif self.action in ["my_assets", "my_damage_reports", "my_return_requests", "damage_report", "return_request"]:
            permission_classes = [IsAuthenticated, IsEmployeeSelfAsset]
        else:
            permission_classes = [IsAuthenticated]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        qs = Asset.objects.all().prefetch_related("assignments")
        if self.action == "list":
            return filter_queryset_by_company_scope(qs, self.request)
        return filter_queryset_by_accessible_companies(qs, self.request)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"]._active_company = get_active_company_for_request(self.request)
        return context

    @staticmethod
    def _asset_snapshot(asset: Asset):
        return {
            "id": asset.id,
            "asset_code": asset.asset_code,
            "name_en": asset.name_en,
            "name_ar": asset.name_ar,
            "type": asset.type,
            "status": asset.status,
            "serial_number": asset.serial_number,
            "vendor": asset.vendor,
            "warranty_expiry": str(asset.warranty_expiry) if asset.warranty_expiry else None,
            "must_return_before_travel": asset.must_return_before_travel,
        }

    @staticmethod
    def _asset_display_name(asset: Asset) -> str:
        return asset.name_en or asset.name_ar or asset.asset_code

    def _get_request_profile(self):
        try:
            return EmployeeProfile.objects.get(user=self.request.user)
        except EmployeeProfile.DoesNotExist:
            return None

    def _is_self_assigned_asset(self, asset: Asset, profile: EmployeeProfile):
        return AssetAssignment.objects.filter(asset=asset, employee=profile, is_active=True).exists()

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        warranty_soon = str(request.query_params.get("warranty_expiring_soon", "")).lower()
        if warranty_soon in {"1", "true", "yes"}:
            today = timezone.localdate()
            expiry_cutoff = today + timedelta(days=30)
            queryset = queryset.filter(
                warranty_expiry__isnull=False,
                warranty_expiry__gte=today,
                warranty_expiry__lte=expiry_cutoff,
            )
        label_status = str(request.query_params.get("label_status", "")).lower()
        if label_status == "never_printed":
            queryset = queryset.filter(last_label_printed_at__isnull=True)
        elif label_status == "printed":
            queryset = queryset.filter(last_label_printed_at__isnull=False)
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    def retrieve(self, request, *args, **kwargs):
        return success(self.get_serializer(self.get_object()).data)

    def create(self, request, *args, **kwargs):
        ensure_company_write_allowed(request)
        company = get_active_company_for_request(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(company=company)
        audit(
            request,
            "asset_created",
            entity="Asset",
            entity_id=instance.id,
            metadata={"before": None, "after": self._asset_snapshot(instance)},
        )
        return success(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        before = self._asset_snapshot(instance)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        updated_instance = serializer.save()
        after = self._asset_snapshot(updated_instance)
        action_name = "asset_status_changed" if before["status"] != after["status"] else "asset_updated"
        audit(
            request,
            action_name,
            entity="Asset",
            entity_id=updated_instance.id,
            metadata={"before": before, "after": after},
        )
        return success(self.get_serializer(updated_instance).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.assignments.filter(is_active=True).exists():
            return error(
                "Validation error",
                errors=["Asset cannot be deleted while it has an active assignment."],
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        instance_id = instance.id
        snapshot = self._asset_snapshot(instance)
        instance.delete()
        audit(
            request,
            "asset_deleted",
            entity="Asset",
            entity_id=instance_id,
            metadata={"before": snapshot, "after": None},
        )
        return success({"id": instance_id})

    @action(detail=True, methods=["post"], url_path="assign")
    def assign(self, request, pk=None):
        serializer = AssetAssignmentCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        employee = serializer.validated_data["employee"]

        with transaction.atomic():
            asset = (
                filter_queryset_by_accessible_companies(Asset.objects.select_for_update(), request)
                .filter(pk=pk)
                .first()
            )
            if not asset:
                return error("Not found", status=status.HTTP_404_NOT_FOUND)
            if AssetAssignment.objects.select_for_update().filter(asset=asset, is_active=True).exists():
                return error(
                    "Validation error",
                    errors=["Asset is already assigned."],
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

            assignment = AssetAssignment.objects.create(
                asset=asset,
                employee=employee,
                assigned_by=request.user,
                is_active=True,
            )
            old_status = asset.status
            asset.status = Asset.AssetStatus.ASSIGNED
            asset.save(update_fields=["status", "updated_at"])

        audit(
            request,
            "asset_assigned",
            entity="AssetAssignment",
            entity_id=assignment.id,
            metadata={
                "asset_id": asset.id,
                "employee_id": employee.id,
                "status_before": old_status,
                "status_after": asset.status,
            },
        )
        return success(self.get_serializer(asset).data)

    @action(detail=True, methods=["post"], url_path="return")
    def return_asset(self, request, pk=None):
        serializer = AssetReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            asset = (
                filter_queryset_by_accessible_companies(Asset.objects.select_for_update(), request)
                .filter(pk=pk)
                .first()
            )
            if not asset:
                return error("Not found", status=status.HTTP_404_NOT_FOUND)
            assignment = (
                AssetAssignment.objects.select_for_update()
                .filter(asset=asset, is_active=True)
                .select_related("employee")
                .first()
            )
            if not assignment:
                return error(
                    "Validation error",
                    errors=["No active assignment found for this asset."],
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

            assignment.returned_at = serializer.validated_data["returned_at"]
            assignment.return_note = serializer.validated_data.get("return_note", "")
            assignment.condition_on_return = serializer.validated_data.get("condition_on_return", "")
            assignment.is_active = False
            assignment.save(
                update_fields=["returned_at", "return_note", "condition_on_return", "is_active", "updated_at"]
            )

            old_status = asset.status
            asset.status = Asset.AssetStatus.AVAILABLE
            asset.save(update_fields=["status", "updated_at"])

            pending_requests = AssetReturnRequest.objects.select_for_update().filter(
                asset=asset,
                employee=assignment.employee,
                status__in=[
                    AssetReturnRequest.RequestStatus.PENDING_MANAGER,
                    AssetReturnRequest.RequestStatus.PENDING,
                    AssetReturnRequest.RequestStatus.PENDING_CEO,
                    AssetReturnRequest.RequestStatus.APPROVED,
                ],
            )
            for request_obj in pending_requests:
                request_obj.status = AssetReturnRequest.RequestStatus.PROCESSED
                request_obj.processed_by = request.user
                request_obj.processed_at = timezone.now()
                request_obj.save(update_fields=["status", "processed_by", "processed_at"])
                sync_workflow(request_obj, actor=request.user)
            for leave_request in LeaveRequest.objects.filter(
                employee_profile=assignment.employee,
                status=LeaveRequest.RequestStatus.PENDING_CEO,
                is_active=True,
            ).select_related("employee", "employee_profile", "leave_type", "company"):
                sync_leave_obligations(leave_request, actor=request.user)

        audit(
            request,
            "asset_returned",
            entity="AssetAssignment",
            entity_id=assignment.id,
            metadata={
                "asset_id": asset.id,
                "employee_id": assignment.employee.id,
                "status_before": old_status,
                "status_after": asset.status,
            },
        )
        return success(self.get_serializer(asset).data)

    @action(detail=False, methods=["get"], url_path="dashboard-summary")
    def dashboard_summary(self, request):
        today = timezone.localdate()
        expiry_cutoff = today + timedelta(days=30)
        qs = filter_queryset_by_company_scope(Asset.objects.all(), request)

        summary = qs.aggregate(
            total=Count("id"),
            assigned=Count("id", filter=Q(status=Asset.AssetStatus.ASSIGNED)),
            available=Count("id", filter=Q(status=Asset.AssetStatus.AVAILABLE)),
            damaged=Count("id", filter=Q(status=Asset.AssetStatus.DAMAGED)),
            lost=Count("id", filter=Q(status=Asset.AssetStatus.LOST)),
            warranty_expiring_soon=Count(
                "id",
                filter=Q(warranty_expiry__isnull=False, warranty_expiry__gte=today, warranty_expiry__lte=expiry_cutoff),
            ),
        )
        return success(summary)

    @action(detail=False, methods=["get"], url_path="lookup")
    def lookup(self, request):
        code = str(request.query_params.get("code", "") or "").strip()
        if not code:
            return error("code is required", status=status.HTTP_400_BAD_REQUEST)

        asset = (
            filter_queryset_by_company_scope(
                Asset.objects.select_related("company").prefetch_related(
                    "assignments",
                    "damage_reports",
                    "return_requests",
                ),
                request,
            )
            .filter(asset_code__iexact=code)
            .first()
        )
        if not asset:
            return error("Asset not found.", status=status.HTTP_404_NOT_FOUND)
        return success(AssetLookupSerializer(asset, context={"request": request}).data)

    @action(detail=False, methods=["post"], url_path="labels/print")
    def labels_print(self, request):
        try:
            ensure_company_write_allowed(request)
        except ValueError as exc:
            return error(str(exc), status=status.HTTP_400_BAD_REQUEST)

        company = get_active_company_for_request(request)
        if not company:
            return error("Select a company to print asset labels.", status=status.HTTP_400_BAD_REQUEST)

        serializer = AssetLabelsPrintSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        asset_ids = serializer.validated_data["asset_ids"]
        paper_size = serializer.validated_data["paper_size"]
        name_language = serializer.validated_data.get("name_language", "en")

        scoped_assets = list(
            filter_queryset_by_company_scope(Asset.objects.select_related("company"), request).filter(id__in=asset_ids)
        )
        assets_by_id = {asset.id: asset for asset in scoped_assets}
        if len(assets_by_id) != len(asset_ids):
            missing_ids = [asset_id for asset_id in asset_ids if asset_id not in assets_by_id]
            return error(
                "Some assets are not available in the current company.",
                errors=[f"Missing asset ids: {missing_ids}"],
                status=status.HTTP_404_NOT_FOUND,
            )
        ordered_assets = [assets_by_id[asset_id] for asset_id in asset_ids]

        from django.conf import settings

        qr_base_url = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
        pdf_bytes = render_labels_pdf(
            ordered_assets,
            paper_size,
            name_language=name_language,
            qr_base_url=qr_base_url,
        )
        with transaction.atomic():
            job = PrintedLabelJob.objects.create(
                company=company,
                created_by=request.user,
                asset_count=len(ordered_assets),
                paper_size=paper_size,
                asset_codes=[asset.asset_code for asset in ordered_assets],
            )
            job.pdf_file.save(f"asset_labels_{uuid4().hex}.pdf", ContentFile(pdf_bytes), save=True)
            Asset.objects.filter(id__in=asset_ids).update(
                last_label_printed_at=timezone.now(),
                label_print_count=F("label_print_count") + 1,
            )

        audit(
            request,
            "asset_label_printed",
            entity="PrintedLabelJob",
            entity_id=job.id,
            metadata={
                "job_id": job.id,
                "asset_ids": asset_ids,
                "paper_size": paper_size,
                "name_language": name_language,
            },
        )

        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="asset_labels_{job.id}.pdf"'
        response["X-Label-Job-Id"] = str(job.id)
        return response

    @action(detail=False, methods=["get"], url_path="labels/jobs")
    def label_jobs(self, request):
        queryset = filter_queryset_by_company_scope(
            PrintedLabelJob.objects.select_related("company", "created_by"),
            request,
        )
        page = self.paginate_queryset(queryset)
        serializer = PrintedLabelJobSerializer(
            page if page is not None else queryset,
            many=True,
            context={"request": request},
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    @action(detail=False, methods=["get"], url_path=r"labels/jobs/(?P<job_id>[^/.]+)/pdf")
    def label_job_pdf(self, request, job_id=None):
        job = filter_queryset_by_accessible_companies(PrintedLabelJob.objects.all(), request).filter(pk=job_id).first()
        if not job or not job.pdf_file:
            return error("Not found", errors=["Not found."], status=status.HTTP_404_NOT_FOUND)
        try:
            file_handle = job.pdf_file.open("rb")
        except FileNotFoundError:
            return error("Not found", errors=["File not found."], status=status.HTTP_404_NOT_FOUND)

        response = FileResponse(file_handle, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="asset_labels_{job.id}.pdf"'
        return response

    @action(detail=False, methods=["get"], url_path="my-assets")
    def my_assets(self, request):
        role = get_role(request.user)
        if role not in ["Employee", "Manager", "HRManager"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        profile = self._get_request_profile()
        if not profile:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        asset_ids = AssetAssignment.objects.filter(employee=profile, is_active=True).values_list("asset_id", flat=True)
        queryset = self.filter_queryset(self.get_queryset().filter(id__in=asset_ids))
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)

        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    @action(detail=False, methods=["get"], url_path="damage-reports")
    def damage_reports(self, request):
        queryset = filter_queryset_by_company_scope(
            AssetDamageReport.objects.select_related("asset", "employee", "employee__user"),
            request,
            field_name="asset__company_id",
        )
        status_param = request.query_params.get("status")
        asset_id = request.query_params.get("asset")
        if status_param:
            queryset = queryset.filter(status=status_param)
        if asset_id:
            queryset = queryset.filter(asset_id=asset_id)

        page = self.paginate_queryset(queryset.order_by("-reported_at"))
        serializer = AssetDamageReportSerializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    @action(detail=False, methods=["get"], url_path="return-requests")
    def return_requests(self, request):
        queryset = filter_queryset_by_company_scope(
            AssetReturnRequest.objects.select_related("asset", "employee", "employee__user"),
            request,
            field_name="asset__company_id",
        )
        status_param = request.query_params.get("status")
        asset_id = request.query_params.get("asset")
        if status_param:
            queryset = queryset.filter(status=status_param)
        if asset_id:
            queryset = queryset.filter(asset_id=asset_id)

        page = self.paginate_queryset(queryset.order_by("-requested_at"))
        serializer = AssetReturnRequestSerializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    @action(detail=False, methods=["post"], url_path=r"return-requests/(?P<request_id>[^/.]+)/approve")
    def approve_return_request(self, request, request_id=None):
        instance = (
            filter_queryset_by_accessible_companies(
                AssetReturnRequest.objects.select_related("asset", "employee", "employee__user"),
                request,
                field_name="asset__company_id",
            )
            .filter(pk=request_id)
            .first()
        )
        if not instance:
            return error("Not found", status=status.HTTP_404_NOT_FOUND)

        self_approval_error = _reject_self_approval(request, instance.employee)
        if self_approval_error:
            return self_approval_error
        if instance.status != AssetReturnRequest.RequestStatus.PENDING:
            return error("Validation error", errors=["Request is not pending HR approval."], status=422)

        serializer = AssetRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = AssetReturnRequest.RequestStatus.APPROVED
        instance.hr_decision_by = request.user
        instance.hr_decision_at = timezone.now()
        instance.hr_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=["status", "hr_decision_by", "hr_decision_at", "hr_decision_note"]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "asset_return_request_approved_hr", entity="AssetReturnRequest", entity_id=instance.id)
        return success(AssetReturnRequestSerializer(instance, context={"request": request}).data)

    @action(detail=False, methods=["post"], url_path=r"return-requests/(?P<request_id>[^/.]+)/reject")
    def reject_return_request(self, request, request_id=None):
        instance = (
            filter_queryset_by_accessible_companies(
                AssetReturnRequest.objects.select_related("asset", "employee", "employee__user"),
                request,
                field_name="asset__company_id",
            )
            .filter(pk=request_id)
            .first()
        )
        if not instance:
            return error("Not found", status=status.HTTP_404_NOT_FOUND)

        self_approval_error = _reject_self_approval(request, instance.employee)
        if self_approval_error:
            return self_approval_error
        if instance.status != AssetReturnRequest.RequestStatus.PENDING:
            return error("Validation error", errors=["Request is not pending HR approval."], status=422)

        serializer = AssetRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        comment = (serializer.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = AssetReturnRequest.RequestStatus.REJECTED
        instance.hr_decision_by = request.user
        instance.hr_decision_at = timezone.now()
        instance.hr_decision_note = comment
        instance.save(
            update_fields=["status", "hr_decision_by", "hr_decision_at", "hr_decision_note"]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "asset_return_request_rejected_hr", entity="AssetReturnRequest", entity_id=instance.id)
        return success(AssetReturnRequestSerializer(instance, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="my-damage-reports")
    def my_damage_reports(self, request):
        role = get_role(request.user)
        if role not in ["Employee", "Manager", "HRManager"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        profile = self._get_request_profile()
        if not profile:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        queryset = AssetDamageReport.objects.select_related("asset", "employee", "employee__user").filter(employee=profile)
        status_param = request.query_params.get("status")
        asset_id = request.query_params.get("asset")
        if status_param:
            queryset = queryset.filter(status=status_param)
        if asset_id:
            queryset = queryset.filter(asset_id=asset_id)

        page = self.paginate_queryset(queryset.order_by("-reported_at"))
        serializer = AssetDamageReportSerializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    @action(detail=False, methods=["get"], url_path="my-return-requests")
    def my_return_requests(self, request):
        role = get_role(request.user)
        if role not in ["Employee", "Manager", "HRManager"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        profile = self._get_request_profile()
        if not profile:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        queryset = AssetReturnRequest.objects.select_related("asset", "employee", "employee__user").filter(employee=profile)
        status_param = request.query_params.get("status")
        asset_id = request.query_params.get("asset")
        if status_param:
            queryset = queryset.filter(status=status_param)
        if asset_id:
            queryset = queryset.filter(asset_id=asset_id)

        page = self.paginate_queryset(queryset.order_by("-requested_at"))
        serializer = AssetReturnRequestSerializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    @action(detail=True, methods=["post"], url_path="damage-report")
    def damage_report(self, request, pk=None):
        if get_role(request.user) not in ["Employee", "Manager", "HRManager"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        profile = self._get_request_profile()
        if not profile:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        asset = self.get_object()
        if not self._is_self_assigned_asset(asset, profile):
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        serializer = AssetDamageReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        is_hr_manager_request = _is_hr_manager_user(request.user)
        initial_status = (
            AssetDamageReport.RequestStatus.PENDING_CEO
            if is_hr_manager_request
            else AssetDamageReport.RequestStatus.PENDING_HR
        )
        report = AssetDamageReport.objects.create(
            asset=asset,
            employee=profile,
            description=serializer.validated_data["description"],
            status=initial_status,
        )

        audit(
            request,
            "asset_damage_reported",
            entity="AssetDamageReport",
            entity_id=report.id,
            metadata={"asset_id": asset.id, "employee_id": profile.id},
        )
        try:
            send_request_submission_email(
                to_email=getattr(request.user, "email", None),
                employee_name=profile.full_name or request.user.email,
                request_type="Asset Damage Report",
                request_id=report.id,
                status_label=report.status,
                details=[
                    f"Asset: {self._asset_display_name(asset)} ({asset.asset_code})",
                ],
                action_path="/employee/assets",
            )
        except Exception:
            pass
        try:
            approvers = get_ceo_approver_users() if report.status == AssetDamageReport.RequestStatus.PENDING_CEO else get_hr_approver_users()
            action_path = "/ceo/assets/damage-reports" if report.status == AssetDamageReport.RequestStatus.PENDING_CEO else "/hr/assets"
            notify_users_for_pending_status(
                users=approvers,
                request_type="Asset Damage Report",
                request_id=report.id,
                requester_name=profile.full_name or request.user.email,
                status_label=report.status,
                details=[f"Asset: {self._asset_display_name(asset)} ({asset.asset_code})"],
                action_path=action_path,
            )
        except Exception:
            pass
        return success(
            {"id": report.id, "reported_at": report.reported_at, "status": report.status},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="return-request")
    def return_request(self, request, pk=None):
        if get_role(request.user) not in ["Employee", "Manager", "HRManager"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        profile = self._get_request_profile()
        if not profile:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        asset = self.get_object()
        if not self._is_self_assigned_asset(asset, profile):
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        serializer = AssetReturnRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if AssetReturnRequest.objects.filter(
            asset=asset,
            employee=profile,
            status__in=[
                AssetReturnRequest.RequestStatus.PENDING_MANAGER,
                AssetReturnRequest.RequestStatus.PENDING,
                AssetReturnRequest.RequestStatus.PENDING_CEO,
                AssetReturnRequest.RequestStatus.APPROVED,
            ],
        ).exists():
            return error(
                "Validation error",
                errors=["There is already an open return request for this asset."],
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        is_hr_manager_request = _is_hr_manager_user(request.user)
        manager_user = _resolve_manager_user(profile)
        workflow_config = get_active_workflow_config()
        requester_role = get_role(request.user)
        if is_hr_manager_request:
            initial_status = AssetReturnRequest.RequestStatus.PENDING_CEO
        elif (
            workflow_config.require_manager_stage
            and requester_role != "Manager"
            and manager_user
        ):
            initial_status = AssetReturnRequest.RequestStatus.PENDING_MANAGER
        else:
            initial_status = AssetReturnRequest.RequestStatus.PENDING

        return_request = AssetReturnRequest.objects.create(
            asset=asset,
            employee=profile,
            note=serializer.validated_data["note"],
            status=initial_status,
        )
        sync_workflow(return_request, actor=request.user)

        audit(
            request,
            "asset_return_requested",
            entity="AssetReturnRequest",
            entity_id=return_request.id,
            metadata={"asset_id": asset.id, "employee_id": profile.id},
        )
        try:
            send_request_submission_email(
                to_email=getattr(request.user, "email", None),
                employee_name=profile.full_name or request.user.email,
                request_type="Asset Return Request",
                request_id=return_request.id,
                status_label=return_request.status,
                details=[
                    f"Asset: {self._asset_display_name(asset)} ({asset.asset_code})",
                ],
                action_path="/employee/assets",
            )
        except Exception:
            pass
        try:
            if return_request.status == AssetReturnRequest.RequestStatus.PENDING_CEO:
                approvers = get_ceo_approver_users()
                action_path = "/ceo/assets/return-requests"
            elif return_request.status == AssetReturnRequest.RequestStatus.PENDING_MANAGER and manager_user:
                approvers = [manager_user]
                action_path = "/manager/team-requests?tab=asset-returns"
            else:
                approvers = get_hr_approver_users()
                action_path = "/hr/assets"
            notify_users_for_pending_status(
                users=approvers,
                request_type="Asset Return Request",
                request_id=return_request.id,
                requester_name=profile.full_name or request.user.email,
                status_label=return_request.status,
                details=[
                    f"Asset: {self._asset_display_name(asset)} ({asset.asset_code})",
                    f"Current status: {return_request.status}",
                ],
                action_path=action_path,
            )
        except Exception:
            pass
        return success(
            {
                "id": return_request.id,
                "status": return_request.status,
                "requested_at": return_request.requested_at,
            },
            status=status.HTTP_201_CREATED,
        )

    def _resolve_damage_report_for_pdf(self, request, report_id):
        qs = filter_queryset_by_accessible_companies(
            AssetDamageReport.objects.select_related("asset", "employee", "employee__user"),
            request,
            field_name="asset__company_id",
        )
        report = qs.filter(pk=report_id).first()
        if not report:
            return None
        if get_role(request.user) in ["SystemAdmin", "HRManager"]:
            return report
        employee_user_id = getattr(report.employee, "user_id", None)
        if employee_user_id and employee_user_id == request.user.id:
            return report
        return None

    def _resolve_return_request_for_pdf(self, request, request_id):
        qs = filter_queryset_by_accessible_companies(
            AssetReturnRequest.objects.select_related("asset", "employee", "employee__user"),
            request,
            field_name="asset__company_id",
        )
        req = qs.filter(pk=request_id).first()
        if not req:
            return None
        if get_role(request.user) in ["SystemAdmin", "HRManager"]:
            return req
        employee_user_id = getattr(req.employee, "user_id", None)
        if employee_user_id and employee_user_id == request.user.id:
            return req
        return None

    @action(
        detail=False,
        methods=["get"],
        url_path=r"damage-reports/(?P<report_id>[^/.]+)/pdf",
        permission_classes=[IsAuthenticated],
    )
    def damage_report_pdf(self, request, report_id=None):
        report = self._resolve_damage_report_for_pdf(request, report_id)
        if not report:
            return error("Not found", errors=["Not found."], status=404)
        pdf_bytes = _build_damage_report_pdf(report)
        packet = _to_bool(request.query_params.get("packet", "0"))
        audit_action = "asset_damage_report_exported_pdf"
        if packet:
            invoice_bytes = _asset_invoice_pdf_bytes(report.asset)
            if invoice_bytes:
                pdf_bytes = merge_pdfs([pdf_bytes, invoice_bytes])
                audit_action = "asset_damage_report_exported_packet"
        audit(
            request,
            audit_action,
            entity="AssetDamageReport",
            entity_id=report.id,
        )
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        filename = (
            f"asset_damage_report_{report.id}_packet.pdf" if packet else f"asset_damage_report_{report.id}.pdf"
        )
        disposition = "attachment" if _to_bool(request.query_params.get("download", "1")) else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response

    @action(
        detail=False,
        methods=["get"],
        url_path=r"return-requests/(?P<request_id>[^/.]+)/pdf",
        permission_classes=[IsAuthenticated],
    )
    def return_request_pdf(self, request, request_id=None):
        req = self._resolve_return_request_for_pdf(request, request_id)
        if not req:
            return error("Not found", errors=["Not found."], status=404)
        pdf_bytes = _build_return_request_pdf(req)
        packet = _to_bool(request.query_params.get("packet", "0"))
        audit_action = "asset_return_request_exported_pdf"
        if packet:
            invoice_bytes = _asset_invoice_pdf_bytes(req.asset)
            if invoice_bytes:
                pdf_bytes = merge_pdfs([pdf_bytes, invoice_bytes])
                audit_action = "asset_return_request_exported_packet"
        audit(
            request,
            audit_action,
            entity="AssetReturnRequest",
            entity_id=req.id,
        )
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        filename = (
            f"asset_return_request_{req.id}_packet.pdf" if packet else f"asset_return_request_{req.id}.pdf"
        )
        disposition = "attachment" if _to_bool(request.query_params.get("download", "1")) else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response


class CEOAssetDamageReportViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AssetDamageReportSerializer
    permission_classes = [IsAuthenticated, IsDepartmentCEOApprover]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "employee", "asset"]
    ordering_fields = ["reported_at", "id"]
    ordering = ["-reported_at"]

    def get_queryset(self):
        qs = AssetDamageReport.objects.select_related("asset", "employee", "employee__user")
        if self.action == "list":
            qs = filter_queryset_by_company_scope(qs, self.request, field_name="asset__company_id")
        else:
            qs = filter_queryset_by_accessible_companies(qs, self.request, field_name="asset__company_id")
        status_param = self.request.query_params.get("status")
        if status_param:
            return qs.filter(status=status_param)
        return qs.filter(status=AssetDamageReport.RequestStatus.PENDING_CEO)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        instance = self.get_object()
        if instance.status != AssetDamageReport.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)
        if _is_hr_manager_profile(instance.employee) and instance.employee.user_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        s = AssetRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=s.errors.get("comment", ["Invalid payload."]), status=422)

        instance.status = AssetDamageReport.RequestStatus.APPROVED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = s.validated_data.get("comment", "")
        instance.save(
            update_fields=["status", "ceo_decision_by", "ceo_decision_at", "ceo_decision_note"]
        )
        audit(request, "asset_damage_report_approved_ceo", entity="AssetDamageReport", entity_id=instance.id)
        return success(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        instance = self.get_object()
        if instance.status != AssetDamageReport.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)
        if _is_hr_manager_profile(instance.employee) and instance.employee.user_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        s = AssetRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=s.errors.get("comment", ["Invalid payload."]), status=422)
        comment = (s.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = AssetDamageReport.RequestStatus.REJECTED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = comment
        instance.save(
            update_fields=["status", "ceo_decision_by", "ceo_decision_at", "ceo_decision_note"]
        )
        audit(request, "asset_damage_report_rejected_ceo", entity="AssetDamageReport", entity_id=instance.id)
        return success(self.get_serializer(instance).data)


class ManagerAssetReturnRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AssetReturnRequestSerializer
    permission_classes = [IsAuthenticated, IsManagerOrAdmin]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["requested_at", "id"]
    ordering = ["-requested_at"]

    def get_queryset(self):
        role = get_role(self.request.user)
        qs = AssetReturnRequest.objects.select_related("asset", "employee", "employee__user")
        if self.action == "list":
            base_qs = filter_queryset_by_company_scope(qs, self.request, field_name="asset__company_id")
        else:
            base_qs = filter_queryset_by_accessible_companies(qs, self.request, field_name="asset__company_id")
        if role == "SystemAdmin":
            return base_qs

        manager_profile = getattr(self.request.user, "employee_profile", None)
        manager_match = Q(employee__manager=self.request.user)
        if manager_profile:
            manager_match = manager_match | Q(employee__manager_profile=manager_profile)
        delegated_manager_ids = get_delegated_manager_user_ids(self.request.user)
        if delegated_manager_ids:
            manager_match = manager_match | Q(employee__manager_id__in=delegated_manager_ids) | Q(
                employee__manager_profile__user_id__in=delegated_manager_ids
            )

        return base_qs.filter(manager_match | Q(manager_decision_by=self.request.user)).distinct()

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        status_param = request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        else:
            queryset = queryset.filter(status=AssetReturnRequest.RequestStatus.PENDING_MANAGER)

        page = self.paginate_queryset(queryset.order_by("-requested_at"))
        serializer = self.get_serializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    def retrieve(self, request, *args, **kwargs):
        return success(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance.employee)
        if self_approval_error:
            return self_approval_error
        if instance.status != AssetReturnRequest.RequestStatus.PENDING_MANAGER:
            return error("Validation error", errors=["Request is not pending manager approval."], status=422)

        serializer = AssetRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = AssetReturnRequest.RequestStatus.PENDING
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=["status", "manager_decision_by", "manager_decision_at", "manager_decision_note"]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "asset_return_request_approved_manager", entity="AssetReturnRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Asset Return Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.user.email,
                status_label=instance.status,
                details=[f"Asset: {instance.asset.name_en or instance.asset.asset_code} ({instance.asset.asset_code})"],
                action_path="/hr/assets",
            )
        except Exception:
            pass
        return success(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance.employee)
        if self_approval_error:
            return self_approval_error
        if instance.status != AssetReturnRequest.RequestStatus.PENDING_MANAGER:
            return error("Validation error", errors=["Request is not pending manager approval."], status=422)

        serializer = AssetRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        comment = (serializer.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = AssetReturnRequest.RequestStatus.REJECTED
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = comment
        instance.save(
            update_fields=["status", "manager_decision_by", "manager_decision_at", "manager_decision_note"]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "asset_return_request_rejected_manager", entity="AssetReturnRequest", entity_id=instance.id)
        return success(self.get_serializer(instance).data)


class CEOAssetReturnRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AssetReturnRequestSerializer
    permission_classes = [IsAuthenticated, IsDepartmentCEOApprover]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "employee", "asset"]
    ordering_fields = ["requested_at", "id"]
    ordering = ["-requested_at"]

    def get_queryset(self):
        qs = AssetReturnRequest.objects.select_related("asset", "employee", "employee__user")
        if self.action == "list":
            qs = filter_queryset_by_company_scope(qs, self.request, field_name="asset__company_id")
        else:
            qs = filter_queryset_by_accessible_companies(qs, self.request, field_name="asset__company_id")
        status_param = self.request.query_params.get("status")
        if status_param:
            return qs.filter(status=status_param)
        return qs.filter(status=AssetReturnRequest.RequestStatus.PENDING_CEO)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        instance = self.get_object()
        if instance.status != AssetReturnRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)
        if _is_hr_manager_profile(instance.employee) and instance.employee.user_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        s = AssetRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=s.errors.get("comment", ["Invalid payload."]), status=422)

        instance.status = AssetReturnRequest.RequestStatus.APPROVED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = s.validated_data.get("comment", "")
        instance.save(
            update_fields=["status", "ceo_decision_by", "ceo_decision_at", "ceo_decision_note"]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "asset_return_request_approved_ceo", entity="AssetReturnRequest", entity_id=instance.id)
        return success(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        instance = self.get_object()
        if instance.status != AssetReturnRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)
        if _is_hr_manager_profile(instance.employee) and instance.employee.user_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        s = AssetRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=s.errors.get("comment", ["Invalid payload."]), status=422)
        comment = (s.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = AssetReturnRequest.RequestStatus.REJECTED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = comment
        instance.save(
            update_fields=["status", "ceo_decision_by", "ceo_decision_at", "ceo_decision_note"]
        )
        sync_workflow(instance, actor=request.user)
        audit(request, "asset_return_request_rejected_ceo", entity="AssetReturnRequest", entity_id=instance.id)
        return success(self.get_serializer(instance).data)
