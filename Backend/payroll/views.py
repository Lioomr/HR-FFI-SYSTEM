import csv
import io
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.http import HttpResponse

from rest_framework import mixins, viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

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


class PayrollRunViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated, IsHRManagerOnly]
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
            return _error_list(
                "Validation error",
                _flatten_errors(serializer.errors),
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        try:
            with transaction.atomic():
                run = PayrollRun.objects.create(**serializer.validated_data)
        except IntegrityError:
            return _error_list(
                "Payroll run already exists.",
                ["Payroll run already exists for this period."],
                status.HTTP_409_CONFLICT,
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

        audit(request, "payslips_generated", entity="PayrollRun", entity_id=run.id)
        return success({"message": "Payslips generated"})

    @action(
        detail=True,
        methods=["get"],
        url_path="export",
        throttle_classes=[PayrollExportThrottle],
    )
    def export(self, request, pk=None):
        run = self.get_object()
        if run.status not in [PayrollRun.Status.COMPLETED, PayrollRun.Status.PAID]:
            return _error_list(
                "Payroll run not finalized.",
                ["Finalize the payroll run before exporting."],
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        export_format = request.query_params.get("format")
        if export_format not in ["csv", "pdf"]:
            return _error_list(
                "Validation error",
                ["format must be csv or pdf."],
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        items = PayrollRunItem.objects.filter(payroll_run=run).order_by("id")

        if export_format == "csv":
            response = HttpResponse(content_type="text/csv")
            response["Content-Disposition"] = (
                f'attachment; filename="payroll_run_{run.id}_csv.csv"'
            )
            writer = csv.writer(response)
            writer.writerow(
                [
                    "id",
                    "employee_id",
                    "employee_name",
                    "department",
                    "position",
                    "basic_salary",
                    "total_allowances",
                    "total_deductions",
                    "net_salary",
                ]
            )
            for item in items.iterator():
                writer.writerow(
                    [
                        item.id,
                        item.employee_id,
                        item.employee_name,
                        item.department,
                        item.position,
                        f"{item.basic_salary:.2f}",
                        f"{item.total_allowances:.2f}",
                        f"{item.total_deductions:.2f}",
                        f"{item.net_salary:.2f}",
                    ]
                )
            audit(request, "payroll_exported", entity="PayrollRun", entity_id=run.id)
            return response

        total_net = Decimal(run.total_net or 0)
        header_lines = [
            f"Payroll Run: {run.year}-{run.month:02d}",
            f"Status: {run.status}",
            f"Total Employees: {run.total_employees}",
            f"Total Net: {total_net:.2f}",
        ]
        pdf_bytes = _build_pdf_bytes(header_lines)
        audit(request, "payroll_exported", entity="PayrollRun", entity_id=run.id)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'attachment; filename="payroll_run_{run.id}_pdf.pdf"'
        )
        response["Content-Length"] = str(len(pdf_bytes))
        return response


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
