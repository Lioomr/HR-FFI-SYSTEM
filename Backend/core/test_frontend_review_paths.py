from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from django.utils import timezone

from core.services.workflow_engine import _build_action_url_path
from leaves.tasks import send_annual_leave_year_end_notifications


class FrontendReviewPathsTests(SimpleTestCase):
    def test_review_queues_match_current_frontend_surfaces(self):
        for workflow, role, expected in [
            ("leave_request", "ceo", "/ceo/leave/requests"),
            ("attendance_request", "manager", "/manager/attendance"),
            ("attendance_correction_request", "manager", "/manager/attendance"),
        ]:
            with self.subTest(workflow=workflow):
                self.assertEqual(_build_action_url_path(workflow, role, 123), expected)

    def test_year_end_reminder_links_to_hr_employee_route(self):
        today = timezone.localdate()
        profile = SimpleNamespace(id=123, company=object(), full_name="Test Employee")
        profiles = MagicMock()
        profiles.select_related.return_value = [profile]
        with (
            patch("leaves.tasks.EmployeeProfile.objects.filter", return_value=profiles),
            patch("leaves.tasks._hr_users_for_company", return_value=[object()]),
            patch(
                "leaves.tasks.get_contract_year_cycle",
                side_effect=[(today - timedelta(days=360), today + timedelta(days=5)), (None, None)],
            ),
            patch("leaves.tasks.notification_text", return_value={}),
            patch("leaves.tasks.profile_name", return_value="Test Employee"),
            patch("leaves.tasks.dispatch_notification_channels") as dispatch,
        ):
            send_annual_leave_year_end_notifications()
        self.assertEqual(dispatch.call_args.kwargs["action_url"], "/hr/employees/123")
