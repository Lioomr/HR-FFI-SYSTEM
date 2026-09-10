from html.parser import HTMLParser
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.template.loader import render_to_string
from django.test import override_settings

from core.services.bird_email_service import send_generic_notification_email, send_meeting_notification_email
from core.services.email_html import email_button, safe_email_url
from in_app_notifications.dispatcher import _send_email
from job_offers.notifications import _link


class Links(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.hrefs = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.hrefs.append(dict(attrs).get("href", ""))


@pytest.mark.parametrize("field", ["google_meet_url", "microsoft_teams_url", "zoom_url", "action_url"])
@pytest.mark.parametrize(
    "value",
    [
        "https://meet.example.com/a?q=\"><strong>INJECTED</strong>&x='quote'",
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "https://",
        "https://[invalid",
        "//meet.example.com/a",
        "https://meet.example.com/\nunsafe",
        "https:\\evil.example.com",
        "https://meet.example.com/a?x=1&y=2",
    ],
)
def test_meeting_links_are_safe_in_rendered_html(field, value):
    markup = "<strong>INJECTED</strong>\"'"
    with patch("core.services.bird_email_service.BirdEmailService.send_template_email") as send:
        send_meeting_notification_email(
            to_email="security@example.com",
            employee_name=markup,
            meeting_title=markup,
            meeting_message=markup,
            meeting_date=markup,
            meeting_time=markup,
            organizer_name=markup,
            location=markup,
            agenda=markup,
            **{field: value},
        )
    context = send.call_args.kwargs["context"]
    html = render_to_string("emails/generic_notification.html", context)
    assert "<strong>INJECTED</strong>" not in html
    assert "&lt;strong&gt;INJECTED&lt;/strong&gt;" in html
    hrefs = Links(html).hrefs
    if safe_email_url(value):
        assert value in hrefs  # Attribute escaping preserves the original safe URL.
    else:
        assert value not in hrefs
        assert not context["action_url"]


@pytest.mark.parametrize("builder", [email_button, _link])
def test_email_button_escapes_labels_and_rejects_unsafe_schemes(builder):
    assert builder("javascript:alert(1)", "Open") == ""
    html = builder('https://example.com/a?x="quoted"&b=1', '<img src=x onerror="alert(1)">')
    assert "<img" not in html
    assert Links(html).hrefs == ['https://example.com/a?x="quoted"&b=1']


def test_generic_email_escapes_user_controlled_values_and_filters_action_url():
    markup = '<img src=x onerror="alert(1)">'
    with patch("core.services.bird_email_service.BirdEmailService.send_template_email") as send:
        send_generic_notification_email(
            to_email="security@example.com",
            subject="Test",
            title=markup,
            title_ar=markup,
            employee_name=markup,
            message=markup,
            message_ar=markup,
            action_url="javascript:alert(1)",
            rows=[{"label": markup, "label_ar": markup, "value": markup}],
        )
    html = render_to_string("emails/generic_notification.html", send.call_args.kwargs["context"])
    assert markup not in html
    assert "javascript:alert(1)" not in Links(html).hrefs


@pytest.mark.parametrize("template", ["", "emails/generic_notification.html"])
@pytest.mark.parametrize("url", ["javascript:alert(1)", "/hr/contract-decisions/1"])
@override_settings(FRONTEND_URL="https://hr.example.com")
def test_dispatcher_escapes_content_and_retains_safe_application_links(template, url):
    markup = '<strong>INJECTED</strong>"'
    with patch("in_app_notifications.dispatcher.EmailService.send_html_email") as send:
        _send_email(
            recipient=SimpleNamespace(email="security@example.com", full_name=markup),
            title=markup,
            message=markup,
            action_url=url,
            template=template,
            context={"action_url": url},
            timeout=1,
        )
    html = send.call_args.kwargs["html_content"]
    assert "<strong>INJECTED</strong>" not in html
    assert "javascript:alert(1)" not in Links(html).hrefs
    if url.startswith("/"):
        assert f"https://hr.example.com{url}" in Links(html).hrefs
