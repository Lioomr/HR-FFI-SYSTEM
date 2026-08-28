import csv
import hashlib
import io
import logging
import os
import secrets
import string
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Case, CharField, Exists, F, OuterRef, Q, Value, When
from django.http import FileResponse
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from announcements.models import Announcement
from audit.utils import audit
from core.exporting import audit_export, xlsx_response
from core.pagination import EmployeePagination, StandardPagination
from core.permissions import get_role
from core.responses import error, success
from core.services import (
    get_ceo_approver_users,
    notify_profile_request_status_whatsapp,
    notify_users_for_pending_status,
)
from leaves.models import LeaveRequest
from loans.models import LoanRequest
from organization.services import (
    ensure_company_write_allowed,
    filter_queryset_by_accessible_companies,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
    get_requested_company_id,
    get_requested_organization_scope,
    get_scope_company_ids,
)

from .document_extraction import extract_document_fields
from .models import EmployeeDeletionRequest, EmployeeDocument, EmployeeImport, EmployeeProfile
from .notifications import notify_document_expiry_in_app
from .permissions import IsEmployeeOwner, IsHRManagerOnly, IsHRManagerOrAdmin
from .serializers import (
    DelegationCandidateSerializer,
    EmployeeDeletionRequestCreateSerializer,
    EmployeeDeletionRequestReadSerializer,
    EmployeeDocumentSerializer,
    EmployeeImportSerializer,
    EmployeeProfileReadSerializer,
    EmployeeProfileWriteSerializer,
    ScopedEmployeeReadSerializer,
)
from .services import (
    MANAGER_SCOPES,
    EmployeeImporter,
    has_manager_access,
    managed_reports_queryset,
    manager_scope_q,
)
from .services.manager_relationships import (
    active_cross_company_manager_assignments,
    log_manager_assignment_change,
    reroute_pending_manager_requests,
)
from .storage import PrivateUploadStorage
from .tasks import extract_employee_document
from .throttles import EmployeeImportThrottle

logger = logging.getLogger(__name__)


def _log_notification_failure(event_name, *, entity_id, notification_type, actor_id=None, channel=None):
    extra = {"entity_id": entity_id, "notification_type": notification_type}
    if actor_id is not None:
        extra["actor_id"] = actor_id
    if channel is not None:
        extra["channel"] = channel
    logger.exception(event_name, extra=extra)


def _log_audit_failure(event_name, *, entity_id, actor_id=None):
    extra = {"entity_id": entity_id}
    if actor_id is not None:
        extra["actor_id"] = actor_id
    logger.exception(event_name, extra=extra)

try:
    from openpyxl import load_workbook
except Exception:  # pragma: no cover - fallback for missing dependency
    load_workbook = None


def _cross_company_employee_scope_for_request(request):
    """Return delegated-read and exceptional-manager access for one requested scope."""
    scope = get_requested_organization_scope(request)
    if scope is None:
        return None, set(), set()

    from core.delegation import get_active_employee_read_scope_ids
    read_scope_ids = get_active_employee_read_scope_ids(request.user)
    from core.models import CrossCompanyManagerAssignment

    manager_assignment_ids = set(
        active_cross_company_manager_assignments(
            request.user,
            capability=CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW,
        ).filter(scope=scope).values_list("employee_id", flat=True)
    )
    if scope.id not in read_scope_ids and not manager_assignment_ids:
        from rest_framework.exceptions import PermissionDenied

        raise PermissionDenied("You do not have an active grant for the requested organization scope.")

    company_ids = get_scope_company_ids(scope)
    selected_company_id = get_requested_company_id(request)
    if selected_company_id is not None:
        company_ids &= {selected_company_id}
    return scope, company_ids if scope.id in read_scope_ids else set(), manager_assignment_ids


def _queue_document_extraction(document: EmployeeDocument) -> list[str]:
    if document.document_type == EmployeeDocument.DocumentType.OTHER:
        return extract_document_fields(document)
    try:
        extract_employee_document.apply_async(args=[document.id], retry=False)
        return []
    except Exception:
        logger.exception("employee_document_ocr_queue_failed", extra={"document_id": document.id})
        document.extraction_status = EmployeeDocument.ExtractionStatus.FAILED
        document.extraction_error = "OCR worker is unavailable."
        document.save(update_fields=["extraction_status", "extraction_error", "updated_at"])
        return ["Document was saved, but OCR could not be queued."]


def generate_employee_id(prefix="FFI"):
    suffix = "".join(secrets.choice(string.digits) for _ in range(6))
    return f"{prefix}-{suffix}"


def _audit_snapshot(instance: EmployeeProfile) -> dict:
    return {
        "id": instance.id,
        "employee_id": instance.employee_id,
        "full_name": instance.full_name,
        "full_name_en": instance.full_name_en,
        "user_id": instance.user.id if instance.user else None,
        "email": instance.user.email if instance.user else "",
        "department_id": instance.department_ref.id if instance.department_ref else None,
        "position_id": instance.position_ref.id if instance.position_ref else None,
        "task_group_id": instance.task_group_ref.id if instance.task_group_ref else None,
        "sponsor_id": instance.sponsor_ref.id if instance.sponsor_ref else None,
        "employment_status": instance.employment_status,
        "is_archived": instance.is_archived,
        "archived_at": instance.archived_at.isoformat() if instance.archived_at else None,
        "archived_by_id": instance.archived_by_id,
        "archive_reason": instance.archive_reason,
        "manager_profile_id": instance.manager_profile.id if instance.manager_profile else None,
        "manager_id": instance.manager_id,
        "data_source": instance.data_source,
    }


def _deletion_request_snapshot(instance: EmployeeProfile) -> dict:
    return {
        "employee_profile_id": instance.id,
        "target_user_id": instance.user_id,
        "employee_id": instance.employee_id,
        "full_name": instance.full_name,
        "full_name_en": instance.full_name_en,
        "full_name_ar": instance.full_name_ar,
        "email": instance.user.email if instance.user_id else "",
        "company_id": instance.company_id,
        "company_name": instance.company.name if instance.company_id else "",
        "employment_status": instance.employment_status,
        "is_archived": instance.is_archived,
        "archive_reason": instance.archive_reason,
        "department_id": instance.department_ref_id,
        "department_name": instance.department_ref.name if instance.department_ref_id else instance.department,
        "position_id": instance.position_ref_id,
        "position_name": instance.position_ref.name if instance.position_ref_id else instance.job_title,
    }


