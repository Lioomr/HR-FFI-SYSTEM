"""Notifications to an employee's manager from another company land where that manager can open them."""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from employees.models import EmployeeProfile
from employees.services.manager_relationships import set_employee_manager
from leaves.models import LeaveRequest, LeaveType
from leaves.notifications import notify_leave_submitted
from organization.models import OrganizationNode, UserOrganizationAccess

from .models import Notification
from .services import notification_company_for_recipient, notification_company_id_for_recipient

User = get_user_model()
IN_MEMORY_CHANNELS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


@override_settings(CHANNEL_LAYERS=IN_MEMORY_CHANNELS)
class CrossCompanyManagerNotificationTests(TestCase):
    def setUp(self):
        self.company_a = OrganizationNode.objects.create(
            code="NOTE_A", name="Note A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.company_b = OrganizationNode.objects.create(
            code="NOTE_B", name="Note B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.employee = self._user("employee@note.test", self.company_a, "NOTE-EMP")
        self.manager = self._user("manager@note.test", self.company_b, "NOTE-MGR")
        self.hr = self._user("hr@note.test", self.company_b, "NOTE-HR")
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company_a)
        set_employee_manager(self.employee.employee_profile, self.manager.employee_profile)

    def _user(self, email, company, employee_id):
        user = User.objects.create_user(email=email, password="StrongPass123!", full_name=employee_id)
        EmployeeProfile.objects.create(user=user, company=company, employee_id=employee_id, full_name=employee_id)
        UserOrganizationAccess.objects.create(user=user, organization=company)
        return user

    def test_company_is_kept_for_recipients_who_can_open_it(self):
        self.assertEqual(notification_company_for_recipient(self.hr, self.company_a), self.company_a)
        self.assertEqual(notification_company_for_recipient(self.employee, self.company_a), self.company_a)
        self.assertEqual(notification_company_id_for_recipient(self.hr, self.company_a.id), self.company_a.id)

    def test_a_manager_from_another_company_gets_their_own_company(self):
        self.assertEqual(notification_company_for_recipient(self.manager, self.company_a), self.company_b)
        self.assertEqual(notification_company_id_for_recipient(self.manager, self.company_a.id), self.company_b.id)

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    @patch("in_app_notifications.tasks.deliver_email_notification.delay")
    def test_leave_submission_reaches_the_managers_own_bell(self, _email, _whatsapp):
        leave_type = LeaveType.objects.create(company=self.company_a, name="Note Annual", code="NOTE_ANNUAL")
        leave_request = LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company_a,
            leave_type=leave_type,
            start_date=timezone.localdate() + timedelta(days=1),
            end_date=timezone.localdate() + timedelta(days=2),
        )

        notify_leave_submitted(leave_request)

        notification = Notification.objects.get(recipient=self.manager, event_key="leave.submitted")
        self.assertEqual(notification.company_id, self.company_b.id)
        self.assertEqual(
            notification.action_url, f"/manager/leave/requests/{leave_request.id}?company={self.company_b.id}"
        )
