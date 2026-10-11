"""Independent verification of an uploaded PDF (HR / SystemAdmin only)."""

from __future__ import annotations

from django.conf import settings
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from core.responses import error, success
from employees.permissions import IsHRManagerOrAdmin

from .services import verify_uploaded_pdf

PDF_MAGIC = b"%PDF-"


class DocumentVerifyUploadView(APIView):
    """``POST /api/documents/verify-upload/`` with multipart field ``file``.

    The upload is hashed and validated in memory and never stored. A matching
    record is only named when the caller can access that record's company.
    """

    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return error("Validation error", errors=[{"field": "file", "message": "file is required."}], status=422)
        limit = int(getattr(settings, "MAX_DOCUMENT_VERIFY_UPLOAD_BYTES", 20 * 1024 * 1024))
        if upload.size > limit:
            return error(
                "Validation error",
                errors=[{"field": "file", "message": "File size exceeds maximum limit."}],
                status=422,
            )
        data = upload.read()
        if not data.startswith(PDF_MAGIC):
            return error(
                "Validation error", errors=[{"field": "file", "message": "Only PDF files can be verified."}], status=422
            )
        return success(verify_uploaded_pdf(data, request=request))
