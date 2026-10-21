import csv
import logging
from html import escape

from django.http import HttpResponse
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from audit.utils import audit
from core.pagination import StandardPagination
from core.pdf import (
    PALETTE,
    build_corporate_header,
    build_platypus_story_pdf,
    build_signature_stamp_block,
    font_pair,
    shape_ar,
)
from core.responses import error, success
from organization.services import (
    filter_queryset_by_company_scope,
    get_active_company_for_request,
)

from .calculator import period_dates
from .models import PayrollRun, PayrollRunItem, Payslip
from .permissions import IsEmployeeOnly
from .serializers import (
    PayslipDetailSerializer,
    PayslipListSerializer,
)

logger = logging.getLogger(__name__)


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


def _cell_paragraph(value, style):
    text = escape(shape_ar(str(value or "-")))
    regular, bold = font_pair()
    localized = ParagraphStyle("PayrollLocalized", parent=style, fontName=bold if "Bold" in style.fontName else regular)
    return Paragraph(text, localized)


def _build_payslip_pdf(payslip):
    from .dto import employee_dto
    from .i18n import translated

    value = employee_dto(payslip)
    styles = getSampleStyleSheet()
    name = getattr(payslip.payroll_run_item, "employee_name", "") or getattr(payslip.employee, "full_name", "") or "-"
    rows = [[_cell_paragraph(translated("payroll.pdf.earnings"), styles["Normal"]), "SAR"]]
    for category in ("salary_components", "additions", "deductions"):
        for line in value[category]:
            rows.append([_cell_paragraph(line["label"], styles["Normal"]), line["amount"]])
    rows.extend(
        [
            [_cell_paragraph(translated("payroll.field." + name), styles["Normal"]), value[name]]
            for name in ("gross_salary", "total_additions", "total_deductions", "net_salary")
        ]
    )
    table = Table(rows, colWidths=[120 * mm, 55 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PALETTE["light_orange"]),
                ("GRID", (0, 0), (-1, -1), 0.3, PALETTE["grid_orange"]),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    period_start, period_end = period_dates(
        payslip.payroll_run.year,
        payslip.payroll_run.month,
        payslip.payroll_run.calendar_days,
        period_start=payslip.payroll_run.period_start,
        period_end=payslip.payroll_run.period_end,
        period_basis=payslip.payroll_run.period_basis,
    )
    period_day_count = payslip.payroll_run.calendar_days or (period_end - period_start).days + 1
    story = [
        build_corporate_header(
            title=translated("payroll.pdf.payslip"),
            period_text=(
                f"{translated('payroll.pdf.period')} {period_start.isoformat()} – {period_end.isoformat()} "
                f"({period_day_count} {translated('payroll.pdf.calendar_days')})"
            ),
            second_col_width=138 * mm,
        ),
        Spacer(1, 8),
        _cell_paragraph(name, styles["Heading2"]),
        _cell_paragraph(
            f"{translated('payroll.status.' + payslip.status.lower())}; {translated('payroll.pdf.payment_mode')}: "
            f"{payslip.payment_mode}; {translated('payroll.pdf.payslip_id')}: {payslip.pk}",
            styles["Normal"],
        ),
        Spacer(1, 8),
        table,
        Spacer(1, 10),
        build_signature_stamp_block(total_width=182 * mm),
    ]
    return build_platypus_story_pdf(story, f"Payslip {payslip.pk}")


def _build_payroll_report_pdf(run, items):
    from .pdf_report import build_payroll_report_pdf

    return build_payroll_report_pdf(run, items)


def _export_payroll_run_response(request, run):
    export_format = (
        request.query_params.get("file_format")
        or request.query_params.get("export_format")
        or request.query_params.get("format")
        or "pdf"
    ).lower()
    items = list(PayrollRunItem.objects.filter(payroll_run=run, is_active=True).order_by("employee_name", "id"))

    if export_format == "csv":
        response = HttpResponse(content_type="application/octet-stream")
        response["Content-Disposition"] = f'attachment; filename="payroll_run_{run.id}.csv"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        writer = csv.writer(response)
        from .exporting import payroll_rows

        writer.writerows(payroll_rows(run, items))
        audit(request, "payroll_exported_csv", entity="PayrollRun", entity_id=run.id)
        return response

    if export_format == "xlsx":
        from .exporting import workbook

        response = HttpResponse(workbook(run, items), content_type="application/octet-stream")
        response["Content-Disposition"] = f'attachment; filename="payroll_run_{run.id}.xlsx"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        audit(request, "payroll_exported_xlsx", entity="PayrollRun", entity_id=run.id)
        return response

    if export_format == "pdf":
        pdf_bytes = _build_payroll_report_pdf(run, items)
        response = HttpResponse(pdf_bytes, content_type="application/octet-stream")
        response["Content-Disposition"] = f'attachment; filename="payroll_run_{run.id}.pdf"'
        response["Content-Length"] = str(len(pdf_bytes))
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        audit(request, "payroll_exported_pdf", entity="PayrollRun", entity_id=run.id)
        return response

    return _error_list(
        "Validation error",
        ["file_format must be one of: csv, pdf, xlsx."],
        status.HTTP_422_UNPROCESSABLE_ENTITY,
    )


def _generate_payroll_items(run, request=None):
    from .engine import recalculate

    return recalculate(run, request=request)


from .api import PayrollRunExportView, PayrollRunViewSet  # noqa: E402,F401


class EmployeePayslipViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated, IsEmployeeOnly]
    pagination_class = StandardPagination

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def get_queryset(self):
        queryset = (
            Payslip.objects.select_related("payroll_run")
            .order_by("-payroll_run__period_end", "-payroll_run__period_start", "-id")
            .filter(
                employee=self.request.user,
                is_active=True,
                payroll_run__status__in=[PayrollRun.Status.COMPLETED, PayrollRun.Status.PAID],
            )
        )
        active_company = get_active_company_for_request(self.request)
        if active_company is not None:
            return queryset.filter(payroll_run__company=active_company)
        return filter_queryset_by_company_scope(queryset, self.request, field_name="payroll_run__company_id")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return PayslipDetailSerializer
        return PayslipListSerializer

    def list(self, request, *args, **kwargs):
        if any(key in request.query_params for key in ("employee_id", "employee_profile_id", "user_id")):
            return _error_list(
                "Validation error",
                ["employee_id is not allowed."],
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        qs = self.get_queryset()
        year = request.query_params.get("year")
        if year not in [None, ""]:
            try:
                year = int(year)
            except (TypeError, ValueError):
                return _error_list(
                    "Validation error",
                    ["year must be an integer."],
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            if year < 1900 or year > 2100:
                return _error_list(
                    "Validation error",
                    ["year must be between 1900 and 2100."],
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            qs = qs.filter(year=year)
        audit(
            request,
            "payslip_list_viewed",
            entity="Payslip",
            metadata={"year": year if year not in [None, ""] else None},
        )
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

        pdf_bytes = _build_payslip_pdf(payslip)
        response = HttpResponse(pdf_bytes, content_type="application/octet-stream")
        response["Content-Disposition"] = f'attachment; filename="payslip_{payslip.id}.pdf"'
        response["Content-Length"] = str(len(pdf_bytes))
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        response["Pragma"] = "no-cache"
        audit(request, "payslip_downloaded", entity="Payslip", entity_id=payslip.id)
        return response
