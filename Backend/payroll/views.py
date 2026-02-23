import csv
import io
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.http import HttpResponse
from django.utils import timezone

from rest_framework import mixins, viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import audit
from core.pagination import StandardPagination
from core.responses import success, error
from employees.permissions import IsHRManagerOnly

from .models import PayrollRun, PayrollRunItem, Payslip
from .serializers import (
    PayrollRunSerializer,
    PayrollRunCreateSerializer,
    PayrollRunItemSerializer,
    PayslipListSerializer,
    PayslipDetailSerializer,
)
from .permissions import IsEmployeeOnly
from .throttles import (
    PayrollFinalizeThrottle,
    PayrollGeneratePayslipsThrottle,
    PayrollExportThrottle,
)
import openpyxl


def _error_list(message, errors_list, status_code):
    return error(message, errors=errors_list, status=status_code)


def _flatten_errors(error_dict):
    errors = []
    for field, messages in error_dict.items():
        if isinstance(messages, (list, tuple)):
            for msg in messages:
                errors.append(f"{field}: {msg}")
        else:
            errors.append(f"{field}: {messages}")
    return errors


def _is_duplicate_period_error(error_dict) -> bool:
    for field, messages in error_dict.items():
        joined = " ".join(str(msg).lower() for msg in (messages if isinstance(messages, (list, tuple)) else [messages]))
        if field in {"non_field_errors", "__all__"} and ("already exists" in joined or "unique" in joined):
            return True
        if "unique_payroll_run_period" in joined:
            return True
    return False


