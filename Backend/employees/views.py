import csv
import hashlib
import io
import random
import string
import uuid
import zipfile
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import FileResponse
from django.core.files.base import ContentFile

from rest_framework import viewsets, status, mixins
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action

from core.permissions import get_role
from core.responses import success, error
from core.pagination import EmployeePagination, StandardPagination
from audit.utils import audit

from hr_reference.models import Department, Position, TaskGroup, Sponsor
from .models import EmployeeProfile, EmployeeImport
from .serializers import EmployeeProfileReadSerializer, EmployeeProfileWriteSerializer, EmployeeImportSerializer
from .permissions import IsHRManagerOrAdmin, IsEmployeeOwner, IsHRManagerOnly
from .throttles import EmployeeImportThrottle
from .storage import PrivateUploadStorage

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
        "user_id": instance.user.id if instance.user else None,
        "email": instance.user.email if instance.user else "",
        "department_id": instance.department_ref.id if instance.department_ref else None,
        "position_id": instance.position_ref.id if instance.position_ref else None,
        "task_group_id": instance.task_group_ref.id if instance.task_group_ref else None,
        "sponsor_id": instance.sponsor_ref.id if instance.sponsor_ref else None,
        "employment_status": instance.employment_status,
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
                    instance = serializer.save(employee_id=eid)
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

    @action(
        detail=False,
        methods=["post"],
        url_path="import/excel",
        permission_classes=[IsAuthenticated, IsHRManagerOnly],
        throttle_classes=[EmployeeImportThrottle],
    )
    def import_excel(self, request):
        upload = request.FILES.get("file")
        file_hash = ""

        if upload is None:
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["File is required."], status.HTTP_400_BAD_REQUEST)

        if upload.size > MAX_IMPORT_FILE_SIZE:
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["File exceeds 5MB limit."], status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        if not upload.name.lower().endswith(".xlsx"):
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["Unsupported file type."], status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)

        content_type = upload.content_type or ""
        if content_type not in ALLOWED_IMPORT_MIME_TYPES:
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["Unsupported file type."], status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)

        if not _has_xlsx_signature(upload):
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["Unsupported file type."], status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)

        try:
            with zipfile.ZipFile(upload) as zf:
                if "xl/workbook.xml" not in zf.namelist():
                    _audit_import(request, file_hash, 0, "failed")
                    return _error_response(["Unsupported file type."], status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)
            upload.seek(0)
        except zipfile.BadZipFile:
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["Unsupported file type."], status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)

        if load_workbook is None:
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["Excel parser unavailable."], status.HTTP_500_INTERNAL_SERVER_ERROR)

        upload.seek(0)
        file_hash = _compute_file_hash(upload)
        _audit_import(request, file_hash, 0, "attempt")

        try:
            workbook = load_workbook(upload, read_only=True, data_only=True)
        except Exception:
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["Unsupported file type."], status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)

        upload.seek(0)
        worksheet = workbook.active
        header_row = list(next(worksheet.iter_rows(min_row=1, max_row=1, values_only=True), []))
        
        # Strip trailing None/empty headers (common in Excel files with extra columns)
        while header_row and (_normalize_cell(header_row[-1]) == "" or header_row[-1] is None):
            header_row.pop()
        
        normalized_headers = [_normalize_cell(value).lower() for value in header_row]
        expected_headers = [_normalize_cell(value).lower() for value in EXPECTED_IMPORT_HEADERS]

        if normalized_headers != expected_headers:
            workbook.close()
            upload.seek(0)
            stored_name = PRIVATE_STORAGE.save(
                f"employee_imports/{uuid.uuid4().hex}.xlsx",
                upload,
            )
            import_record = EmployeeImport.objects.create(
                uploader=request.user,
                original_filename=upload.name,
                stored_file=stored_name,
                status=EmployeeImport.Status.FAILED,
                row_count=0,
                file_hash=file_hash,
            )
            errors_detail = [{"row": 1, "column": "Header", "message": "Header mismatch."}]
            errors_content = _write_errors_csv(errors_detail)
            import_record.errors_file.save(
                f"employee_imports/errors/{uuid.uuid4().hex}.csv",
                ContentFile(errors_content),
            )
            import_record.error_summary = ["row 1: Header mismatch."]
            import_record.save(update_fields=["error_summary", "updated_at"])
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["row 1: Header mismatch."], status.HTTP_422_UNPROCESSABLE_ENTITY)

        rows = []
        for row_index, row_values in enumerate(
            worksheet.iter_rows(min_row=2, values_only=True),
            start=2,
        ):
            row_list = list(row_values or [])
            if len(row_list) < len(EXPECTED_IMPORT_HEADERS):
                row_list += [None] * (len(EXPECTED_IMPORT_HEADERS) - len(row_list))
            normalized = [_normalize_cell(value) for value in row_list[: len(EXPECTED_IMPORT_HEADERS)]]
            if all(not value for value in normalized):
                continue
            rows.append({"row_index": row_index, "values": normalized})

        workbook.close()

        row_count = len(rows)
        if row_count == 0:
            upload.seek(0)
            stored_name = PRIVATE_STORAGE.save(
                f"employee_imports/{uuid.uuid4().hex}.xlsx",
                upload,
            )
            import_record = EmployeeImport.objects.create(
                uploader=request.user,
                original_filename=upload.name,
                stored_file=stored_name,
                status=EmployeeImport.Status.FAILED,
                row_count=0,
                file_hash=file_hash,
            )
            errors_detail = [{"row": 0, "column": "Sheet", "message": "No data rows found."}]
            errors_content = _write_errors_csv(errors_detail)
            import_record.errors_file.save(
                f"employee_imports/errors/{uuid.uuid4().hex}.csv",
                ContentFile(errors_content),
            )
            import_record.error_summary = ["row 0: No data rows found."]
            import_record.save(update_fields=["error_summary", "updated_at"])
            _audit_import(request, file_hash, 0, "failed")
            return _error_response(["row 0: No data rows found."], status.HTTP_422_UNPROCESSABLE_ENTITY)

        if row_count > MAX_IMPORT_ROWS:
            upload.seek(0)
            stored_name = PRIVATE_STORAGE.save(
                f"employee_imports/{uuid.uuid4().hex}.xlsx",
                upload,
            )
            import_record = EmployeeImport.objects.create(
                uploader=request.user,
                original_filename=upload.name,
                stored_file=stored_name,
                status=EmployeeImport.Status.FAILED,
                row_count=row_count,
                file_hash=file_hash,
            )
            errors_detail = [
                {
                    "row": 0,
                    "column": "Sheet",
                    "message": f"Row limit exceeded (max {MAX_IMPORT_ROWS}).",
                }
            ]
            errors_content = _write_errors_csv(errors_detail)
            import_record.errors_file.save(
                f"employee_imports/errors/{uuid.uuid4().hex}.csv",
                ContentFile(errors_content),
            )
            import_record.error_summary = [f"row 0: Row limit exceeded (max {MAX_IMPORT_ROWS})."]
            import_record.save(update_fields=["error_summary", "updated_at"])
            _audit_import(request, file_hash, row_count, "failed")
            return _error_response(
                [f"row 0: Row limit exceeded (max {MAX_IMPORT_ROWS})."],
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        department_lookup = _build_reference_lookup(Department.objects.all())
        position_lookup = _build_reference_lookup(Position.objects.all())
        task_group_lookup = _build_reference_lookup(TaskGroup.objects.all())
        sponsor_lookup = _build_reference_lookup(Sponsor.objects.all())

        errors = []
        errors_detail = []
        valid_rows = []

        for row in rows:
            row_index = row["row_index"]
            values = row["values"]
            row_has_error = False

            full_name = values[0]
            employee_number = values[1]
            nationality = values[2]
            position_name = values[3]
            passport_number = values[4]
            passport_expiry_raw = values[5]
            national_id = values[6]
            id_expiry_raw = values[7]
            date_of_birth_raw = values[8]
            job_offer = values[9]
            joining_date_raw = values[10]
            contract_date_raw = values[11]
            contract_expiry_raw = values[12]
            task_group_name = values[13]
            health_card = values[14]
            health_card_expiry_raw = values[15]
            mobile_number = values[16]
            sponsor_code = values[17]
            basic_salary_raw = values[18]
            transportation_raw = values[19]
            accommodation_raw = values[20]
            telephone_raw = values[21]
            petrol_raw = values[22]
            other_raw = values[23]
            allowed_overtime_raw = values[26]
            department_name = values[27]

            passport_expiry, err = _parse_date_ddmmyyyy(passport_expiry_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Passport Expiry", "message": err})
                row_has_error = True

            id_expiry, err = _parse_date_ddmmyyyy(id_expiry_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "ID Expiry", "message": err})
                row_has_error = True

            date_of_birth, err = _parse_date_ddmmyyyy(date_of_birth_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Date Of Birth", "message": err})
                row_has_error = True

            joining_date, err = _parse_date_ddmmyyyy(joining_date_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Joining Date", "message": err})
                row_has_error = True

            contract_date, err = _parse_date_ddmmyyyy(contract_date_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Contract date", "message": err})
                row_has_error = True

            contract_expiry, err = _parse_date_ddmmyyyy(contract_expiry_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Contract Expiry Date", "message": err})
                row_has_error = True

            health_card_expiry, err = _parse_date_ddmmyyyy(health_card_expiry_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Health Card Expiry", "message": err})
                row_has_error = True

            basic_salary, err = _parse_decimal(basic_salary_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Basic Salary", "message": err})
                row_has_error = True

            transportation_allowance, err = _parse_decimal(transportation_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Transportation Allowance", "message": err})
                row_has_error = True

            accommodation_allowance, err = _parse_decimal(accommodation_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Accommodation Allowance", "message": err})
                row_has_error = True

            telephone_allowance, err = _parse_decimal(telephone_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Telephone Allowance", "message": err})
                row_has_error = True

            petrol_allowance, err = _parse_decimal(petrol_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Petrol Allowance", "message": err})
                row_has_error = True

            other_allowance, err = _parse_decimal(other_raw)
            if err:
                errors.append(f"row {row_index}: {err}")
                errors_detail.append({"row": row_index, "column": "Other Allowance", "message": err})
                row_has_error = True

            allowed_overtime = None
            if _normalize_cell(allowed_overtime_raw):
                try:
                    allowed_overtime = int(_normalize_cell(allowed_overtime_raw))
                except ValueError:
                    errors.append(f"row {row_index}: Invalid numeric value: {allowed_overtime_raw}")
                    errors_detail.append(
                        {"row": row_index, "column": "Allowed Overtime", "message": "Invalid numeric value."}
                    )
                    row_has_error = True

            # Auto-create department if not found
            department_ref = None
            if department_name:
                department_ref = department_lookup.get(department_name.lower())
                if not department_ref:
                    # Create new department
                    try:
                        department_ref = Department.objects.create(
                            name=department_name,
                            code=department_name[:10].upper().replace(" ", "_"),
                            description=f"Auto-created from import"
                        )
                        # Add to lookup for subsequent rows
                        department_lookup[department_name.lower()] = department_ref
                        department_lookup[department_ref.code.lower()] = department_ref
                    except Exception:
                        # If creation fails (e.g., duplicate code), try to find it again
                        department_ref = Department.objects.filter(name=department_name).first()

            # Auto-create position if not found
            position_ref = None
            if position_name:
                position_ref = position_lookup.get(position_name.lower())
                if not position_ref:
                    # Create new position
                    try:
                        position_ref = Position.objects.create(
                            name=position_name,
                            code=position_name[:10].upper().replace(" ", "_"),
                            description=f"Auto-created from import"
                        )
                        # Add to lookup for subsequent rows
                        position_lookup[position_name.lower()] = position_ref
                        position_lookup[position_ref.code.lower()] = position_ref
                    except Exception:
                        # If creation fails (e.g., duplicate code), try to find it again
                        position_ref = Position.objects.filter(name=position_name).first()

            task_group_ref = None
            if task_group_name:
                task_group_ref = task_group_lookup.get(task_group_name.lower())

            sponsor_ref = None
            if sponsor_code:
                sponsor_ref = sponsor_lookup.get(sponsor_code.lower())

            if not row_has_error:
                valid_rows.append(
                    {
                        "full_name": full_name,
                        "employee_number": employee_number,
                        "nationality": nationality,
                        "passport_no": passport_number,
                        "passport_expiry": passport_expiry,
                        "national_id": national_id,
                        "id_expiry": id_expiry,
                        "date_of_birth": date_of_birth,
                        "job_offer": job_offer,
                        "hire_date": joining_date,
                        "contract_date": contract_date,
                        "contract_expiry": contract_expiry,
                        "task_group_ref": task_group_ref,
                        "health_card": health_card,
                        "health_card_expiry": health_card_expiry,
                        "mobile": mobile_number,
                        "sponsor_ref": sponsor_ref,
                        "basic_salary": basic_salary,
                        "transportation_allowance": transportation_allowance,
                        "accommodation_allowance": accommodation_allowance,
                        "telephone_allowance": telephone_allowance,
                        "petrol_allowance": petrol_allowance,
                        "other_allowance": other_allowance,
                        "allowed_overtime": allowed_overtime,
                        "department_ref": department_ref,
                        "position_ref": position_ref,
                        "department": department_name,
                        "job_title": position_name,
                    }
                )

        upload.seek(0)
        stored_name = PRIVATE_STORAGE.save(
            f"employee_imports/{uuid.uuid4().hex}.xlsx",
            upload,
        )
        import_record = EmployeeImport.objects.create(
            uploader=request.user,
            original_filename=upload.name,
            stored_file=stored_name,
            status=EmployeeImport.Status.FAILED,
            row_count=row_count,
            file_hash=file_hash,
        )

        if errors:
            errors_content = _write_errors_csv(errors_detail)
            import_record.errors_file.save(
                f"employee_imports/errors/{uuid.uuid4().hex}.csv",
                ContentFile(errors_content),
            )
            import_record.error_summary = errors[:10]
            import_record.save(update_fields=["error_summary", "updated_at"])
            _audit_import(request, file_hash, row_count, "failed")
            return _error_response(errors, status.HTTP_422_UNPROCESSABLE_ENTITY)

        existing_ids = set(EmployeeProfile.objects.values_list("employee_id", flat=True))

        try:
            with transaction.atomic():
                for row_data in valid_rows:
                    employee_id = _generate_unique_employee_id(existing_ids)
                    if not employee_id:
                        raise IntegrityError("Failed to generate unique employee ID.")

                    profile = EmployeeProfile.objects.create(
                        user=None,
                        employee_id=employee_id,
                        full_name=row_data["full_name"],
                        employee_number=row_data["employee_number"],
                        nationality=row_data["nationality"],
                        passport_no=row_data["passport_no"],
                        passport_expiry=row_data["passport_expiry"],
                        national_id=row_data["national_id"],
                        id_expiry=row_data["id_expiry"],
                        date_of_birth=row_data["date_of_birth"],
                        job_offer=row_data["job_offer"],
                        hire_date=row_data["hire_date"],
                        contract_date=row_data["contract_date"],
                        contract_expiry=row_data["contract_expiry"],
                        task_group_ref=row_data["task_group_ref"],
                        health_card=row_data["health_card"],
                        health_card_expiry=row_data["health_card_expiry"],
                        mobile=row_data["mobile"],
                        sponsor_ref=row_data["sponsor_ref"],
                        basic_salary=row_data["basic_salary"],
                        transportation_allowance=row_data["transportation_allowance"],
                        accommodation_allowance=row_data["accommodation_allowance"],
                        telephone_allowance=row_data["telephone_allowance"],
                        petrol_allowance=row_data["petrol_allowance"],
                        other_allowance=row_data["other_allowance"],
                        allowed_overtime=row_data["allowed_overtime"],
                        department_ref=row_data["department_ref"],
                        position_ref=row_data["position_ref"],
                        department=row_data["department"] or "",
                        job_title=row_data["job_title"] or "",
                    )
                    _sync_legacy_fields(profile)
        except IntegrityError:
            errors = ["Import failed due to a database constraint."]
            errors_detail = [{"row": 0, "column": "Database", "message": "Constraint violation."}]
            errors_content = _write_errors_csv(errors_detail)
            import_record.errors_file.save(
                f"employee_imports/errors/{uuid.uuid4().hex}.csv",
                ContentFile(errors_content),
            )
            import_record.error_summary = errors[:10]
            import_record.save(update_fields=["error_summary", "updated_at"])
            _audit_import(request, file_hash, row_count, "failed")
            return _error_response(errors, status.HTTP_422_UNPROCESSABLE_ENTITY)

        import_record.status = EmployeeImport.Status.SUCCESS
        import_record.inserted_rows = row_count
        import_record.error_summary = []
        import_record.save(update_fields=["status", "inserted_rows", "error_summary", "updated_at"])

        _audit_import(request, file_hash, row_count, "success")
        return success({"inserted_rows": row_count})

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
                "Template file not found. Please contact system administrator.",
                status=status.HTTP_404_NOT_FOUND
            )
        
        try:
            response = FileResponse(
                open(template_path, 'rb'),
                as_attachment=True,
                filename="employee_import_template.xlsx",
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            return response
        except Exception as e:
            return error(
                f"Failed to download template: {str(e)}",
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


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
