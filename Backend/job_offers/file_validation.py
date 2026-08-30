from __future__ import annotations

from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from django.conf import settings
from rest_framework import serializers

ALLOWED_CV_EXTENSIONS = {".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"}
ALLOWED_CV_MIME_TYPES = {
    ".pdf": {"application/pdf"},
    ".doc": {"application/msword"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
}


def _matches_signature(extension: str, content: bytes) -> bool:
    if extension == ".pdf":
        return content.startswith(b"%PDF-")
    if extension == ".doc":
        return content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
    if extension in {".jpg", ".jpeg"}:
        return content.startswith(b"\xff\xd8\xff")
    if extension == ".png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if extension == ".docx":
        if not content.startswith(b"PK"):
            return False
        try:
            with ZipFile(BytesIO(content)) as archive:
                names = set(archive.namelist())
        except (BadZipFile, OSError):
            return False
        return "[Content_Types].xml" in names and any(name.startswith("word/") for name in names)
    return False


def validate_job_offer_cv(upload):
    extension = Path(upload.name or "").suffix.lower()
    if extension not in ALLOWED_CV_EXTENSIONS:
        raise serializers.ValidationError("CV must be a PDF, DOC, DOCX, JPG, or PNG file.")

    limit = int(getattr(settings, "MAX_JOB_OFFER_CV_SIZE_BYTES", 5 * 1024 * 1024))
    if upload.size > limit:
        raise serializers.ValidationError(f"CV file size must not exceed {limit} bytes.")

    claimed_mime = (getattr(upload, "content_type", "") or "").lower().split(";", 1)[0].strip()
    if claimed_mime not in ALLOWED_CV_MIME_TYPES[extension]:
        raise serializers.ValidationError("CV content type does not match its file extension.")

    position = upload.tell() if hasattr(upload, "tell") else 0
    content = upload.read()
    upload.seek(position)
    if not _matches_signature(extension, content):
        raise serializers.ValidationError("CV file content does not match its declared type.")
    return upload
