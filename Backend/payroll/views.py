import csv
import io
import os
from xml.sax.saxutils import escape
from decimal import Decimal

import openpyxl
from django.conf import settings
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from django.db import IntegrityError, transaction
from django.db.models import Avg, Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import audit
from core.pagination import StandardPagination
from core.responses import error, success
from employees.permissions import IsHRManagerOrAdmin

from .models import PayrollRun, PayrollRunItem, Payslip
from .permissions import IsEmployeeOnly
from .serializers import (
    PayrollRunCreateSerializer,
    PayrollRunItemSerializer,
    PayrollRunSerializer,
    PayslipDetailSerializer,
    PayslipListSerializer,
)
from .throttles import (
    PayrollExportThrottle,
    PayrollFinalizeThrottle,
    PayrollGeneratePayslipsThrottle,
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


def _is_duplicate_period_error(error_dict) -> bool:
    for field, messages in error_dict.items():
        joined = " ".join(str(msg).lower() for msg in (messages if isinstance(messages, (list, tuple)) else [messages]))
        if field in {"non_field_errors", "__all__"} and ("already exists" in joined or "unique" in joined):
            return True
        if "unique_payroll_run_period" in joined:
            return True
    return False


def _fmt_amount(value):
    return f"{(value or Decimal('0.00')):,.2f}"


def _first_two_names(full_name):
    name = " ".join(str(full_name or "").strip().split())
    if not name:
        return "-"
    return " ".join(name.split(" ")[:2])


def _get_pdf_logo_path():
    candidates = [
        os.path.join(str(settings.BASE_DIR), "static", "email", "ffi-logo.png"),
        os.path.join(str(settings.BASE_DIR), "ffi-logo.png"),
        os.path.join(str(settings.BASE_DIR), "Logo FFI.png"),
        os.path.join(str(settings.BASE_DIR.parent), "FrontEnd", "public", "ffi-logo.png"),
        "/app/static/email/ffi-logo.png",
        "/app/ffi-logo.png",
        "/app/Logo FFI.png",
    ]
    return next((path for path in candidates if os.path.exists(path)), "")


def _cell_paragraph(value, style):
    text = escape(str(value or "-"))
    return Paragraph(text, style)


def _short_text(value, max_chars):
    text = " ".join(str(value or "").split())
    if not text:
        return "-"
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars - 3]}..."


def _build_reportlab_pdf(story, report_name, pagesize=A4):
    buffer = io.BytesIO()
    left_margin = 14 * mm
    right_margin = 14 * mm
    top_margin = 16 * mm
    bottom_margin = 16 * mm

    doc = SimpleDocTemplate(
        buffer,
        pagesize=pagesize,
        leftMargin=left_margin,
        rightMargin=right_margin,
        topMargin=top_margin,
        bottomMargin=bottom_margin,
    )
    generated_at = timezone.now().strftime("%Y-%m-%d %H:%M:%S")

    def _draw_header_footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("Helvetica-Bold", 10)
        canvas.setFillColor(colors.HexColor("#1f2937"))
        canvas.drawString(left_margin, pagesize[1] - (10 * mm), report_name)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#6b7280"))
        canvas.drawString(left_margin, 8 * mm, f"Generated at: {generated_at}")
        canvas.drawRightString(pagesize[0] - right_margin, 8 * mm, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_draw_header_footer, onLaterPages=_draw_header_footer)
    return buffer.getvalue()


def _pdf_palette():
    return {
        "primary_orange": colors.HexColor("#f97316"),
        "light_orange": colors.HexColor("#ffedd5"),
        "soft_orange": colors.HexColor("#fff7ed"),
        "dark_text": colors.HexColor("#111827"),
        "muted_text": colors.HexColor("#6b7280"),
        "border_orange": colors.HexColor("#fdba74"),
        "grid_orange": colors.HexColor("#fed7aa"),
    }