def _sync_legacy_fields(instance: EmployeeProfile) -> None:
    updates = []
    if instance.department_ref and instance.department != instance.department_ref.name:
        instance.department = instance.department_ref.name
        updates.append("department")
    if instance.position_ref and instance.job_title != instance.position_ref.name:
        instance.job_title = instance.position_ref.name
        updates.append("job_title")
    if updates:
        instance.save(update_fields=updates)


def _with_effective_status(queryset):
    today = timezone.localdate()
    active_leave_subquery = LeaveRequest.objects.filter(
        status=LeaveRequest.RequestStatus.APPROVED,
        start_date__lte=today,
        end_date__gte=today,
    ).filter(Q(employee_profile=OuterRef("pk")) | Q(employee=OuterRef("user_id")))

    return queryset.annotate(
        active_leave_today=Exists(active_leave_subquery),
        effective_employment_status=Case(
            When(
                employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
                active_leave_today=True,
                then=Value("ON_LEAVE"),
            ),
            default=F("employment_status"),
            output_field=CharField(),
        ),
    )


EXPECTED_IMPORT_HEADERS = [
    "Emp Full Name",
    "Employee number ",  # Space at the end
    "Nationality ",  # Space at the end
    "Position Name",
    "Passport Number",
    "Passport Expiry",
    " ID",  # Space at the start
    " ID Expiry",  # Space at the start
    "Date Of Birth",
    "JOB OFFER ",  # Space at the end
    " Joining Date",  # Space at the start
    "Contract date ",  # Space at the end
    "Contract Expiry Date ",  # Space at the end
    "Task Group Name",
    "Health Card",
    "Health Card Expiry",
    "Mobile Number",
    "Sponsor Code",
    "Basic Salary",
    "Transportation Allowance",
    "Accommodation Allowance",
    "Telephone Allowance",
    "Petrol Allowance",
    "Other Allowance",
    "Total Salary",
    "Payment Mode",
    "Allowed Overtime",
    "department",
    "SID monthly expense",
]
MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 5000
ALLOWED_IMPORT_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
PRIVATE_STORAGE = PrivateUploadStorage()


def _error_response(errors, status_code):
    return Response(
        {"status": "error", "message": "Import failed", "errors": errors},
        status=status_code,
    )


