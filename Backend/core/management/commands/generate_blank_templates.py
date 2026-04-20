"""Regenerate blank PDF templates for the HR Template Library.

Run via:

    python manage.py generate_blank_templates

Reuses ``core.pdf.render_request_pdf`` so templates always reflect the
current unified branding. Output is committed under
``Backend/static/pdf_templates/``.
"""

from __future__ import annotations

import io
import os
import shutil

from django.conf import settings
from django.core.management.base import BaseCommand

from core.pdf import (
    ApprovalStage,
    DetailRow,
    EmployeeBlock,
    ExtraSection,
    PALETTE_RGB,
    RequestDocument,
    font_pair,
    get_logo_path,
    register_fonts,
    render_request_pdf,
    shape_ar,
)
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas as pdf_canvas


TEMPLATES_DIR = os.path.join(str(settings.BASE_DIR), "static", "pdf_templates")


def _blank_employee_block() -> EmployeeBlock:
    return EmployeeBlock(
        name="_____________________",
        employee_number="_______________",
        department="_______________",
        job_title="_______________",
        national_id="_______________",
        mobile="_______________",
    )


def _blank_approval_stages() -> list[ApprovalStage]:
    return [
        ApprovalStage(stage_en="Submitted", stage_ar="مُقدّم", actor="________", at="________", note="________"),
        ApprovalStage(stage_en="Manager Review", stage_ar="مراجعة المدير", actor="________", at="________", note="________"),
        ApprovalStage(stage_en="HR Review", stage_ar="مراجعة الموارد البشرية", actor="________", at="________", note="________"),
        ApprovalStage(stage_en="Final Approval", stage_ar="اعتماد نهائي", actor="________", at="________", note="________"),
    ]


def _render_leave_blank() -> bytes:
    doc = RequestDocument(
        title_en="Leave Request",
        title_ar="طلب إجازة",
        reference_no="__________",
        employee=_blank_employee_block(),
        details=[
            DetailRow("Leave Type", "نوع الإجازة", "_______________"),
            DetailRow("Start Date", "تاريخ البدء", "____-__-__"),
            DetailRow("End Date", "تاريخ الانتهاء", "____-__-__"),
            DetailRow("Working Days", "أيام العمل", "____"),
            DetailRow("Contact During Leave", "التواصل أثناء الإجازة", "_______________"),
        ],
        approvals=_blank_approval_stages(),
        extra=[ExtraSection(title_en="Reason", title_ar="السبب", body="_" * 80)],
        status_label="DRAFT",
    )
    return render_request_pdf(doc)


def _render_loan_blank() -> bytes:
    doc = RequestDocument(
        title_en="Loan Request",
        title_ar="طلب سلفة",
        reference_no="__________",
        employee=_blank_employee_block(),
        details=[
            DetailRow("Loan Type", "نوع السلفة", "_______________"),
            DetailRow("Requested Amount", "المبلغ المطلوب", "____________"),
            DetailRow("Installment Months", "عدد الأشهر", "____"),
            DetailRow("Target Deduction", "شهر الخصم", "____-__"),
        ],
        approvals=_blank_approval_stages()
        + [ApprovalStage(stage_en="Disbursement", stage_ar="الصرف", actor="________", at="________", note="________")],
        extra=[ExtraSection(title_en="Reason", title_ar="السبب", body="_" * 80)],
        status_label="DRAFT",
    )
    return render_request_pdf(doc)


def _render_damage_blank() -> bytes:
    doc = RequestDocument(
        title_en="Asset Damage Report",
        title_ar="تقرير ضرر أصل",
        reference_no="__________",
        employee=_blank_employee_block(),
        details=[
            DetailRow("Asset Code", "رمز الأصل", "_______________"),
            DetailRow("Asset Name", "اسم الأصل", "_______________"),
            DetailRow("Asset Type", "نوع الأصل", "_______________"),
            DetailRow("Serial Number", "الرقم التسلسلي", "_______________"),
            DetailRow("Reported At", "تاريخ البلاغ", "____-__-__"),
        ],
        approvals=_blank_approval_stages(),
        extra=[ExtraSection(title_en="Damage Description", title_ar="وصف الضرر", body="_" * 80)],
        status_label="DRAFT",
    )
    return render_request_pdf(doc)


def _render_return_blank() -> bytes:
    doc = RequestDocument(
        title_en="Asset Return Request",
        title_ar="طلب إعادة أصل",
        reference_no="__________",
        employee=_blank_employee_block(),
        details=[
            DetailRow("Asset Code", "رمز الأصل", "_______________"),
            DetailRow("Asset Name", "اسم الأصل", "_______________"),
            DetailRow("Asset Type", "نوع الأصل", "_______________"),
            DetailRow("Serial Number", "الرقم التسلسلي", "_______________"),
            DetailRow("Requested At", "تاريخ الطلب", "____-__-__"),
        ],
        approvals=_blank_approval_stages(),
        extra=[ExtraSection(title_en="Reason / Notes", title_ar="السبب / ملاحظات", body="_" * 80)],
        status_label="DRAFT",
    )
    return render_request_pdf(doc)