def _build_corporate_header(title, period_text, palette, second_col_width):
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "PdfCorporateTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=15,
        textColor=palette["dark_text"],
        spaceAfter=2,
    )
    subtitle_style = ParagraphStyle(
        "PdfCorporateSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        textColor=palette["muted_text"],
        spaceAfter=6,
    )

    logo_path = _get_pdf_logo_path()
    logo_cell = ""
    if logo_path:
        logo_cell = Image(logo_path, width=32 * mm, height=12 * mm)

    header_table = Table(
        [
            [
                logo_cell,
                [
                    Paragraph("FFI HR SYSTEM", subtitle_style),
                    Paragraph(title, title_style),
                    Paragraph(period_text, subtitle_style),
                ],
            ]
        ],
        colWidths=[38 * mm, second_col_width],
    )
    header_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 1, palette["primary_orange"]),
                ("LINEBELOW", (0, 0), (-1, 0), 1, palette["primary_orange"]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return header_table


def _build_signature_stamp_block(total_width, palette):
    signer_width = (total_width * 0.23)
    stamp_width = total_width - (signer_width * 3)
    signature_table = Table(
        [
            ["Prepared By", "Reviewed By", "Approved By", "Company Stamp"],
            [
                "Name: ____________________\nDate: ____________________\nSignature: _______________",
                "Name: ____________________\nDate: ____________________\nSignature: _______________",
                "Name: ____________________\nDate: ____________________\nSignature: _______________",
                "\n\n\n",
            ],
        ],
        colWidths=[signer_width, signer_width, signer_width, stamp_width],
    )
    signature_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), palette["primary_orange"]),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("BACKGROUND", (0, 1), (-2, 1), colors.white),
                ("BACKGROUND", (-1, 1), (-1, 1), palette["soft_orange"]),
                ("FONTNAME", (0, 1), (-1, 1), "Helvetica"),
                ("FONTSIZE", (0, 1), (-2, 1), 7),
                ("FONTSIZE", (-1, 1), (-1, 1), 7),
                ("TEXTCOLOR", (0, 1), (-1, 1), palette["dark_text"]),
                ("BOX", (0, 0), (-1, -1), 0.7, palette["border_orange"]),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, palette["grid_orange"]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return signature_table


def _build_simple_lines_pdf(title, lines):
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "PdfTitle",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        textColor=colors.HexColor("#111827"),
        spaceAfter=8,
    )
    line_style = ParagraphStyle(
        "PdfLine",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#374151"),
    )

    story = [Paragraph(title, title_style), Spacer(1, 4)]
    for line in lines:
        story.append(Paragraph(str(line), line_style))
        story.append(Spacer(1, 2))
    return _build_reportlab_pdf(story, title)


def _build_payslip_pdf(payslip):
    styles = getSampleStyleSheet()
    palette = _pdf_palette()
    primary_orange = palette["primary_orange"]
    light_orange = palette["light_orange"]
    soft_orange = palette["soft_orange"]
    dark_text = palette["dark_text"]

    title_style = ParagraphStyle(
        "PayslipTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=15,
        textColor=dark_text,
        spaceAfter=2,
    )
    value_style = ParagraphStyle(
        "PayslipValue",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        textColor=dark_text,
    )

    employee_name = getattr(getattr(payslip, "employee", None), "full_name", "") or getattr(
        getattr(payslip, "employee", None), "email", "-"
    )
    header_table = _build_corporate_header(
        title="Employee Payslip",
        period_text=f"Period {payslip.year}-{payslip.month:02d}",
        palette=palette,
        second_col_width=138 * mm,
    )

    details_table = Table(
        [
            ["Employee", Paragraph(_short_text(employee_name, 34), value_style), "Status", Paragraph(payslip.status, value_style)],
            ["Payment Mode", Paragraph(str(payslip.payment_mode), value_style), "Payslip ID", Paragraph(str(payslip.id), value_style)],
        ],
        colWidths=[30 * mm, 58 * mm, 30 * mm, 58 * mm],
    )
    details_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), soft_orange),
                ("BOX", (0, 0), (-1, -1), 0.7, primary_orange),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, palette["grid_orange"]),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (-1, -1), dark_text),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )

    earnings_table = Table(
        [
            ["Basic Salary", _fmt_amount(payslip.basic_salary)],
            ["Transportation", _fmt_amount(payslip.transportation_allowance)],
            ["Accommodation", _fmt_amount(payslip.accommodation_allowance)],
            ["Telephone", _fmt_amount(payslip.telephone_allowance)],
            ["Petrol", _fmt_amount(payslip.petrol_allowance)],
            ["Other", _fmt_amount(payslip.other_allowance)],
            ["Total Salary", _fmt_amount(payslip.total_salary)],
        ],
        colWidths=[58 * mm, 40 * mm],
    )
    earnings_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), primary_orange),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTNAME", (0, 6), (-1, 6), "Helvetica-Bold"),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#fdba74")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, palette["grid_orange"]),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, soft_orange]),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]
        )
    )

    net_table = Table(
        [
            ["Total Deductions", _fmt_amount(payslip.total_deductions)],
            ["Net Salary", _fmt_amount(payslip.net_salary)],
        ],
        colWidths=[58 * mm, 40 * mm],
    )
    net_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), light_orange),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("BOX", (0, 0), (-1, -1), 0.7, primary_orange),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, palette["grid_orange"]),
                ("TEXTCOLOR", (0, 0), (-1, -1), dark_text),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
            ]
        )
    )

    story = [
        header_table,
        Spacer(1, 8),
        details_table,
        Spacer(1, 10),
        Paragraph("Earnings Breakdown", title_style),
        earnings_table,
        Spacer(1, 8),
        net_table,
        Spacer(1, 10),
        _build_signature_stamp_block(total_width=182 * mm, palette=palette),
    ]
    return _build_reportlab_pdf(story, f"Payslip {payslip.id}")