def _escape_pdf_text(value):
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_pdf_bytes(lines):
    safe_lines = [_escape_pdf_text(line) for line in lines]
    content_parts = ["BT", "/F1 12 Tf", "72 750 Td"]
    for line in safe_lines:
        content_parts.append(f"({line}) Tj")
        content_parts.append("0 -14 Td")
    content_parts.append("ET")
    content_stream = "\n".join(content_parts)
    content_bytes = content_stream.encode("ascii", errors="ignore")

    objects = []
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    objects.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    objects.append(
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
    )
    objects.append(
        b"4 0 obj\n<< /Length "
        + str(len(content_bytes)).encode("ascii")
        + b" >>\nstream\n"
        + content_bytes
        + b"\nendstream\nendobj\n"
    )
    objects.append(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")

    xref_positions = []
    pdf = io.BytesIO()
    pdf.write(b"%PDF-1.4\n")
    for obj in objects:
        xref_positions.append(pdf.tell())
        pdf.write(obj)
    xref_start = pdf.tell()
    pdf.write(b"xref\n0 %d\n" % (len(objects) + 1))
    pdf.write(b"0000000000 65535 f \n")
    for pos in xref_positions:
        pdf.write(f"{pos:010d} 00000 n \n".encode("ascii"))
    pdf.write(
        b"trailer\n<< /Size "
        + str(len(objects) + 1).encode("ascii")
        + b" /Root 1 0 R >>\nstartxref\n"
        + str(xref_start).encode("ascii")
        + b"\n%%EOF"
    )
    return pdf.getvalue()


def _build_payroll_summary_lines(run, items):
    lines = [
        "FFI HR SYSTEM - PAYROLL REPORT",
        f"Period: {run.month:02d}/{run.year}",
        f"Run Status: {run.status}",
        f"Employees: {run.total_employees}",
        f"Total Net: {run.total_net:.2f}",
        "",
        "Employee ID | Employee Name                | Department       | Net Salary",
        "--------------------------------------------------------------------------",
    ]
    for item in items:
        employee_id = (item.employee_id or "")[:11]
        employee_name = (item.employee_name or "")[:28]
        department = (item.department or "")[:16]
        net_salary = f"{item.net_salary:.2f}"
        lines.append(f"{employee_id:<11} | {employee_name:<28} | {department:<16} | {net_salary:>10}")
    lines.append("")
    lines.append(f"Generated at: {timezone.now().strftime('%Y-%m-%d %H:%M:%S')}")
    return lines


def _export_payroll_run_response(request, run):
    export_format = (request.query_params.get("format") or "pdf").lower()
    items = list(PayrollRunItem.objects.filter(payroll_run=run).order_by("employee_name", "id"))

    if export_format == "csv":
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="payroll_run_{run.id}.csv"'
        writer = csv.writer(response)
        writer.writerow(["employee_id", "employee_name", "department", "position", "basic_salary", "allowances", "deductions", "net_salary"])
        for item in items:
            writer.writerow(
                [
                    item.employee_id,
                    item.employee_name,
                    item.department,
                    item.position,
                    str(item.basic_salary),
                    str(item.total_allowances),
                    str(item.total_deductions),
                    str(item.net_salary),
                ]
            )
        audit(request, "payroll_exported_csv", entity="PayrollRun", entity_id=run.id)
        return response

    if export_format == "xlsx":
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Payroll"
        ws.append(["Employee ID", "Employee Name", "Department", "Position", "Basic Salary", "Allowances", "Deductions", "Net Salary"])
        for item in items:
            ws.append(
                [
                    item.employee_id,
                    item.employee_name,
                    item.department,
                    item.position,
                    float(item.basic_salary),
                    float(item.total_allowances),
                    float(item.total_deductions),
                    float(item.net_salary),
                ]
            )

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        response = HttpResponse(
            output.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="payroll_run_{run.id}.xlsx"'
        audit(request, "payroll_exported_xlsx", entity="PayrollRun", entity_id=run.id)
        return response

    if export_format == "pdf":
        lines = _build_payroll_summary_lines(run, items)
        pdf_bytes = _build_pdf_bytes(lines)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="payroll_run_{run.id}.pdf"'
        response["Content-Length"] = str(len(pdf_bytes))
        audit(request, "payroll_exported_pdf", entity="PayrollRun", entity_id=run.id)
        return response

    return _error_list(
        "Validation error",
        ["format must be one of: csv, pdf, xlsx."],
        status.HTTP_422_UNPROCESSABLE_ENTITY,
    )



def _generate_payroll_items(run, request=None):
    """
    Generates PayrollRunItems and Payslips for all active employees.
    Calculates totals and updates the PayrollRun.
    """
    from employees.models import EmployeeProfile
    
    # 1. Fetch active employees
    employees = EmployeeProfile.objects.filter(employment_status=EmployeeProfile.EmploymentStatus.ACTIVE)
    
    items_to_create = []
    payslips_to_create = []
    
    total_net_run = Decimal(0)
    count = 0
    
    for emp in employees:
        # 2. Calculate components
        basic = emp.basic_salary or Decimal(0)
        transport = emp.transportation_allowance or Decimal(0)
        accommodation = emp.accommodation_allowance or Decimal(0)
        telephone = emp.telephone_allowance or Decimal(0)
        petrol = emp.petrol_allowance or Decimal(0)
        other = emp.other_allowance or Decimal(0)
        
        total_allowances = transport + accommodation + telephone + petrol + other
        gross_salary = basic + total_allowances
        
        # Loan deduction: one approved loan, once, in the next payroll run.
        total_deductions = Decimal(0)
        loan_to_deduct = None
        if emp.user:
            from loans.models import LoanRequest

            loan_to_deduct = (
                LoanRequest.objects.select_for_update()
                .filter(
                    employee=emp.user,
                    status=LoanRequest.RequestStatus.APPROVED,
                    deduction_payroll_run__isnull=True,
                    is_active=True,
                )
                .order_by("created_at")
                .first()
            )
            if loan_to_deduct:
                deduction_amount = loan_to_deduct.approved_amount or loan_to_deduct.requested_amount
                total_deductions += deduction_amount
        
        net_salary = gross_salary - total_deductions
        
        # 3. Create Run Item
        item = PayrollRunItem(
            payroll_run=run,
            employee_id=emp.employee_id,
            employee_name=emp.full_name,
            department=emp.department or "",
            position=emp.job_title or "",
            basic_salary=basic,
            total_allowances=total_allowances,
            total_deductions=total_deductions,
            net_salary=net_salary
        )
        items_to_create.append(item)
        
        # 4. Persist deducted loan state
        if loan_to_deduct:
            loan_to_deduct.deduction_payroll_run = run
            loan_to_deduct.deducted_at = timezone.now()
            loan_to_deduct.deducted_amount = loan_to_deduct.approved_amount or loan_to_deduct.requested_amount
            loan_to_deduct.status = loan_to_deduct.RequestStatus.DEDUCTED
            loan_to_deduct.save(
                update_fields=[
                    "deduction_payroll_run",
                    "deducted_at",
                    "deducted_amount",
                    "status",
                    "updated_at",
                ]
            )
            if request:
                audit(
                    request,
                    "loan_deducted_in_payroll",
                    entity="LoanRequest",
                    entity_id=loan_to_deduct.id,
                    metadata={"payroll_run_id": run.id, "amount": str(loan_to_deduct.deducted_amount)},
                )

        # 5. Create Payslip (if user linked)
        if emp.user:
            payslip = Payslip(
                employee=emp.user,
                payroll_run=run,
                year=run.year,
                month=run.month,
                basic_salary=basic,
                transportation_allowance=transport,
                accommodation_allowance=accommodation,
                telephone_allowance=telephone,
                petrol_allowance=petrol,
                other_allowance=other,
                total_salary=gross_salary,
                total_deductions=total_deductions,
                net_salary=net_salary,
                payment_mode="Bank Transfer", # Default
                status="PAID", # Default for now
                is_active=True
            )
            payslips_to_create.append(payslip)
            
        total_net_run += net_salary
        count += 1
        
    # Bulk create
    PayrollRunItem.objects.bulk_create(items_to_create)
    Payslip.objects.bulk_create(payslips_to_create)
    
    # Update Run Totals
    run.total_net = total_net_run
    run.total_employees = count
    run.save(update_fields=["total_net", "total_employees"])

from employees.permissions import IsHRManagerOrAdmin

class PayrollRunViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = PayrollRun.objects.all()
        year = self.request.query_params.get("year")
        if year:
            try:
                qs = qs.filter(year=int(year))
            except ValueError:
                pass
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return PayrollRunCreateSerializer
        return PayrollRunSerializer

    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            if _is_duplicate_period_error(serializer.errors):
                return _error_list(
                    "Payroll run already exists.",
                    ["Payroll run already exists for this period."],
                    status.HTTP_409_CONFLICT,
                )
            return _error_list(
                "Validation error",
                _flatten_errors(serializer.errors),
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        try:
            with transaction.atomic():
                run = PayrollRun.objects.create(**serializer.validated_data)
                # Keep generation in the same DB transaction because it uses row locking
                # for loan deductions (select_for_update).
                _generate_payroll_items(run, request=request)
                run.refresh_from_db()
        except IntegrityError:
            return _error_list(
                "Payroll run already exists.",
                ["Payroll run already exists for this period."],
                status.HTTP_409_CONFLICT,
            )
        except Exception as exc:
            return _error_list(
                "Failed to create payroll run.",
                [str(exc)],
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        audit(request, "payroll_run_created", entity="PayrollRun", entity_id=run.id)

        return success(PayrollRunSerializer(run).data, status=status.HTTP_201_CREATED)


    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return success(PayrollRunSerializer(instance).data)

    @action(detail=True, methods=["get"], url_path="items")
    def items(self, request, pk=None):
        run = self.get_object()
        qs = PayrollRunItem.objects.filter(payroll_run=run).order_by("id")
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request, view=self)
        if page is not None:
            serializer = PayrollRunItemSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)
        serializer = PayrollRunItemSerializer(qs, many=True)
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

    @action(
        detail=True,
        methods=["post"],
        url_path="finalize",
        throttle_classes=[PayrollFinalizeThrottle],
    )
    def finalize(self, request, pk=None):
        run = self.get_object()
        confirm = request.data.get("confirm")
        if confirm is not True:
            return _error_list(
                "Validation error",
                ["confirm must be true."],
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        if run.status in [PayrollRun.Status.COMPLETED, PayrollRun.Status.PAID]:
            return success({"message": "Payroll run already finalized."})

        if run.status == PayrollRun.Status.CANCELLED:
            return _error_list(
                "Payroll run is cancelled.",
                ["Cancelled runs cannot be finalized."],
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        run.status = PayrollRun.Status.COMPLETED
        run.save(update_fields=["status", "updated_at"])
        audit(request, "payroll_run_finalized", entity="PayrollRun", entity_id=run.id)
        return success({"message": "Payroll run finalized."})

    @action(
        detail=True,
        methods=["post"],
        url_path="generate-payslips",
        throttle_classes=[PayrollGeneratePayslipsThrottle],
    )
    def generate_payslips(self, request, pk=None):
        run = self.get_object()
        if run.status not in [PayrollRun.Status.COMPLETED, PayrollRun.Status.PAID]:
            return _error_list(
                "Payroll run not finalized.",
                ["Finalize the payroll run before generating payslips."],
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        with transaction.atomic():
            payslips_qs = Payslip.objects.filter(payroll_run=run, is_active=True)
            total_payslips = payslips_qs.count()
            generated_count = payslips_qs.exclude(status="PAID").update(status="PAID")

            if run.status != PayrollRun.Status.PAID:
                run.status = PayrollRun.Status.PAID
                run.save(update_fields=["status", "updated_at"])

        audit(request, "payslips_generated", entity="PayrollRun", entity_id=run.id)
        return success(
            {
                "message": "Payslips generated",
                "generated_count": generated_count,
                "total_payslips": total_payslips,
                "run_status": run.status,
                "download_pdf_url": f"/payroll-runs/{run.id}/export/?format=pdf",
            }
        )

    @action(
        detail=True,
        methods=["get"],
        url_path="export",
        throttle_classes=[PayrollExportThrottle],
    )
    def export(self, request, pk=None):
        run = self.get_object()
        return _export_payroll_run_response(request, run)


class PayrollRunExportView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request, pk):
        run = get_object_or_404(PayrollRun.objects.all(), pk=pk)
        return _export_payroll_run_response(request, run)



class EmployeePayslipViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated, IsEmployeeOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        return Payslip.objects.select_related("payroll_run").filter(
            employee=self.request.user,
            is_active=True,
            payroll_run__status__in=[PayrollRun.Status.COMPLETED, PayrollRun.Status.PAID],
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return PayslipDetailSerializer
        return PayslipListSerializer

    def list(self, request, *args, **kwargs):
        if "employee_id" in request.query_params:
            return _error_list(
                "Validation error",
                ["employee_id is not allowed."],
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        qs = self.get_queryset()
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

    def _get_owned_payslip(self, pk):
        try:
            return self.get_queryset().get(pk=pk)
        except Payslip.DoesNotExist:
            return None

    def retrieve(self, request, *args, **kwargs):
        payslip = self._get_owned_payslip(kwargs.get("pk"))
        if payslip is None:
            return _error_list("Not found", ["Not found."], status.HTTP_404_NOT_FOUND)
        audit(request, "payslip_viewed", entity="Payslip", entity_id=payslip.id)
        return success(PayslipDetailSerializer(payslip).data)

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, pk=None):
        payslip = self._get_owned_payslip(pk)
        if payslip is None:
            return _error_list("Not found", ["Not found."], status.HTTP_404_NOT_FOUND)

        lines = [
            f"Payslip {payslip.id}",
            f"Period: {payslip.year}-{payslip.month:02d}",
            f"Status: {payslip.status}",
            f"Payment Mode: {payslip.payment_mode}",
            f"Basic Salary: {payslip.basic_salary:.2f}",
            f"Transportation Allowance: {payslip.transportation_allowance:.2f}",
            f"Accommodation Allowance: {payslip.accommodation_allowance:.2f}",
            f"Telephone Allowance: {payslip.telephone_allowance:.2f}",
            f"Petrol Allowance: {payslip.petrol_allowance:.2f}",
            f"Other Allowance: {payslip.other_allowance:.2f}",
            f"Total Salary: {payslip.total_salary:.2f}",
            f"Total Deductions: {payslip.total_deductions:.2f}",
            f"Net Salary: {payslip.net_salary:.2f}",
        ]
        pdf_bytes = _build_pdf_bytes(lines)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="payslip_{payslip.id}.pdf"'
        response["Content-Length"] = str(len(pdf_bytes))
        audit(request, "payslip_downloaded", entity="Payslip", entity_id=payslip.id)
        return response