def _render_rent_blank() -> bytes:
    doc = RequestDocument(
        title_en="Rent Agreement",
        title_ar="اتفاقية إيجار",
        reference_no="__________",
        employee=EmployeeBlock(),
        details=[
            DetailRow("Rent Type", "نوع الإيجار", "_______________"),
            DetailRow("Property", "العقار", "_______________"),
            DetailRow("Address", "العنوان", "_______________"),
            DetailRow("Lease Start", "بداية العقد", "____-__-__"),
            DetailRow("Lease End", "نهاية العقد", "____-__-__"),
            DetailRow("Annual Rent", "الإيجار السنوي", "____________"),
            DetailRow("Security Deposit", "التأمين", "____________"),
            DetailRow("Recurrence", "التكرار", "_______________"),
        ],
        approvals=[
            ApprovalStage(stage_en="Created", stage_ar="إنشاء السجل", actor="________", at="________", note="________"),
            ApprovalStage(stage_en="Approved", stage_ar="اعتماد", actor="________", at="________", note="________"),
        ],
        extra=[
            ExtraSection(title_en="Payment Schedule", title_ar="جدول الدفعات", body="_" * 80),
            ExtraSection(title_en="Notice", title_ar="إشعار", body="_" * 80),
        ],
        status_label="DRAFT",
    )
    return render_request_pdf(doc)


def _render_letter(title_en: str, title_ar: str, body_lines_en: list[str], body_lines_ar: list[str]) -> bytes:
    register_fonts()
    regular, bold = font_pair()
    buffer = io.BytesIO()
    width, height = A4
    pdf = pdf_canvas.Canvas(buffer, pagesize=A4)
    pdf.setTitle(title_en)

    pdf.setFillColorRGB(*PALETTE_RGB["soft_orange"])
    pdf.roundRect(24, 24, width - 48, height - 48, 20, fill=1, stroke=0)
    pdf.setFillColorRGB(*PALETTE_RGB["primary_orange"])
    pdf.roundRect(24, height - 110, width - 48, 80, 18, fill=1, stroke=0)

    logo = get_logo_path()
    if logo:
        try:
            pdf.drawImage(
                ImageReader(logo),
                38,
                height - 96,
                width=56,
                height=44,
                preserveAspectRatio=True,
                mask="auto",
            )
        except Exception:
            pass

    pdf.setFillColorRGB(1, 1, 1)
    pdf.setFont(bold, 16)
    pdf.drawString(108, height - 62, title_en)
    pdf.setFont(bold, 14)
    pdf.drawRightString(width - 36, height - 62, shape_ar(title_ar))
    pdf.setFont(regular, 10)
    pdf.drawString(108, height - 82, "Date: ______________________")
    pdf.drawRightString(width - 36, height - 82, shape_ar("التاريخ: ______________________"))

    pdf.setFillColorRGB(1, 1, 1)
    pdf.roundRect(36, 140, width - 72, height - 270, 14, fill=1, stroke=0)
    pdf.setStrokeColorRGB(*PALETTE_RGB["border_orange"])
    pdf.setLineWidth(0.8)
    pdf.roundRect(36, 140, width - 72, height - 270, 14, fill=0, stroke=1)

    # Left accent ribbon on body card
    pdf.setFillColorRGB(*PALETTE_RGB["primary_orange"])
    pdf.rect(36, 140, 4, height - 270, fill=1, stroke=0)

    pdf.setFillColorRGB(*PALETTE_RGB["dark_text"])
    pdf.setFont(regular, 11)
    y = height - 150
    for line in body_lines_en:
        for chunk in simpleSplit(line, regular, 11, width - 120):
            pdf.drawString(52, y, chunk)
            y -= 16
        y -= 4

    pdf.setFont(regular, 11)
    y_ar = height - 150
    for line in body_lines_ar:
        for chunk in simpleSplit(shape_ar(line), regular, 11, width - 120):
            pdf.drawRightString(width - 52, y_ar, chunk)
            y_ar -= 16
        y_ar -= 4

    pdf.setFillColorRGB(*PALETTE_RGB["muted_text"])
    pdf.setFont(regular, 10)
    pdf.drawString(52, 110, "Signed by: ______________________")
    pdf.drawString(52, 92, "Title: __________________________")
    pdf.drawString(52, 74, "Signature: ______________________")
    pdf.drawRightString(width - 52, 110, shape_ar("وقّع من قبل: ______________________"))
    pdf.drawRightString(width - 52, 92, shape_ar("المسمى الوظيفي: ______________________"))
    pdf.drawRightString(width - 52, 74, shape_ar("التوقيع: ______________________"))

    pdf.setFillColorRGB(*PALETTE_RGB["primary_orange"])
    pdf.rect(36, 56, width - 72, 2, fill=1, stroke=0)
    pdf.setFillColorRGB(*PALETTE_RGB["muted_text"])
    pdf.setFont(regular, 8)
    pdf.drawString(36, 40, "FFI HR System")
    pdf.drawRightString(width - 36, 40, "Template")

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _render_employment_certificate() -> bytes:
    return _render_letter(
        "Employment Certificate",
        "شهادة توظيف",
        [
            "To Whom It May Concern,",
            "",
            "This is to certify that Mr./Ms. ______________________ has been",
            "employed with FFI as a ______________________ since ____-__-__.",
            "",
            "He/She is currently employed on a ______________________ contract.",
            "",
            "This certificate is issued upon the employee's request.",
        ],
        [
            "إلى من يهمه الأمر،",
            "",
            "نشهد بأن السيد/السيدة ______________________ يعمل/تعمل",
            "لدى شركتنا بوظيفة ______________________ منذ ____-__-__.",
            "",
            "وهو/وهي حالياً على عقد ______________________.",
            "",
            "وقد أعطيت هذه الشهادة بناءً على طلبه/طلبها.",
        ],
    )


