# File Uploads Context

All user-uploaded files go to private storage — never to a publicly accessible path.

## Storage Backend

**Class**: `PrivateUploadStorage` (`Backend/employees/storage.py`)
- Extends Django `FileSystemStorage`
- Root: `settings.PRIVATE_UPLOAD_ROOT` → `Backend/private_uploads/`
- Files are **not** served via static URL — they require authenticated download views

## Upload Paths Per Domain

| Domain | Model field | `upload_to` path | Env var for size limit |
|---|---|---|---|
| Leaves | `LeaveRequest.document` | `leave_documents/` | `MAX_LEAVE_DOCUMENT_SIZE_BYTES` |
| Assets | `AssetInvoice.invoice_file` | `assets/invoices/` | `MAX_ASSET_INVOICE_SIZE_BYTES` |
| Asset labels | `PrintedLabelJob.pdf_file` | `assets/labels/` | - |
| Announcements | `Announcement.attachment` | `announcement_attachments/` | `MAX_ANNOUNCEMENT_ATTACHMENT_SIZE_BYTES` |
| Employee imports | `EmployeeImport.stored_file` | `employee_imports/` | — |
| Employee import errors | `EmployeeImport.errors_file` | `employee_imports/errors/` | — |

Default size limit for all: **5 MB** (5,242,880 bytes). Override via env vars in `Backend/.env.docker`.

## Size Validation

Enforced in serializers (not at the model level):

```python
# Pattern used across serializers
MAX_SIZE = int(getattr(settings, "MAX_LEAVE_DOCUMENT_SIZE_BYTES", 5 * 1024 * 1024))

def validate_document(self, value):
    if value.size > MAX_SIZE:
        raise serializers.ValidationError(f"File too large. Max {MAX_SIZE // (1024*1024)} MB.")
    return value
```

When adding a new file field, add size validation to the serializer using the same pattern. **Never rely on client-side size checks.**

## File Type Validation

Validated per-domain in serializers:
- Leave documents: typically PDF/images
- Asset invoices: typically PDF/images
- Announcements: generic attachments
- Employee imports: CSV/Excel only

Add explicit MIME type checks in the serializer `validate_<field>()` method for any new upload.

## Serving Private Files

Private files are **never served via direct URL**. Access is via authenticated API endpoints:
- The view checks `request.user` permissions before returning the file
- Use `FileResponse(open(file_path, 'rb'))` with appropriate `Content-Disposition` header
- File path is resolved from the model instance, never from a client-supplied path

**Never expose `PRIVATE_UPLOAD_ROOT` as a Django `STATIC_URL` or `MEDIA_URL`.**

## Rules for Adding New File Uploads

1. Use `PrivateUploadStorage` as the `storage` parameter on the `FileField`.
2. Set a domain-specific `upload_to` path (e.g., `my_domain/files/`).
3. Add an env var for the size limit and read it in `settings.py`.
4. Enforce size validation in the serializer's `validate_<field>()` method.
5. Add MIME type validation for the expected file types.
6. Add an authenticated download endpoint if the file needs to be retrieved by clients.
7. Never store file paths in a publicly guessable location.
8. Test: upload at the size limit, above the limit, and with an invalid file type.
