"""Small shared helpers for Django file-field reads."""

from __future__ import annotations


def read_field_file_bytes(field_file, *, suffix: str | None = None) -> bytes | None:
    """Return a FileField/ImageField's content as bytes, or ``None`` on failure.

    When ``suffix`` is given, only files whose stored name ends with it
    (case-insensitive) are read; anything else returns ``None``.
    """
    if not field_file:
        return None
    if suffix is not None:
        name = str(getattr(field_file, "name", "") or "").lower()
        if not name.endswith(suffix.lower()):
            return None
    try:
        field_file.open("rb")
        try:
            return field_file.read()
        finally:
            field_file.close()
    except Exception:
        return None
