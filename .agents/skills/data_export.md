# Data Export Skill

Use when adding CSV, XLSX, or PDF export to any list endpoint.

## Backend Pattern

The project uses centralized export helpers in `Backend/core/exporting.py`. Check these helpers before implementing from scratch.

Existing exports:
- Audit logs: `AuditLogsExportView` — CSV/XLSX with filters
- Employee list: XLSX export
- Payroll runs: CSV/XLSX/PDF via `PayrollViewSet`
- Leave balances: export endpoint on HRManager routes

## Request PDF Exports

For leave and loan request PDFs, the current source of truth is the HR blank template library. Read `.agents/context/pdf_template_library.md` before changing these exports.

Leave and loan PDFs must resolve their blank form through `core.views_templates.resolve_template_path(...)`, prefer `/hr/templates`, overlay values onto the blank PDF with ReportLab + pypdf, and keep the generic `Backend/core/pdf.py::render_request_pdf()` path only as a fallback if the template is missing.

For other request-style PDFs (asset damage, asset return, rents), check the current renderer before changing behavior. If converting them to template-library overlays, follow the leave/loan pattern and add visual/sample verification.

### Checklist

- [ ] Use helpers from `core/exporting.py` where they fit.
- [ ] Export endpoint requires the same permissions as the list endpoint.
- [ ] Company scope filtering applied — never export across company boundaries.
- [ ] Support `format` query param: `?format=csv` or `?format=xlsx`.
- [ ] Apply the same filters available on the list endpoint (date range, status, etc.).
- [ ] Return correct `Content-Disposition` header for file download.
- [ ] Add `AuditLog` entry for payroll/payslip exports (sensitive financial data).
- [ ] For large datasets, consider streaming response or background task with download link.

### Example View Pattern

```python
class MyExportView(APIView):
    permission_classes = [IsHRManagerOrAdmin]

    def get(self, request):
        company = get_active_organization_for_request(request)
        qs = MyModel.objects.filter(company=company)
        # apply filters from request.query_params
        export_format = request.query_params.get("format", "xlsx")
        # use core/exporting.py helpers
        return export_response(qs, format=export_format, filename="my_export")
```

## Frontend Pattern

- Add an Export button to the list page toolbar (Ant Design `Button` with download icon).
- Call the export endpoint with current active filters applied.
- Use `downloads.ts` service (`FrontEnd/src/services/api/downloads.ts`) for file download handling.
- Show a loading state on the button while downloading.
- Handle export errors with a page-level notification.

### Example Service Call

```typescript
import { downloadFile } from '../services/api/downloads';

const handleExport = async () => {
  setExporting(true);
  try {
    await downloadFile('/my-resource/export/', { format: 'xlsx', ...activeFilters });
  } catch {
    // show error notification
  } finally {
    setExporting(false);
  }
};
```
