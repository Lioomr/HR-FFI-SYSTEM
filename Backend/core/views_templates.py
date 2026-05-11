"""HR Template Library - serves blank PDF templates to HR staff."""

from __future__ import annotations

import os
from datetime import datetime

from django.conf import settings
from django.http import FileResponse, HttpResponse, Http404
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from audit.utils import audit
from core.pdf import encrypt_pdf
from core.responses import error, success
from employees.permissions import IsHRManagerOrAdmin


SENSITIVE_TEMPLATE_KEYS = {"salary_certificate", "termination_letter", "employment_certificate"}


TEMPLATES_DIR = os.path.join(str(settings.BASE_DIR), "static", "pdf_templates")


def _get_templates_dir() -> str:
    # Primary writable/readable directory. Deployments can mount this outside the image.
    # Example: HR_TEMPLATES_DIR=/hr/templates
    configured = getattr(settings, "HR_TEMPLATES_DIR", "") or os.environ.get("HR_TEMPLATES_DIR", "")
    return configured.strip() or TEMPLATES_DIR


def get_template_search_dirs() -> list[str]:
    """Return template directories in precedence order, skipping duplicates."""

    dirs = [_get_templates_dir(), TEMPLATES_DIR]
    seen = set()
    result = []
    for directory in dirs:
        normalized = os.path.abspath(directory)
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(directory)
    return result


def resolve_template_path(filename: str, aliases: list[str] | None = None) -> str:
    """Find a template in the configured HR library, then bundled defaults."""

    names = [filename, *(aliases or [])]
    for directory in get_template_search_dirs():
        for name in names:
            path = os.path.join(directory, name)
            if os.path.exists(path):
                return path
    return ""


TEMPLATE_CATALOG = [
    {
        "key": "leave_request",
        "category": "request",
        "filename": "leave_request_blank.pdf",
        "title_en": "Leave Request",
        "title_ar": "طلب إجازة",
        "description_en": "Blank bilingual leave request form to fill and sign.",
        "description_ar": "نموذج طلب إجازة فارغ للتعبئة والتوقيع.",
    },
    {
        "key": "loan_request",
        "category": "request",
        "filename": "loan_request_blank.pdf",
        "title_en": "Loan Request",
        "title_ar": "طلب سلفة",
        "description_en": "Blank loan request form including approval chain signatures.",
        "description_ar": "نموذج طلب سلفة فارغ مع مسار الموافقة والتوقيعات.",
    },
    {
        "key": "asset_damage_report",
        "category": "request",
        "filename": "asset_damage_report_blank.pdf",
        "title_en": "Asset Damage Report",
        "title_ar": "تقرير ضرر أصل",
        "description_en": "Blank damage report form for assigned assets.",
        "description_ar": "نموذج تقرير ضرر فارغ للأصول المخصصة.",
    },
    {
        "key": "asset_return_request",
        "category": "request",
        "filename": "asset_return_request_blank.pdf",
        "title_en": "Asset Return Request",
        "title_ar": "طلب إعادة أصل",
        "description_en": "Blank asset return request form.",
        "description_ar": "نموذج طلب إعادة أصل فارغ.",
    },
    {
        "key": "rent_agreement",
        "category": "request",
        "filename": "rent_agreement_blank.pdf",
        "title_en": "Rent Agreement",
        "title_ar": "اتفاقية إيجار",
        "description_en": "Blank rent/lease agreement template.",
        "description_ar": "نموذج اتفاقية إيجار فارغ.",
    },
    {
        "key": "employment_certificate",
        "category": "letter",
        "filename": "employment_certificate_blank.pdf",
        "title_en": "Employment Certificate",
        "title_ar": "شهادة توظيف",
        "description_en": "Blank employment certificate letter.",
        "description_ar": "نموذج شهادة توظيف فارغ.",
    },
    {
        "key": "salary_certificate",
        "category": "letter",
        "filename": "salary_certificate_blank.pdf",
        "title_en": "Salary Certificate",
        "title_ar": "شهادة راتب",
        "description_en": "Blank salary certificate letter.",
        "description_ar": "نموذج شهادة راتب فارغ.",
    },
    {
        "key": "termination_letter",
        "category": "letter",
        "filename": "termination_letter_blank.pdf",
        "title_en": "Termination Letter",
        "title_ar": "خطاب إنهاء خدمة",
        "description_en": "Blank termination letter template.",
        "description_ar": "نموذج خطاب إنهاء خدمة فارغ.",
    },
]


def _templates_by_key() -> dict:
    return {entry["key"]: entry for entry in TEMPLATE_CATALOG}


def _template_file_path(template: dict) -> str:
    return resolve_template_path(template["filename"]) or os.path.join(_get_templates_dir(), template["filename"])


def _template_updated_at(path: str) -> str | None:
    try:
        ts = os.path.getmtime(path)
    except OSError:
        return None
    return datetime.fromtimestamp(ts).isoformat(timespec="seconds")


class TemplateListView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        items = []
        for entry in TEMPLATE_CATALOG:
            path = _template_file_path(entry)
            items.append(
                {
                    "key": entry["key"],
                    "category": entry["category"],
                    "filename": entry["filename"],
                    "title_en": entry["title_en"],
                    "title_ar": entry["title_ar"],
                    "description_en": entry["description_en"],
                    "description_ar": entry["description_ar"],
                    "available": os.path.exists(path),
                    "updated_at": _template_updated_at(path),
                }
            )
        return success({"items": items, "count": len(items)})


class TemplateDownloadView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request, key: str):
        template = _templates_by_key().get(key)
        if not template:
            return error("Not found", errors=["Unknown template."], status=404)
        path = _template_file_path(template)
        if not os.path.exists(path):
            return error(
                "Not available",
                errors=["Template file is missing. Run generate_blank_templates."],
                status=404,
            )
        password = request.query_params.get("password", "").strip()
        encrypted = False
        if password and template["key"] in SENSITIVE_TEMPLATE_KEYS:
            with open(path, "rb") as fh:
                pdf_bytes = encrypt_pdf(fh.read(), user_password=password)
            encrypted = True
        audit(
            request,
            "template_downloaded",
            entity="Template",
            entity_id=0,
            metadata={"template_key": key, "encrypted": encrypted},
        )
        if encrypted:
            response = HttpResponse(pdf_bytes, content_type="application/pdf")
            response["Content-Disposition"] = f'attachment; filename="{template["filename"]}"'
            return response
        return FileResponse(
            open(path, "rb"),
            content_type="application/pdf",
            as_attachment=True,
            filename=template["filename"],
        )