def _build_payroll_report_pdf(run, items):
    styles = getSampleStyleSheet()
    palette = _pdf_palette()
    primary_orange = palette["primary_orange"]
    light_orange = palette["light_orange"]
    soft_orange = palette["soft_orange"]
    dark_text = palette["dark_text"]

    title_style = ParagraphStyle(
        "PayrollReportTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=15,
        textColor=dark_text,
        spaceAfter=2,
    )
    cell_style = ParagraphStyle(
        "PayrollCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=9,
        textColor=dark_text,
    )
    meta_value_style = ParagraphStyle(
        "PayrollMetaValue",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        textColor=dark_text,
    )

    total_basic = sum((item.basic_salary or Decimal("0.00")) for item in items)
    total_allowances = sum((item.total_allowances or Decimal("0.00")) for item in items)
    total_deductions = sum((item.total_deductions or Decimal("0.00")) for item in items)
    total_net = sum((item.net_salary or Decimal("0.00")) for item in items)

    header_table = _build_corporate_header(
        title="Payroll Run Report",
        period_text=f"Period {run.month:02d}/{run.year}",
        palette=palette,
        second_col_width=220 * mm,
    )
    story = [header_table, Spacer(1, 8)]

    metadata_table = Table(
        [
            ["Run ID", Paragraph(str(run.id), meta_value_style), "Status", Paragraph(str(run.status), meta_value_style)],
            [
                "Employees",
                Paragraph(str(run.total_employees), meta_value_style),
                "Recorded Total Net",
                Paragraph(_fmt_amount(run.total_net), meta_value_style),
            ],
        ],
        colWidths=[24 * mm, 66 * mm, 36 * mm, 132 * mm],
    )
    metadata_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), soft_orange),
                ("BOX", (0, 0), (-1, -1), 0.7, primary_orange),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, palette["grid_orange"]),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (-1, -1), dark_text),
                ("ALIGN", (1, 0), (1, -1), "LEFT"),
                ("ALIGN", (3, 0), (3, -1), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.extend([metadata_table, Spacer(1, 10)])

    summary_table = Table(
        [
            ["Total Basic", _fmt_amount(total_basic), "Total Allowances", _fmt_amount(total_allowances)],
            ["Total Deductions", _fmt_amount(total_deductions), "Total Net", _fmt_amount(total_net)],
        ],
        colWidths=[44 * mm, 56 * mm, 44 * mm, 56 * mm],
    )
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), light_orange),
                ("BOX", (0, 0), (-1, -1), 0.7, primary_orange),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, palette["grid_orange"]),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (-1, -1), dark_text),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("ALIGN", (3, 0), (3, -1), "RIGHT"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.extend([summary_table, Spacer(1, 10)])

    rows = [
        ["Employee ID", "Employee Name", "Department", "Position", "Basic", "Allowances", "Deductions", "Net"],
    ]
    for item in items:
        rows.append(
            [
                str(item.employee_id or "-"),
                _cell_paragraph(_first_two_names(item.employee_name), cell_style),
                _cell_paragraph(_short_text(item.department, 30), cell_style),
                _cell_paragraph(_short_text(item.position, 28), cell_style),
                _fmt_amount(item.basic_salary),
                _fmt_amount(item.total_allowances),
                _fmt_amount(item.total_deductions),
                _fmt_amount(item.net_salary),
            ]
        )
    if len(rows) == 1:
        rows.append(["-", "No employees found", "-", "-", "0.00", "0.00", "0.00", "0.00"])

    details_table = Table(
        rows,
        repeatRows=1,
        colWidths=[26 * mm, 44 * mm, 42 * mm, 40 * mm, 26 * mm, 28 * mm, 26 * mm, 28 * mm],
    )
    details_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), primary_orange),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 1), (-1, -1), 7),
                ("TEXTCOLOR", (0, 1), (-1, -1), dark_text),
                ("ALIGN", (4, 1), (-1, -1), "RIGHT"),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("BOX", (0, 0), (-1, -1), 0.6, palette["border_orange"]),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, palette["grid_orange"]),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#ffffff"), soft_orange]),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(details_table)
    story.extend([Spacer(1, 10), _build_signature_stamp_block(total_width=269 * mm, palette=palette)])

    return _build_reportlab_pdf(story, "Payroll Run Report", pagesize=landscape(A4))


