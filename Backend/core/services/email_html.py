"""Safe boundaries for values inserted into trusted email markup."""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from django.utils.html import format_html


def safe_email_url(value: str | None) -> str:
    """Keep valid HTTP(S) URLs; omit unsafe schemes, controls and malformed URLs.

    URL validation does not escape HTML: callers must still escape attributes.
    """
    if not isinstance(value, str) or not value or "\\" in value:
        return ""
    if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value):
        return ""
    try:
        URLValidator(schemes=["http", "https"])(value)
    except ValidationError:
        return ""
    return value


def email_button(url: str | None, label: str) -> str:
    url = safe_email_url(url)
    if not url:
        return ""
    return format_html(
        '<a href="{}" style="display:inline-block;margin:6px 8px 0 0;padding:9px 16px;'
        "border-radius:4px;background-color:#1c1f24;color:#ffffff;text-decoration:none;"
        'font-weight:600;font-size:13px;">{}</a>',
        url,
        label,
    )


def email_action_url(value: str | None) -> str:
    """Resolve application paths against the configured frontend before validation."""
    if isinstance(value, str) and value.startswith("/") and not value.startswith("//"):
        value = f"{getattr(settings, 'FRONTEND_URL', '').rstrip('/')}{value}"
    return safe_email_url(value)
