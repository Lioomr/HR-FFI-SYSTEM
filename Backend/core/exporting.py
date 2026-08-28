import csv
import io
import re

import openpyxl
from django.http import HttpResponse

from audit.utils import audit


def csv_response(*, rows, headers, filename: str) -> HttpResponse:
    response = HttpResponse(content_type="application/octet-stream")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    writer = csv.writer(response)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    return response


def xlsx_response(*, rows, headers, filename: str, sheet_name: str = "Export") -> HttpResponse:
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = sheet_name[:31] or "Export"
    worksheet.append(headers)
    for row in rows:
        worksheet.append(list(row))

    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)

    response = HttpResponse(
        output.getvalue(),
        content_type="application/octet-stream",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response


def audit_export(request, *, entity: str, entity_id=None, export_format: str, metadata: dict | None = None) -> None:
    action_entity = re.sub(r"(?<!^)(?=[A-Z])", "_", entity).lower()
    audit(
        request,
        f"{action_entity}_exported_{export_format}",
        entity=entity,
        entity_id=entity_id,
        metadata=metadata or {},
    )