def _export_payroll_run_response(request, run):
    export_format = (
        request.query_params.get("file_format")
        or request.query_params.get("export_format")
        or request.query_params.get("format")
        or "pdf"
    ).lower()
    items = list(PayrollRunItem.objects.filter(payroll_run=run).order_by("employee_name", "id"))

    if export_format == "csv":
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="payroll_run_{run.id}.csv"'
        writer = csv.writer(response)
        writer.writerow(
            [
                "employee_id",
                "employee_name",
                "department",
                "position",
                "basic_salary",
                "allowances",
                "deductions",
                "net_salary",
            ]
        )
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
        ws.append(
            [
                "Employee ID",
                "Employee Name",
                "Department",
                "Position",
                "Basic Salary",
                "Allowances",
                "Deductions",
                "Net Salary",
            ]
        )
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
        pdf_bytes = _build_payroll_report_pdf(run, items)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="payroll_run_{run.id}.pdf"'
        response["Content-Length"] = str(len(pdf_bytes))
        audit(request, "payroll_exported_pdf", entity="PayrollRun", entity_id=run.id)
        return response

    return _error_list(
        "Validation error",
        ["file_format must be one of: csv, pdf, xlsx."],
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

        # Open-loan deduction policy:
        # - Deduct in current payroll month target.
        # - If target month was missed, deduct in the next available run (overdue carry-forward).
        total_deductions = Decimal(0)
        loan_to_deduct = None
        if emp.user:
            from loans.models import LoanRequest

            due_for_run_q = (
                Q(target_deduction_year__lt=run.year)
                | Q(target_deduction_year=run.year, target_deduction_month__lte=run.month)
                | Q(target_deduction_year__isnull=True, target_deduction_month__isnull=True)
            )
            loan_to_deduct = (
                LoanRequest.objects.select_for_update()
                .filter(
                    employee=emp.user,
                    status=LoanRequest.RequestStatus.APPROVED,
                    deduction_payroll_run__isnull=True,
                    is_active=True,
                )
                .filter(due_for_run_q)
                .order_by("target_deduction_year", "target_deduction_month", "created_at")
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
            net_salary=net_salary,
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
                payment_mode="Bank Transfer",  # Default
                status="PAID",  # Default for now
                is_active=True,
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

    @action(detail=True, methods=["get"], url_path="summary")
    def summary(self, request, pk=None):
        run = self.get_object()
        items_qs = PayrollRunItem.objects.filter(payroll_run=run)
        aggregates = items_qs.aggregate(
            total_basic_salary=Sum("basic_salary"),
            total_allowances=Sum("total_allowances"),
            total_deductions=Sum("total_deductions"),
            average_net_salary=Avg("net_salary"),
        )
        employees_with_deductions = items_qs.filter(total_deductions__gt=0).count()
        total_basic_salary = aggregates["total_basic_salary"] or Decimal("0")
        total_allowances = aggregates["total_allowances"] or Decimal("0")
        total_deductions = aggregates["total_deductions"] or Decimal("0")
        average_net_salary = aggregates["average_net_salary"] or Decimal("0")
        total_gross_salary = total_basic_salary + total_allowances

        return success(
            {
                "run_id": run.id,
                "year": run.year,
                "month": run.month,
                "total_employees": run.total_employees,
                "employees_with_deductions": employees_with_deductions,
                "total_basic_salary": total_basic_salary,
                "total_allowances": total_allowances,
                "total_gross_salary": total_gross_salary,
                "total_deductions": total_deductions,
                "total_net_salary": run.total_net,
                "average_net_salary": average_net_salary,
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
                "download_pdf_url": f"/payroll-runs/{run.id}/export/?file_format=pdf",
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

        pdf_bytes = _build_payslip_pdf(payslip)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="payslip_{payslip.id}.pdf"'
        response["Content-Length"] = str(len(pdf_bytes))
        audit(request, "payslip_downloaded", entity="Payslip", entity_id=payslip.id)
        return response