def _has_xlsx_signature(uploaded_file):
    signature = uploaded_file.read(4)
    uploaded_file.seek(0)
    return signature in (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")


def _compute_file_hash(uploaded_file):
    hasher = hashlib.sha256()
    for chunk in uploaded_file.chunks():
        hasher.update(chunk)
    uploaded_file.seek(0)
    return hasher.hexdigest()


def _build_reference_lookup(queryset):
    lookup = {}
    for obj in queryset:
        if obj.name:
            lookup[obj.name.strip().lower()] = obj
        if obj.code:
            lookup[obj.code.strip().lower()] = obj
    return lookup


def _normalize_cell(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _write_errors_csv(errors_detail):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["row", "column", "message"])
    for detail in errors_detail:
        writer.writerow([detail["row"], detail["column"], detail["message"]])
    return output.getvalue().encode("utf-8")


def _audit_import(request, file_hash, row_count, result):
    audit(
        request,
        action="employee_import",
        entity="Employee",
        metadata={
            "file_hash": file_hash or "",
            "row_count": row_count,
            "result": result,
        },
    )


def _parse_date_ddmmyyyy(raw_value):
    if not raw_value:
        return None, None
    value = _normalize_cell(raw_value)
    if not value:
        return None, None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date(), None
        except ValueError:
            continue
    return None, f"Invalid date format (expected DD/MM/YYYY): {value}"


def _parse_decimal(raw_value):
    if raw_value is None:
        return None, None
    value = _normalize_cell(raw_value)
    if not value:
        return None, None
    cleaned = value.replace(",", "").replace("$", "").replace("SAR", "").strip()
    try:
        return Decimal(cleaned), None
    except InvalidOperation:
        return None, f"Invalid numeric value: {value}"


def _generate_unique_employee_id(existing_ids, max_attempts=10):
    for _ in range(max_attempts):
        candidate = generate_employee_id()
        if candidate not in existing_ids:
            existing_ids.add(candidate)
            return candidate
    return None


class EmployeeProfileViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = EmployeePagination
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        if self.action == "import_excel":
            permission_classes = [IsAuthenticated, IsHRManagerOnly]
        elif self.action in ["list", "manager_access", "manager_team", "delegation_candidates"]:
            permission_classes = [IsAuthenticated]
        elif self.action == "retrieve":
            # get_queryset is the object-level authorization boundary.  A separate
            # manager-only permission would incorrectly reject scoped delegation.
            permission_classes = [IsAuthenticated]
        elif self.action == "me":
            permission_classes = [IsAuthenticated, IsHRManagerOrAdmin | IsEmployeeOwner]
        elif self.action in ["documents", "download_document", "update_document"]:
            permission_classes = [IsAuthenticated]
        elif self.action == "notify_document_expiry":
            permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
        else:
            permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)

        base_qs = EmployeeProfile.objects.select_related(
            "user",
            "archived_by",
            "manager",
            "manager_profile",
            "manager_profile__user",
            "department_ref",
            "position_ref",
            "task_group_ref",
            "sponsor_ref",
        )
        base_qs = _with_effective_status(base_qs)

        archive_state = self.request.query_params.get("archive_state", "active").lower()
        if self.action == "restore":
            base_qs = base_qs.filter(is_archived=True)
        elif archive_state == "archived" and role in ["SystemAdmin", "HRManager"]:
            base_qs = base_qs.filter(is_archived=True)
        elif archive_state == "all" and role in ["SystemAdmin", "HRManager"]:
            pass
        else:
            base_qs = base_qs.filter(is_archived=False)

        if role in ["SystemAdmin", "HRManager"]:
            return filter_queryset_by_company_scope(base_qs, self.request)

        scope, delegated_company_ids, manager_assignment_ids = _cross_company_employee_scope_for_request(self.request)
        if scope is not None:
            scope_company_ids = get_scope_company_ids(scope)
            selected_company_id = get_requested_company_id(self.request)
            if selected_company_id is not None:
                scope_company_ids &= {selected_company_id}
            return base_qs.filter(
                Q(company_id__in=delegated_company_ids)
                | Q(pk__in=manager_assignment_ids, company_id__in=scope_company_ids)
            ).distinct()

        if self.action == "retrieve":
            return filter_queryset_by_company_scope(base_qs, self.request).filter(
                Q(user=user) | manager_scope_q(user)
            ).distinct()

        return filter_queryset_by_company_scope(base_qs, self.request).filter(user=user)

    def get_serializer_class(self):
        if self.action == "delegation_candidates":
            return DelegationCandidateSerializer
        if self.action == "documents":
            return EmployeeDocumentSerializer
        if self.action in ["list", "retrieve", "me"]:
            if self.action != "me" and get_requested_organization_scope(self.request) is not None:
                return ScopedEmployeeReadSerializer
            return EmployeeProfileReadSerializer
        return EmployeeProfileWriteSerializer

    @action(detail=True, methods=["post"], url_path="restore")
    def restore(self, request, pk=None):
        profile = self.get_object()
        if not profile.is_archived:
            return error("Validation error", errors=["Employee is not archived."], status=422)

        previous = _audit_snapshot(profile)
        with transaction.atomic():
            profile = EmployeeProfile.objects.select_for_update(of=("self",)).select_related("user").get(pk=profile.pk)
            should_reactivate_user = True
            latest_request = (
                EmployeeDeletionRequest.objects.filter(
                    employee_profile=profile, status=EmployeeDeletionRequest.Status.EXECUTED
                )
                .order_by("-executed_at", "-id")
                .first()
            )
            if latest_request:
                should_reactivate_user = bool(
                    (latest_request.execution_snapshot or {}).get("target_user_was_active", True)
                )

            profile.is_archived = False
            profile.archived_at = None
            profile.archived_by = None
            profile.archive_reason = None
            profile.save(update_fields=["is_archived", "archived_at", "archived_by", "archive_reason", "updated_at"])

            if profile.user_id and should_reactivate_user and not profile.user.is_active:
                profile.user.is_active = True
                profile.user.save(update_fields=["is_active"])

        audit(
            request,
            "employee_restored",
            entity="EmployeeProfile",
            entity_id=profile.id,
            metadata={"employee_before": previous, "restored_by": request.user.id},
        )
        return success(EmployeeProfileReadSerializer(profile, context=self.get_serializer_context()).data)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"]._active_company = get_active_company_for_request(self.request)
        return context

    def _apply_filters(self, qs):
        params = self.request.query_params
        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(full_name__icontains=search)
                | Q(full_name_en__icontains=search)
                | Q(full_name_ar__icontains=search)
                | Q(employee_id__icontains=search)
                | Q(employee_number__icontains=search)
                | Q(mobile__icontains=search)
                | Q(passport_no__icontains=search)
                | Q(national_id__icontains=search)
            )

        department = params.get("department")
        if department:
            qs = qs.filter(Q(department_ref__code__iexact=department) | Q(department__iexact=department))

        position = params.get("position")
        if position:
            qs = qs.filter(position_ref__code__iexact=position)

        task_group = params.get("task_group")
        if task_group:
            qs = qs.filter(task_group_ref__code__iexact=task_group)

        sponsor = params.get("sponsor")
        if sponsor:
            qs = qs.filter(sponsor_ref__code__iexact=sponsor)

        status_value = params.get("status")
        if status_value:
            if status_value == "ON_LEAVE":
                qs = qs.filter(effective_employment_status="ON_LEAVE")
            else:
                qs = qs.filter(effective_employment_status=status_value)

        nationality = params.get("nationality")
        if nationality:
            qs = qs.filter(
                Q(nationality__icontains=nationality)
                | Q(nationality_en__icontains=nationality)
                | Q(nationality_ar__icontains=nationality)
            )

        join_date_order = params.get("join_date_order")
        if join_date_order == "asc":
            qs = qs.order_by("hire_date", "employee_id")
        elif join_date_order == "desc":
            qs = qs.order_by("-hire_date", "employee_id")

        return qs

    def list(self, request, *args, **kwargs):
        qs = self._apply_filters(self.get_queryset())
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page if page is not None else qs, many=True)

        if page is not None:
            return self.get_paginated_response(serializer.data)

        return success({"results": serializer.data, "count": qs.count()})

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        qs = self._apply_filters(self.get_queryset()).order_by("full_name", "employee_id", "id")
        headers = [
            "Employee ID",
            "Full Name",
            "Email",
            "Department",
            "Position",
            "Manager",
            "Nationality",
            "Join Date",
            "Status",
        ]
        rows = [
            [
                profile.employee_id,
                profile.full_name,
                profile.user.email if profile.user_id else "",
                profile.department_ref.name if profile.department_ref_id else profile.department,
                profile.position_ref.name if profile.position_ref_id else profile.job_title,
                (
                    profile.manager_profile.full_name
                    if profile.manager_profile_id
                    else (profile.manager.full_name if profile.manager_id else "")
                ),
                profile.nationality or profile.nationality_en or profile.nationality_ar or "",
                profile.hire_date.isoformat() if profile.hire_date else "",
                getattr(profile, "effective_employment_status", profile.employment_status),
            ]
            for profile in qs.iterator(chunk_size=2000)
        ]
        audit_export(
            request,
            entity="EmployeeProfile",
            export_format="xlsx",
            metadata={"count": len(rows)},
        )
        return xlsx_response(
            headers=headers,
            rows=rows,
            filename="employees.xlsx",
            sheet_name="Employees",
        )

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def _document_profile_for_request(self, request, pk):
        profiles = filter_queryset_by_company_scope(
            EmployeeProfile.objects.select_related("user", "company"),
            request,
        )
        role = get_role(request.user)
        if str(pk) == "me":
            profile = profiles.filter(user=request.user).first()
        elif role in ["SystemAdmin", "HRManager"]:
            profile = profiles.filter(pk=pk).first()
        elif request.method in ["GET", "HEAD", "OPTIONS"]:
            profile = profiles.filter(pk=pk, user=request.user).first()
        else:
            profile = None
        if profile is None:
            return None, error("Not found", errors=["Not found."], status=404)
        return profile, None

    @staticmethod
    def _documents_for_profile(profile):
        return profile.documents.select_related("uploaded_by", "company", "leave_request").filter(
            company_id=profile.company_id
        )

    @action(detail=True, methods=["get", "post"], url_path="documents")
    def documents(self, request, pk=None):
        if get_requested_organization_scope(request) is not None and get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            return error("Forbidden", errors=["Scoped employee access does not include documents."], status=status.HTTP_403_FORBIDDEN)
        profile, error_response = self._document_profile_for_request(request, pk)
        if error_response:
            return error_response

        if request.method == "GET":
            qs = self._documents_for_profile(profile)
            serializer = EmployeeDocumentSerializer(qs, many=True, context={"request": request})
            return success(serializer.data)

        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"]:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)

        serializer = EmployeeDocumentSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)

        ensure_company_write_allowed(request)
        document = serializer.save(
            employee_profile=profile,
            company=profile.company,
            uploaded_by=request.user,
            original_filename=os.path.basename(getattr(serializer.validated_data.get("file"), "name", "")),
        )
        warnings = _queue_document_extraction(document)
        document.extraction_warnings = warnings

        audit(
            request,
            "employee_document_uploaded",
            entity="employee_document",
            entity_id=document.id,
            metadata={
                "employee_profile_id": profile.id,
                "document_type": document.document_type,
                "extraction_status": document.extraction_status,
                "warnings": warnings,
            },
        )
        return success(
            EmployeeDocumentSerializer(document, context={"request": request}).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["get"], url_path=r"documents/(?P<document_id>[^/.]+)/download")
    def download_document(self, request, pk=None, document_id=None):
        if get_requested_organization_scope(request) is not None and get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            return error("Forbidden", errors=["Scoped employee access does not include documents."], status=status.HTTP_403_FORBIDDEN)
        profile, error_response = self._document_profile_for_request(request, pk)
        if error_response:
            return error_response

        document = self._documents_for_profile(profile).filter(pk=document_id).first()
        if document is None:
            return error("Not found", errors=["Not found."], status=404)

        try:
            filename = (
                document.original_filename or document.file.name.split("/")[-1] or f"employee_document_{document.id}"
            )
            response = FileResponse(
                document.file.open("rb"),
                content_type="application/octet-stream",
                as_attachment=True,
                filename=os.path.basename(filename),
            )
            response["X-Content-Type-Options"] = "nosniff"
            response["Cache-Control"] = "private, no-store"
            audit(
                request,
                "employee_document_downloaded",
                entity="employee_document",
                entity_id=document.id,
                metadata={"employee_profile_id": profile.id, "document_type": document.document_type},
            )
            return response
        except FileNotFoundError:
            return error("Not found", errors=["Document file is missing from storage."], status=404)

    @action(detail=True, methods=["patch"], url_path=r"documents/(?P<document_id>[^/.]+)")
    def update_document(self, request, pk=None, document_id=None):
        if get_requested_organization_scope(request) is not None and get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            return error("Forbidden", errors=["Scoped employee access does not include documents."], status=status.HTTP_403_FORBIDDEN)
        profile, error_response = self._document_profile_for_request(request, pk)
        if error_response:
            return error_response

        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"]:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)

        document = self._documents_for_profile(profile).filter(pk=document_id).first()
        if document is None:
            return error("Not found", errors=["Not found."], status=404)

        serializer = EmployeeDocumentSerializer(document, data=request.data, partial=True, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        document = serializer.save()
        audit(
            request,
            "employee_document_updated",
            entity="employee_document",
            entity_id=document.id,
            metadata={"employee_profile_id": profile.id, "document_type": document.document_type},
        )
        return success(EmployeeDocumentSerializer(document, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path=r"documents/(?P<document_id>[^/.]+)/extract")
    def extract_document(self, request, pk=None, document_id=None):
        profile, error_response = self._document_profile_for_request(request, pk)
        if error_response:
            return error_response

        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"]:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)

        document = self._documents_for_profile(profile).filter(pk=document_id).first()
        if document is None:
            return error("Not found", errors=["Not found."], status=404)

        document.extraction_status = EmployeeDocument.ExtractionStatus.PENDING
        document.extraction_error = ""
        document.save(update_fields=["extraction_status", "extraction_error", "updated_at"])
        warnings = _queue_document_extraction(document)
        document.extraction_warnings = warnings
        audit(
            request,
            "employee_document_extraction_queued",
            entity="employee_document",
            entity_id=document.id,
            metadata={"employee_profile_id": profile.id, "document_type": document.document_type},
        )
        return success(EmployeeDocumentSerializer(document, context={"request": request}).data)

    @staticmethod
    def _document_notification_label(document: EmployeeDocument) -> str:
        return document.display_name or "Document"

    @staticmethod
    def _whatsapp_delivery_exception(exc: Exception) -> dict:
        return {
            "sent": False,
            "success": False,
            "provider": "evolution_whatsapp",
            "status_code": None,
            "message_id": None,
            "error": str(exc),
            "reason": str(exc),
        }

    @action(detail=True, methods=["post"], url_path=r"documents/(?P<document_id>[^/.]+)/notify-expiry")
    def notify_document_expiry(self, request, pk=None, document_id=None):
        profile, error_response = self._document_profile_for_request(request, pk)
        if error_response:
            return error_response

        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"]:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)

        document = self._documents_for_profile(profile).filter(pk=document_id).first()
        if document is None:
            return error("Not found", errors=["Not found."], status=404)

        if not document.exit_before:
            return error(
                "Validation error",
                errors={"expiry_date": ["Document has no expiry date."]},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        today = timezone.localdate()
        days_left = (document.exit_before - today).days
        if days_left > 45:
            return error(
                "Validation error",
                errors={"expiry_date": ["Document is not expired or expiring within 45 days."]},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        document_payload = {
            "id": document.id,
            "doc_type": document.document_type,
            "label": self._document_notification_label(document),
            "expiry_date": document.exit_before,
            "days_left": days_left,
        }

        try:
            dispatch = notify_document_expiry_in_app(profile, [document_payload])[0]
        except Exception:
            _log_notification_failure(
                "employee_document_expiry_notification_failed",
                entity_id=document.id,
                notification_type="document_expiry",
                actor_id=request.user.id,
            )
            dispatch = {"whatsapp": {"status": "failed", "provider": "evolution_whatsapp"}}
        channel_delivery = dispatch.get("whatsapp") or {}
        if channel_delivery.get("status") != "sent":
            channel_delivery = dispatch.get("email") or channel_delivery
        delivery = {
            "sent": channel_delivery.get("status") == "sent",
            "success": channel_delivery.get("status") == "sent",
            "queued": channel_delivery.get("status") == "pending",
            "status": channel_delivery.get("status"),
            "provider": channel_delivery.get("provider"),
            "message_id": channel_delivery.get("provider_message_id"),
            "error": channel_delivery.get("error"),
            "dispatch": {"whatsapp": dispatch.get("whatsapp"), "email": dispatch.get("email")},
        }

        try:
            audit(
                request,
                action="employee_document_expiry_whatsapp_sent",
                entity="employee_document",
                entity_id=document.id,
                metadata={
                    "employee_profile_id": profile.id,
                    "document_type": document.document_type,
                    "expiry_date": document.exit_before.isoformat(),
                    "days_left": days_left,
                    "delivery": delivery,
                },
            )
        except Exception:
            _log_audit_failure(
                "employee_document_expiry_audit_failed",
                entity_id=document.id,
                actor_id=request.user.id,
            )

        return success(
            {
                "document": {
                    "id": document.id,
                    "document_type": document.document_type,
                    "display_name": document_payload["label"],
                    "expiry_date": document.exit_before.isoformat(),
                    "days_left": days_left,
                },
                "delivery": delivery,
            }
        )

    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request):
        try:
            profile = EmployeeProfile.objects.select_related(
                "user",
                "archived_by",
                "manager",
                "manager_profile",
                "manager_profile__user",
                "department_ref",
                "position_ref",
                "task_group_ref",
                "sponsor_ref",
                "company",
            ).get(user=request.user)
        except EmployeeProfile.DoesNotExist:
            return error("Profile not found.", status=status.HTTP_404_NOT_FOUND)

        year_param = request.query_params.get("leave_balance_year") or request.query_params.get("year")
        if year_param:
            try:
                leave_balance_year = int(year_param)
            except ValueError:
                return error("Validation error", errors=["year must be a valid integer."], status=422)
        else:
            leave_balance_year = timezone.localdate().year

        active_company = get_active_company_for_request(request)
        serializer = self.get_serializer(
            profile,
            context={
                **self.get_serializer_context(),
                "include_leave_balances": True,
                "leave_balance_year": leave_balance_year,
                "active_company": active_company,
            },
        )
        return success(serializer.data)

    @action(
        detail=False,
        methods=["get"],
        url_path="delegation-candidates",
        permission_classes=[IsAuthenticated],
    )
    def delegation_candidates(self, request):
        qs = EmployeeProfile.objects.select_related("user", "company").filter(
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            is_archived=False,
            user__isnull=False,
            user__is_active=True,
        )

        requested_scope = (request.query_params.get("scope") or "active").strip().lower()
        if requested_scope in {"all", "accessible"}:
            if get_role(request.user) not in {"SystemAdmin", "HRManager"}:
                return error("Forbidden", status=status.HTTP_403_FORBIDDEN)
            qs = filter_queryset_by_accessible_companies(qs, request)
        else:
            qs = filter_queryset_by_company_scope(qs, request)

        qs = qs.exclude(user=request.user).order_by("company__name", "full_name_en", "full_name", "employee_id")
        serializer = self.get_serializer(qs, many=True)
        return success(serializer.data)

    @action(
        detail=False,
        methods=["get"],
        url_path="manager/access",
        permission_classes=[IsAuthenticated],
    )
    def manager_access(self, request):
        role = get_role(request.user)
        from core.models import CrossCompanyManagerAssignment

        reports = managed_reports_queryset(
            request.user,
            cross_company_capability=CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW,
        )
        managed_employee_count = reports.count()
        if managed_employee_count:
            direct_report_count = reports.filter(manager_profile__user=request.user).count()
            source = "direct_reports" if direct_report_count else "delegation"
            has_access = True
        elif role == "SystemAdmin":
            source = "admin"
            has_access = True
        else:
            source = "none"
            has_access = False
        return success(
            {
                "has_access": has_access,
                "managed_employee_count": managed_employee_count,
                "source": source,
                "scopes": MANAGER_SCOPES if has_access else [],
            }
        )

    @action(
        detail=False,
        methods=["get"],
        url_path="manager/team",
        permission_classes=[IsAuthenticated],
    )
    def manager_team(self, request):
        role = get_role(request.user)
        from core.models import CrossCompanyManagerAssignment

        if role != "SystemAdmin" and not has_manager_access(
            request.user,
            cross_company_capability=CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW,
        ):
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        base_qs = EmployeeProfile.objects.select_related(
            "user",
            "archived_by",
            "manager",
            "manager_profile",
            "manager_profile__user",
            "department_ref",
            "position_ref",
            "task_group_ref",
            "sponsor_ref",
        )
        base_qs = _with_effective_status(base_qs).filter(is_archived=False)
        if role == "SystemAdmin":
            qs = filter_queryset_by_company_scope(base_qs, request)
        else:
            scope, _, manager_assignment_ids = _cross_company_employee_scope_for_request(request)
            if scope is not None:
                scope_company_ids = get_scope_company_ids(scope)
                selected_company_id = get_requested_company_id(request)
                if selected_company_id is not None:
                    scope_company_ids &= {selected_company_id}
                base_qs = base_qs.filter(company_id__in=scope_company_ids)
                from core.models import CrossCompanyManagerAssignment

                qs = base_qs.filter(
                    manager_scope_q(
                        request.user,
                        cross_company_capability=CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW,
                    ),
                    pk__in=manager_assignment_ids,
                ).distinct()
            else:
                base_qs = filter_queryset_by_company_scope(base_qs, request)
                qs = base_qs.filter(manager_scope_q(request.user)).distinct()

        search = request.query_params.get("search")
        if search:
            qs = qs.filter(
                Q(full_name__icontains=search)
                | Q(full_name_en__icontains=search)
                | Q(full_name_ar__icontains=search)
                | Q(employee_id__icontains=search)
                | Q(mobile__icontains=search)
                | Q(user__email__icontains=search)
            )

        page = self.paginate_queryset(qs)
        serializer = ScopedEmployeeReadSerializer(page if page is not None else qs, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"results": serializer.data, "count": qs.count()})

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        read_serializer = EmployeeProfileReadSerializer(serializer.instance)
        return success(read_serializer.data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        ensure_company_write_allowed(self.request)
        company = get_active_company_for_request(self.request)
        if company is None:
            raise IntegrityError("Active company is required.")
        max_retries = 5
        for _ in range(max_retries):
            eid = generate_employee_id(company.employee_id_prefix or "EMP")
            try:
                with transaction.atomic():
                    instance = serializer.save(
                        employee_id=eid,
                        data_source=EmployeeProfile.DataSource.MANUAL,
                        company=company,
                    )
                    _sync_legacy_fields(instance)
                    log_manager_assignment_change(
                        employee=instance,
                        previous_manager=None,
                        new_manager=instance.manager_profile,
                        changed_by=self.request.user,
                        request=self.request,
                        source="hr_create",
                    )
                    audit(
                        self.request,
                        "employee_profile_created",
                        entity="employee_profile",
                        entity_id=instance.id,
                        metadata={"before": None, "after": _audit_snapshot(instance)},
                    )
                    return
            except IntegrityError:
                continue

        raise IntegrityError("Failed to generate unique Employee ID after multiple attempts.")

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        read_serializer = EmployeeProfileReadSerializer(serializer.instance)
        return success(read_serializer.data)

    def perform_update(self, serializer):
        ensure_company_write_allowed(self.request)
        before = _audit_snapshot(serializer.instance)
        previous_manager = serializer.instance.manager_profile
        instance = serializer.save()
        _sync_legacy_fields(instance)
        log_manager_assignment_change(
            employee=instance,
            previous_manager=previous_manager,
            new_manager=instance.manager_profile,
            changed_by=self.request.user,
            request=self.request,
            source="hr_update",
        )
        if previous_manager and instance.manager_profile_id is None:
            reroute_pending_manager_requests(instance, actor=self.request.user)
        audit(
            self.request,
            "employee_profile_updated",
            entity="employee_profile",
            entity_id=instance.id,
            metadata={"before": before, "after": _audit_snapshot(instance)},
        )

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        read_serializer = EmployeeProfileReadSerializer(serializer.instance)
        return success(read_serializer.data)

    @staticmethod
    def _expiring_docs_for_profile(profile, today, cutoff_date):
        candidates = [
            ("passport", "PASSPORT", "Passport", profile.passport_expiry),
            ("id_card", "ID_CARD", "ID Card", profile.id_expiry),
            ("health_card", "HEALTH_CARD", "Health Card", profile.health_card_expiry),
            ("contract", "CONTRACT", "Contract", profile.contract_expiry),
            ("work_license", "WORK_LICENSE", "Work License", profile.work_license_expiry),
        ]

        documents = []
        for doc_type, document_type, label, expiry_date in candidates:
            if not expiry_date:
                continue
            if today <= expiry_date <= cutoff_date:
                documents.append(
                    {
                        "doc_type": doc_type,
                        "document_type": document_type,
                        "label": label,
                        "expiry_date": expiry_date.isoformat(),
                        "days_left": (expiry_date - today).days,
                    }
                )

        documents.sort(key=lambda item: item["days_left"])
        return documents

    @action(detail=False, methods=["get"], url_path="expiries")
    def expiries(self, request):
        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        try:
            days = int(request.query_params.get("days", 30))
            page = int(request.query_params.get("page", 1))
            page_size = int(request.query_params.get("page_size", 25))
        except (TypeError, ValueError):
            return error(
                "Validation error", errors={"query": ["days, page and page_size must be integers."]}, status=422
            )

        if days < 1 or days > 365:
            return error("Validation error", errors={"days": ["Must be between 1 and 365."]}, status=422)
        if page < 1:
            return error("Validation error", errors={"page": ["Must be >= 1."]}, status=422)
        if page_size < 1 or page_size > 100:
            return error("Validation error", errors={"page_size": ["Must be between 1 and 100."]}, status=422)

        today = timezone.localdate()
        cutoff_date = today + timedelta(days=days)
        qs = self.get_queryset().filter(
            Q(passport_expiry__isnull=False, passport_expiry__range=[today, cutoff_date])
            | Q(id_expiry__isnull=False, id_expiry__range=[today, cutoff_date])
            | Q(health_card_expiry__isnull=False, health_card_expiry__range=[today, cutoff_date])
            | Q(contract_expiry__isnull=False, contract_expiry__range=[today, cutoff_date])
            | Q(work_license_expiry__isnull=False, work_license_expiry__range=[today, cutoff_date])
        )

        items = []
        for profile in qs:
            documents = self._expiring_docs_for_profile(profile, today, cutoff_date)
            if not documents:
                continue
            linked_email = profile.user.email if profile.user_id and getattr(profile.user, "email", "") else None
            items.append(
                {
                    "id": profile.id,
                    "employee_id": profile.employee_id,
                    "full_name": profile.full_name,
                    "linked_email": linked_email,
                    "mobile": profile.mobile,
                    "nearest_days_left": min(doc["days_left"] for doc in documents),
                    "documents": documents,
                }
            )

        items.sort(key=lambda item: (item["nearest_days_left"], item["full_name"] or "", item["employee_id"] or ""))

        count = len(items)
        start = (page - 1) * page_size
        end = start + page_size
        paged_items = items[start:end]
        total_pages = (count + page_size - 1) // page_size if count else 0

        return success(
            {
                "items": paged_items,
                "page": page,
                "page_size": page_size,
                "count": count,
                "total_pages": total_pages,
            }
        )

    @action(detail=True, methods=["post"], url_path="notify-expiry")
    def notify_expiry(self, request, pk=None):
        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        profile = self.get_object()

        try:
            days = int(request.data.get("days", 30))
        except (TypeError, ValueError):
            return error("Validation error", errors={"days": ["Must be an integer."]}, status=422)
        if days < 1 or days > 365:
            return error("Validation error", errors={"days": ["Must be between 1 and 365."]}, status=422)

        raw_channels = request.data.get("channels")
        if not isinstance(raw_channels, list) or not raw_channels:
            return error("Validation error", errors={"channels": ["At least one channel is required."]}, status=422)

        valid_input_channels = {"email", "sms", "whatsapp", "announcement"}
        invalid = [ch for ch in raw_channels if ch not in valid_input_channels]
        if invalid:
            return error(
                "Validation error", errors={"channels": [f"Unsupported channels: {', '.join(invalid)}"]}, status=422
            )

        channels = []
        for ch in raw_channels:
            normalized = "whatsapp" if ch == "sms" else ch
            if normalized not in channels:
                channels.append(normalized)

        today = timezone.localdate()
        cutoff_date = today + timedelta(days=days)
        documents = self._expiring_docs_for_profile(profile, today, cutoff_date)

        if not documents:
            return success(
                {
                    "delivery": {
                        ch: {"sent": False, "reason": "No expiring documents found in the selected window."}
                        for ch in channels
                    }
                },
                message="No expiring documents found in the selected window.",
            )

        try:
            dispatches = notify_document_expiry_in_app(
                profile,
                documents,
                whatsapp_enabled="whatsapp" in channels,
                email_enabled="email" in channels or "whatsapp" in channels,
            )
        except Exception:
            _log_notification_failure(
                "employee_document_expiry_bulk_notification_failed",
                entity_id=profile.id,
                notification_type="document_expiry",
                actor_id=request.user.id,
            )
            dispatches = []

        delivery = {}
        for channel in ("whatsapp", "email"):
            channel_results = [item.get(channel) for item in dispatches if item.get(channel)]
            if channel_results:
                sent_count = sum(1 for item in channel_results if item.get("status") == "sent")
                delivery[channel] = {
                    "sent": sent_count > 0,
                    "count": sent_count,
                    "total": len(channel_results),
                    "results": channel_results,
                }

        if "announcement" in channels:
            try:
                if not profile.user_id:
                    delivery["announcement"] = {"sent": False, "reason": "Employee is not linked to a user account."}
                else:
                    primary_doc = documents[0]
                    announcement = Announcement.objects.create(
                        title="Document Expiry Reminder",
                        content=(
                            f"Your {primary_doc['label']} will expire on {primary_doc['expiry_date']} "
                            f"({primary_doc['days_left']} day(s) remaining)."
                        ),
                        target_roles=[],
                        target_user=profile.user,
                        publish_to_dashboard=True,
                        publish_to_email=False,
                        publish_to_sms=False,
                        created_by=request.user,
                        company=profile.company,
                    )
                    delivery["announcement"] = {"sent": True, "announcement_id": announcement.id}
            except Exception as exc:
                _log_notification_failure(
                    "employee_document_expiry_announcement_failed",
                    entity_id=profile.id,
                    notification_type="document_expiry_announcement",
                    actor_id=request.user.id,
                    channel="announcement",
                )
                delivery["announcement"] = {"sent": False, "reason": f"Announcement delivery failed: {str(exc)}"}

        try:
            audit(
                request,
                action="employee_expiry_notification_sent",
                entity="Employee",
                entity_id=profile.id,
                metadata={"channels": channels, "documents": documents},
            )
        except Exception:
            _log_audit_failure(
                "employee_expiry_notification_audit_failed",
                entity_id=profile.id,
                actor_id=request.user.id,
            )

        return success({"delivery": delivery})

    @action(
        detail=False,
        methods=["post"],
        url_path="import/excel",
        permission_classes=[IsAuthenticated, IsHRManagerOnly],
        throttle_classes=[EmployeeImportThrottle],
    )
    def import_excel(self, request):
        ensure_company_write_allowed(request)
        upload = request.FILES.get("file")
        company = get_active_company_for_request(request)
        result = EmployeeImporter().execute(upload=upload, uploader=request.user, company=company)
        _audit_import(request, result.file_hash, result.row_count, result.result)
        if not result.ok:
            return _error_response(result.errors, result.status_code)
        return success({"inserted_rows": result.inserted_rows}, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        return error(
            "Permanent deletion is not allowed. Use the employee archive workflow.",
            status=status.HTTP_403_FORBIDDEN,
        )

    @action(
        detail=False,
        methods=["get"],
        url_path="import-template",
        permission_classes=[IsAuthenticated, IsHRManagerOnly],
    )
    def import_template(self, request):
        """
        Return the company's official Excel template for employee import.
        Serves from static files directory for easy deployment.
        """
        import os

        from django.conf import settings

        # Path to the template file in static directory
        template_path = os.path.join(settings.BASE_DIR, "static", "templates", "employee_import_template.xlsx")

        if not os.path.exists(template_path):
            return error(
                "Template file not found. Please contact system administrator.", status=status.HTTP_404_NOT_FOUND
            )

        try:
            response = FileResponse(
                open(template_path, "rb"),
                as_attachment=True,
                filename="employee_import_template.xlsx",
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            return response
        except Exception as e:
            return error(f"Failed to download template: {str(e)}", status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class EmployeeDeletionRequestViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get_queryset(self):
        base_qs = EmployeeDeletionRequest.objects.select_related(
            "company",
            "employee_profile",
            "employee_profile__company",
            "target_user",
            "requested_by",
            "approved_by",
            "rejected_by",
        )
        if self.action == "list":
            return filter_queryset_by_company_scope(base_qs, self.request)
        return filter_queryset_by_accessible_companies(base_qs, self.request)

    def get_serializer_class(self):
        if self.action == "create":
            return EmployeeDeletionRequestCreateSerializer
        return EmployeeDeletionRequestReadSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"]._active_company = get_active_company_for_request(self.request)
        return context

    def list(self, request, *args, **kwargs):
        role = get_role(request.user)
        if role not in ["HRManager", "SystemAdmin", "CEO"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        queryset = self.get_queryset()
        status_value = request.query_params.get("status")
        if status_value:
            queryset = queryset.filter(status=status_value)

        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"results": serializer.data, "count": queryset.count()})

    def retrieve(self, request, *args, **kwargs):
        role = get_role(request.user)
        if role not in ["HRManager", "SystemAdmin", "CEO"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(self.get_object())
        return success(serializer.data)

    def create(self, request, *args, **kwargs):
        role = get_role(request.user)
        if role not in ["HRManager", "SystemAdmin"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        ensure_company_write_allowed(request)
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        employee_profile = serializer.validated_data["employee_profile"]
        instance = EmployeeDeletionRequest.objects.create(
            company=employee_profile.company,
            employee_profile=employee_profile,
            target_user=employee_profile.user,
            requested_by=request.user,
            reason=serializer.validated_data["reason"],
            archive_reason=serializer.validated_data["archive_reason"],
            request_snapshot=_deletion_request_snapshot(employee_profile),
        )
        audit(
            request,
            "employee_archive_requested",
            entity="employee_deletion_request",
            entity_id=instance.id,
            metadata={
                "request_id": instance.id,
                "employee": instance.request_snapshot,
                "reason": instance.reason,
                "archive_reason": instance.archive_reason,
            },
        )
        try:
            notify_users_for_pending_status(
                users=get_ceo_approver_users(),
                request_type="Employee Archive",
                request_id=instance.id,
                requester_name=request.user.full_name or request.user.email,
                status_label="Pending CEO",
                details=[
                    f"Employee: {instance.request_snapshot.get('full_name') or instance.request_snapshot.get('employee_id')}",
                    f"Reason: {instance.reason}",
                ],
                action_path=f"/ceo/employees/deletion-requests/{instance.id}",
            )
        except Exception:
            _log_notification_failure(
                "employee_archive_submission_notification_failed",
                entity_id=instance.id,
                notification_type="employee_archive_submitted",
                actor_id=request.user.id,
            )

        data = EmployeeDeletionRequestReadSerializer(instance, context=self.get_serializer_context()).data
        return success(data, status=status.HTTP_201_CREATED)

    @staticmethod
    def _build_execution_snapshot(instance: EmployeeDeletionRequest) -> dict:
        from assets.models import AssetAssignment

        profile = instance.employee_profile
        target_user = instance.target_user
        snapshot = dict(instance.request_snapshot or {})
        if profile:
            snapshot.update(
                {
                    "open_leave_requests": LeaveRequest.objects.filter(employee_profile=profile).count(),
                    "asset_assignments": AssetAssignment.objects.filter(employee=profile, is_active=True).count(),
                    "loan_requests": LoanRequest.objects.filter(employee_profile=profile).count(),
                }
            )
        snapshot["target_user_email"] = target_user.email if target_user else snapshot.get("email", "")
        snapshot["target_user_was_active"] = bool(target_user and target_user.is_active)
        return snapshot

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        if get_role(request.user) not in ["CEO", "SystemAdmin"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            instance = (
                EmployeeDeletionRequest.objects.select_for_update(of=("self",))
                .select_related("employee_profile", "employee_profile__user", "target_user")
                .get(pk=self.get_object().pk)
            )
            if instance.status != EmployeeDeletionRequest.Status.PENDING_CEO:
                return error("Validation error", errors=["Request is not pending CEO approval."], status=422)

            profile = instance.employee_profile
            target_user = instance.target_user or (profile.user if profile and profile.user_id else None)
            if profile is None:
                return error("Validation error", errors=["Employee profile is no longer available."], status=422)
            if profile.is_archived:
                return error("Validation error", errors=["Employee is already archived."], status=422)

            execution_snapshot = self._build_execution_snapshot(instance)
            now = timezone.now()
            profile.is_archived = True
            profile.archived_at = now
            profile.archived_by = request.user
            profile.archive_reason = instance.archive_reason
            profile.save(update_fields=["is_archived", "archived_at", "archived_by", "archive_reason", "updated_at"])
            execution_snapshot.update(
                {
                    "is_archived": True,
                    "archived_at": now.isoformat(),
                    "archived_by_id": request.user.id,
                    "archive_reason": instance.archive_reason,
                    "target_user_disabled": bool(target_user),
                }
            )

            if target_user is not None and target_user.is_active:
                target_user.is_active = False
                target_user.auth_token_version += 1
                target_user.save(update_fields=["is_active", "auth_token_version"])

            instance.status = EmployeeDeletionRequest.Status.EXECUTED
            instance.approved_by = request.user
            instance.approved_at = now
            instance.executed_at = now
            instance.execution_snapshot = execution_snapshot
            instance.save(
                update_fields=[
                    "status",
                    "approved_by",
                    "approved_at",
                    "executed_at",
                    "execution_snapshot",
                    "updated_at",
                ]
            )

        instance.refresh_from_db()
        reroute_pending_manager_requests(
            EmployeeProfile.objects.select_related("user", "manager_profile", "manager_profile__user").filter(
                manager_profile=profile
            ),
            actor=request.user,
        )
        audit(
            request,
            "employee_archived",
            entity="EmployeeProfile",
            entity_id=profile.id,
            metadata={
                "request_id": instance.id,
                "employee": execution_snapshot,
                "approved_by": request.user.id,
            },
        )
        try:
            notify_profile_request_status_whatsapp(
                profile=getattr(instance.requested_by, "employee_profile", None),
                request_type="Employee Archive",
                request_id=instance.id,
                status_label="Archived",
                details=[
                    f"Employee: {execution_snapshot.get('full_name') or execution_snapshot.get('employee_id')}",
                ],
                action_path="/hr/employees",
            )
        except Exception:
            _log_notification_failure(
                "employee_archive_approval_notification_failed",
                entity_id=instance.id,
                notification_type="employee_archive_approved",
                actor_id=request.user.id,
            )
        data = EmployeeDeletionRequestReadSerializer(instance, context=self.get_serializer_context()).data
        return success(data)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        if get_role(request.user) not in ["CEO", "SystemAdmin"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        instance = self.get_object()
        if instance.status != EmployeeDeletionRequest.Status.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)

        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return error("Validation error", errors={"reason": ["Reason is required."]}, status=422)

        instance.status = EmployeeDeletionRequest.Status.REJECTED
        instance.rejected_by = request.user
        instance.rejected_at = timezone.now()
        instance.rejection_reason = reason
        instance.save(update_fields=["status", "rejected_by", "rejected_at", "rejection_reason", "updated_at"])

        audit(
            request,
            "employee_archive_rejected",
            entity="employee_deletion_request",
            entity_id=instance.id,
            metadata={"request_id": instance.id, "reason": reason, "employee": instance.request_snapshot},
        )
        try:
            notify_profile_request_status_whatsapp(
                profile=getattr(instance.requested_by, "employee_profile", None),
                request_type="Employee Archive",
                request_id=instance.id,
                status_label="Rejected",
                reason=reason,
                details=[
                    f"Employee: {instance.request_snapshot.get('full_name') or instance.request_snapshot.get('employee_id')}",
                ],
                action_path="/hr/employees",
            )
        except Exception:
            _log_notification_failure(
                "employee_archive_rejection_notification_failed",
                entity_id=instance.id,
                notification_type="employee_archive_rejected",
                actor_id=request.user.id,
            )
        data = EmployeeDeletionRequestReadSerializer(instance, context=self.get_serializer_context()).data
        return success(data)

    def update(self, request, *args, **kwargs):
        return error(
            "Employee archive requests cannot be edited directly. Use the approve/reject actions.",
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        return error("Employee archive requests cannot be deleted.", status=status.HTTP_403_FORBIDDEN)


class EmployeeImportHistoryViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated, IsHRManagerOnly]
    pagination_class = StandardPagination
    serializer_class = EmployeeImportSerializer

    def get_queryset(self):
        queryset = EmployeeImport.objects.select_related("uploader", "company").order_by("-created_at")
        return filter_queryset_by_company_scope(queryset, self.request)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)

        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return success({"results": serializer.data, "count": queryset.count()})

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        data = self.get_serializer(instance).data
        if data.get("error_summary") is None:
            data["error_summary"] = []
        return success(data)

    @action(detail=True, methods=["get"], url_path="errors-file")
    def errors_file(self, request, pk=None):
        record = self.get_object()
        if record.status != EmployeeImport.Status.FAILED or not record.errors_file:
            return error("Errors file not found.", status=status.HTTP_404_NOT_FOUND)

        record.errors_file.open("rb")
        filename = f"employee-import-errors-{record.id}.csv"
        response = FileResponse(record.errors_file, content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response