def _render_salary_certificate() -> bytes:
    return _render_letter(
        "Salary Certificate",
        "شهادة راتب",
        [
            "To Whom It May Concern,",
            "",
            "This is to certify that Mr./Ms. ______________________ is",
            "employed with FFI as a ______________________ since ____-__-__,",
            "with a monthly gross salary of ______________________.",
            "",
            "This certificate is issued upon the employee's request.",
        ],
        [
            "إلى من يهمه الأمر،",
            "",
            "نشهد بأن السيد/السيدة ______________________ يعمل/تعمل",
            "لدى شركتنا بوظيفة ______________________ منذ ____-__-__،",
            "براتب شهري إجمالي قدره ______________________.",
            "",
            "وقد أعطيت هذه الشهادة بناءً على طلبه/طلبها.",
        ],
    )


def _render_termination_letter() -> bytes:
    return _render_letter(
        "Termination Letter",
        "خطاب إنهاء خدمة",
        [
            "Dear ______________________,",
            "",
            "We regret to inform you that your employment with FFI will be",
            "terminated effective ____-__-__, for the following reason:",
            "",
            "______________________________________________________________",
            "",
            "Please coordinate with HR for final settlement procedures.",
        ],
        [
            "السيد/السيدة ______________________،",
            "",
            "نأسف لإبلاغكم بأن علاقة عملكم بشركتنا ستنتهي اعتباراً من",
            "____-__-__، وذلك للسبب التالي:",
            "",
            "______________________________________________________________",
            "",
            "يرجى التنسيق مع إدارة الموارد البشرية لإجراءات التسوية النهائية.",
        ],
    )


# Leave request blank has an existing Arabic overlay template in the repo — keep
# a direct copy of it if available so HR can continue to print the official
# Ministry-style form. Otherwise, fall back to the unified rendering.
def _copy_leave_overlay_if_present(dest: str) -> bool:
    candidates = [
        os.path.join(str(settings.BASE_DIR), "static", "pdf_templates", "_source", "طلب إجازة.pdf"),
        os.path.join(str(settings.BASE_DIR), "static", "طلب إجازة.pdf"),
        os.path.join(str(settings.BASE_DIR.parent), "طلب إجازة.pdf"),
    ]
    for path in candidates:
        if os.path.exists(path):
            shutil.copy(path, dest)
            return True
    return False


TEMPLATE_WRITERS = {
    "leave_request_blank.pdf": _render_leave_blank,
    "loan_request_blank.pdf": _render_loan_blank,
    "asset_damage_report_blank.pdf": _render_damage_blank,
    "asset_return_request_blank.pdf": _render_return_blank,
    "rent_agreement_blank.pdf": _render_rent_blank,
    "employment_certificate_blank.pdf": _render_employment_certificate,
    "salary_certificate_blank.pdf": _render_salary_certificate,
    "termination_letter_blank.pdf": _render_termination_letter,
}


class Command(BaseCommand):
    help = "Regenerate blank PDF templates under Backend/static/pdf_templates/"

    def handle(self, *args, **options):
        os.makedirs(TEMPLATES_DIR, exist_ok=True)
        for filename, writer in TEMPLATE_WRITERS.items():
            dest = os.path.join(TEMPLATES_DIR, filename)
            if filename == "leave_request_blank.pdf" and _copy_leave_overlay_if_present(dest):
                self.stdout.write(self.style.SUCCESS(f"Copied overlay template -> {dest}"))
                continue
            pdf_bytes = writer()
            with open(dest, "wb") as handle:
                handle.write(pdf_bytes)
            self.stdout.write(self.style.SUCCESS(f"Wrote {len(pdf_bytes)} bytes -> {dest}"))
        self.stdout.write(self.style.SUCCESS("All blank templates regenerated."))
