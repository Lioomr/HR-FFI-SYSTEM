import csv
import hashlib
import io
import random
import string
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from announcements.models import Announcement
from audit.utils import audit
from core.pagination import EmployeePagination, StandardPagination
from core.permissions import get_role
from core.responses import error, success
from core.services import send_document_expiry_reminder_email

from .models import EmployeeImport, EmployeeProfile
from .notifications import send_document_expiry_whatsapp
from .permissions import IsEmployeeOwner, IsHRManagerOnly, IsHRManagerOrAdmin
from .serializers import EmployeeImportSerializer, EmployeeProfileReadSerializer, EmployeeProfileWriteSerializer
from .services import EmployeeImporter
from .storage import PrivateUploadStorage
from .throttles import EmployeeImportThrottle

try:
    from openpyxl import load_workbook
except Exception:  # pragma: no cover - fallback for missing dependency
    load_workbook = None


def generate_employee_id():
    suffix = "".join(random.choices(string.digits, k=6))
    return f"EMP-{suffix}"


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
        "manager_profile_id": instance.manager_profile.id if instance.manager_profile else None,
        "data_source": instance.data_source,
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

    def get_permissions(self):
        if self.action == "import_excel":
            permission_classes = [IsAuthenticated, IsHRManagerOnly]
        elif self.action == "manager_team":
            permission_classes = [IsAuthenticated]
        elif self.action in ["retrieve", "me"]:
            permission_classes = [IsAuthenticated, IsHRManagerOrAdmin | IsEmployeeOwner]
        else:
            permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)

        base_qs = EmployeeProfile.objects.select_related(
            "user",
            "manager",
            "manager_profile",
            "manager_profile__user",
            "department_ref",
            "position_ref",
            "task_group_ref",
            "sponsor_ref",
        )

        if role in ["SystemAdmin", "HRManager"]:
            return base_qs.all()

        return base_qs.filter(user=user)

    def get_serializer_class(self):
        if self.action in ["list", "retrieve", "me"]:
            return EmployeeProfileReadSerializer
        return EmployeeProfileWriteSerializer

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
            qs = qs.filter(employment_status=status_value)

        return qs

    def list(self, request, *args, **kwargs):
        qs = self._apply_filters(self.get_queryset())
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page if page is not None else qs, many=True)

        if page is not None:
            return self.get_paginated_response(serializer.data)

        return success({"results": serializer.data, "count": qs.count()})

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request):
        try:
            profile = EmployeeProfile.objects.get(user=request.user)
        except EmployeeProfile.DoesNotExist:
            return error("Profile not found.", status=status.HTTP_404_NOT_FOUND)

        serializer = self.get_serializer(profile)
        return success(serializer.data)

    @action(
        detail=False,
        methods=["get"],
        url_path="manager/team",
        permission_classes=[IsAuthenticated],
    )
    def manager_team(self, request):
        role = get_role(request.user)
        if role not in ["Manager", "CEO", "SystemAdmin", "HRManager"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        base_qs = EmployeeProfile.objects.select_related(
            "user",
            "manager",
            "manager_profile",
            "manager_profile__user",
            "department_ref",
            "position_ref",
            "task_group_ref",
            "sponsor_ref",
        )
        if role == "CEO":
            ceo_profile = getattr(request.user, "employee_profile", None)
            direct_reports_q = Q(manager=request.user)
            if ceo_profile:
                direct_reports_q = direct_reports_q | Q(manager_profile=ceo_profile)

            qs = base_qs.filter(Q(user__groups__name__in=["Manager", "HRManager"]) | direct_reports_q).distinct()
        else:
            manager_profile = getattr(request.user, "employee_profile", None)
            qs = base_qs.filter(
                Q(manager=request.user) | Q(manager_profile=manager_profile)
                if manager_profile
                else Q(manager=request.user)
            )

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
        serializer = EmployeeProfileReadSerializer(page if page is not None else qs, many=True)
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
        max_retries = 5
        for _ in range(max_retries):
            eid = generate_employee_id()
            try:
                with transaction.atomic():
                    instance = serializer.save(employee_id=eid, data_source=EmployeeProfile.DataSource.MANUAL)
                    if instance.manager_profile and instance.manager != instance.manager_profile.user:
                        instance.manager = instance.manager_profile.user
                        instance.save(update_fields=["manager", "updated_at"])
                    _sync_legacy_fields(instance)
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
        before = _audit_snapshot(serializer.instance)
        instance = serializer.save()
        if instance.manager_profile and instance.manager != instance.manager_profile.user:
            instance.manager = instance.manager_profile.user
            instance.save(update_fields=["manager", "updated_at"])
        _sync_legacy_fields(instance)
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
            ("passport", "Passport", profile.passport_expiry),
            ("id_card", "ID Card", profile.id_expiry),
            ("health_card", "Health Card", profile.health_card_expiry),
            ("contract", "Contract", profile.contract_expiry),
        ]

        documents = []
        for doc_type, label, expiry_date in candidates:
            if not expiry_date:
                continue
            if today <= expiry_date <= cutoff_date:
                documents.append(
                    {
                        "doc_type": doc_type,
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

        delivery = {}

        if "email" in channels:
            try:
                linked_email = profile.user.email if profile.user_id and getattr(profile.user, "email", "") else None
                if not linked_email:
                    delivery["email"] = {"sent": False, "reason": "No linked email on employee profile."}
                else:
                    email_results = []
                    for doc in documents:
                        result = send_document_expiry_reminder_email(
                            to_email=linked_email,
                            employee_name=profile.full_name or profile.employee_id,
                            document_type=doc["label"],
                            expiry_date=doc["expiry_date"],
                            days_remaining=doc["days_left"],
                        )
                        email_results.append(result)
                    sent_count = sum(1 for result in email_results if result.get("success"))
                    delivery["email"] = {
                        "sent": sent_count > 0,
                        "count": sent_count,
                        "total": len(email_results),
                    }
                    if sent_count < len(email_results):
                        delivery["email"]["reason"] = "One or more emails failed to send."
            except Exception as exc:
                delivery["email"] = {"sent": False, "reason": f"Email delivery failed: {str(exc)}"}

        if "whatsapp" in channels:
            try:
                whatsapp_result = send_document_expiry_whatsapp(profile, documents)
                delivery["whatsapp"] = whatsapp_result
            except Exception as exc:
                delivery["whatsapp"] = {"sent": False, "provider": "bird_whatsapp", "reason": str(exc)}

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
                    )
                    delivery["announcement"] = {"sent": True, "announcement_id": announcement.id}
            except Exception as exc:
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
            pass

        return success({"delivery": delivery})

    @action(
        detail=False,
        methods=["post"],
        url_path="import/excel",
        permission_classes=[IsAuthenticated, IsHRManagerOnly],
        throttle_classes=[EmployeeImportThrottle],
    )
    def import_excel(self, request):
        upload = request.FILES.get("file")
        result = EmployeeImporter().execute(upload=upload, uploader=request.user)
        _audit_import(request, result.file_hash, result.row_count, result.result)
        if not result.ok:
            return _error_response(result.errors, result.status_code)
        return success({"inserted_rows": result.inserted_rows}, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        return error(
            "Hard delete is not allowed. Please update status to TERMINATED.",
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


class EmployeeImportHistoryViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated, IsHRManagerOnly]
    pagination_class = StandardPagination
    serializer_class = EmployeeImportSerializer

    def get_queryset(self):
        return EmployeeImport.objects.select_related("uploader").order_by("-created_at").all()

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
