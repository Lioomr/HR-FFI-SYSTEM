from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from core.services.pending_approval_email import send_pending_approval_email
from leaves.models import LeaveRequest
from leaves.services import notify_after_ceo_approval


class HRCompletionNotificationTests(SimpleTestCase):
    @staticmethod
    def _leave(*, visa_required):
        return SimpleNamespace(
            id=42,
            status=LeaveRequest.RequestStatus.PENDING_HR_COMPLETION,
            employee=SimpleNamespace(full_name="Sara Ali", email="sara@example.com"),
            employee_profile=SimpleNamespace(full_name="Sara Ali"),
            leave_type=SimpleNamespace(name="Annual Leave"),
            requires_visa_upload=lambda: visa_required,
        )

    def test_hr_receives_completion_stage_and_visa_requirement(self):
        for required, expected_detail in ((True, "Visa PDF: Required"), (False, "Visa PDF: Not required")):
            with self.subTest(visa_required=required):
                with (
                    patch("leaves.services.get_hr_approver_users", return_value=["hr-user"]),
                    patch("leaves.services.notify_users_for_pending_status") as notify,
                ):
                    notify_after_ceo_approval(self._leave(visa_required=required))

                kwargs = notify.call_args.kwargs
                self.assertEqual(kwargs["users"], ["hr-user"])
                self.assertEqual(kwargs["status_label"], LeaveRequest.RequestStatus.PENDING_HR_COMPLETION)
                self.assertEqual(kwargs["action_path"], "/hr/leave/requests/42")
                self.assertIn(expected_detail, kwargs["details"])

    @override_settings(FRONTEND_URL="https://hr.example.test")
    @patch("core.services.pending_approval_email._resolve_logo_source", return_value="")
    @patch("core.services.pending_approval_email.render_to_string", return_value="<html />")
    @patch("core.services.pending_approval_email.EmailService")
    def test_completion_email_has_specific_subject_body_status_and_button(self, email_service, render, _logo):
        send_pending_approval_email(
            to_email="hr@example.com",
            approver_name="HR",
            request_type="Leave Request",
            request_id=42,
            requester_name="Sara Ali",
            status_label="pending_hr_completion",
            details=["Visa PDF: Required"],
            action_path="/hr/leave/requests/42",
        )

        context = render.call_args.args[1]
        sent = email_service.return_value.send_html_email.call_args.kwargs
        self.assertEqual(sent["subject"], "Leave request awaiting HR completion - #42")
        self.assertIn("visa PDF", context["message"])
        self.assertEqual(context["status_label"], "Pending HR Completion")
        self.assertEqual(context["action_text"], "Complete HR Review")
        self.assertEqual(context["action_url"], "https://hr.example.test/hr/leave/requests/42")
        self.assertIn("Visa PDF: Required", sent["fallback_text"])

    @patch("core.services.pending_approval_email._resolve_logo_source", return_value="")
    @patch("core.services.pending_approval_email.render_to_string", return_value="<html />")
    @patch("core.services.pending_approval_email.EmailService")
    def test_ordinary_leave_approval_email_keeps_existing_labels(self, email_service, render, _logo):
        send_pending_approval_email(
            to_email="hr@example.com",
            approver_name="HR",
            request_type="Leave Request",
            request_id=43,
            requester_name="Sara Ali",
            status_label="pending_hr",
        )

        context = render.call_args.args[1]
        sent = email_service.return_value.send_html_email.call_args.kwargs
        self.assertEqual(sent["subject"], "Leave Request pending approval - #43")
        self.assertEqual(context["status_label"], "Action required")
        self.assertEqual(context["action_text"], "Review Request")
