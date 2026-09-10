"""WhatsApp-specific announcement formatting and private attachment loading."""

import base64
import os


def build_announcement_message(*, employee_name: str, title: str, content: str, has_attachment: bool = False) -> str:
    """Build a readable bilingual announcement without exposing attachment URLs."""
    attachment_ar = "📎 تم إرفاق ملف PDF بهذه الرسالة." if has_attachment else ""
    attachment_en = "📎 The PDF file is attached to this message." if has_attachment else ""
    content = (content or "").strip()
    return "\n".join(
        line
        for line in (
            f"مرحباً {employee_name}،",
            "إعلان من نظام الموارد البشرية FFI",
            f"العنوان: {title}",
            "",
            content,
            attachment_ar,
            "",
            "---",
            f"Hello {employee_name},",
            "FFI HR announcement",
            f"Title: {title}",
            "",
            content,
            attachment_en,
        )
        if line is not None
    )


def load_announcement_attachment(announcement) -> dict | None:
    """Read an announcement PDF from private storage for direct provider upload."""
    if not announcement.attachment:
        return None

    try:
        announcement.attachment.open("rb")
        try:
            content = announcement.attachment.read()
        finally:
            announcement.attachment.close()
    except (FileNotFoundError, OSError):
        return None

    return {
        "file_name": os.path.basename(announcement.attachment.name) or "announcement.pdf",
        "document_base64": base64.b64encode(content).decode("ascii"),
    }
