"""WhatsApp-specific announcement formatting and private attachment loading."""

import base64
import os


def build_announcement_message(*, employee_name: str, title: str, content: str) -> str:
    """Render the configured announcement template. Attachments travel as documents, never as links."""
    from core.services.whatsapp_template_library import render_configured_template_message

    return render_configured_template_message(
        "announcement_notification_v2",
        {"employee_name": employee_name, "announcement_title": title, "announcement_message": content or ""},
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
