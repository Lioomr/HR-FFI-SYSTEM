from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from core.services.bird_email_service import BirdEmailService


class BirdEmailServiceTests(SimpleTestCase):
    @override_settings(
        BIRD_API_KEY="test-key",
        BIRD_CHANNEL_ID="test-channel",
        BIRD_WORKSPACE_ID="test-workspace",
        EMAIL_LOGO_URL="https://mail.fficontracting.com/logo.png",
    )
    @patch("core.services.bird_email_service.requests.post")
    @patch.object(BirdEmailService, "render_template")
    def test_retries_with_remote_logo_when_inline_payload_too_large(self, render_template, mock_post):
        render_template.side_effect = [
            "<html><img src='data:image/png;base64,AAAA' /></html>",
            "<html><img src='https://mail.fficontracting.com/logo.png' /></html>",
        ]

        first_response = MagicMock()
        first_response.status_code = 413
        first_response.json.return_value = {"message": "Request Entity Too Large"}
        first_response.text = "Request Entity Too Large"

        second_response = MagicMock()
        second_response.status_code = 202
        second_response.json.return_value = {"id": "msg_123"}
        second_response.text = ""

        mock_post.side_effect = [first_response, second_response]

        service = BirdEmailService()
        result = service.send_template_email(
            to_email="employee@example.com",
            subject="Invitation",
            template_name="invite_user.html",
            context={
                "logo_url": "data:image/png;base64,AAAA",
                "title": "Invitation",
                "message": "Join us",
            },
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["status_code"], 202)
        self.assertEqual(mock_post.call_count, 2)

