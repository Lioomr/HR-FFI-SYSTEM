from datetime import date, datetime

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from admin_portal.models import SystemSettings
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from organization.models import OrganizationNode

from .absence import mark_absentees_for_date
from .leave_resolution import with_leave_resolution
from .models import AttendanceRecord, BioTimeEmployeeMap
from .schedule import employee_on_leave
from .serializers import AttendanceRecordSerializer


class LeaveResolutionTests(TestCase):
    def setUp(self):
        self.day = date(2026, 1, 5)
        self.company = OrganizationNode.objects.create(
            code="RESOLVE", name="Resolve", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.user = get_user_model().objects.create_user(email="resolve@example.test")
        self.profile = EmployeeProfile.objects.create(
            user=self.user, company=self.company, employee_id="RESOLVE-1", full_name="Resolve Employee"
        )
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="RESOLVE-1")
        self.leave_type = LeaveType.objects.create(company=self.company, name="Annual", code="ANNUAL")
        self.record = AttendanceRecord.objects.create(
            employee_profile=self.profile, date=self.day, status="ABSENT", notes="Original absence evidence"
        )
        self.leave = LeaveRequest.objects.create(
            employee=self.user,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=self.day,
            end_date=self.day,
            status="pending_hr",
        )

    def resolve(self):
        return with_leave_resolution(AttendanceRecord.objects.filter(pk=self.record.pk)).get()

    def approve(self):
        self.leave.status = "approved"
        self.leave.save()

    def test_retroactive_approval_explains_absence_without_rewriting_evidence(self):
        self.assertEqual(self.resolve().effective_status, "ABSENT")
        self.approve()
        data = AttendanceRecordSerializer(self.resolve()).data
        self.assertEqual(data["effective_status"], "EXCUSED")
        self.assertEqual(data["excused_by_leave_id"], self.leave.pk)
        self.record.refresh_from_db()
        self.assertEqual(self.record.status, "ABSENT")
        self.assertEqual(self.record.notes, "Original absence evidence")
        self.assertIsNone(self.record.check_in_at)

    def test_cancellation_rejection_and_soft_deletion_remove_excuse(self):
        for status_value, active in [("cancelled", True), ("rejected", True), ("approved", False)]:
            self.approve()
            self.leave.status = status_value
            self.leave.is_active = active
            self.leave.save()
            self.assertEqual(self.resolve().effective_status, "ABSENT")
            self.assertFalse(employee_on_leave(self.profile, self.day))
            self.assertIsNone(AttendanceRecordSerializer(self.resolve()).data["excused_by_leave_id"])
            self.leave.is_active = True

    def test_date_edit_removes_excuse_and_other_approved_leave_can_still_cover(self):
        self.approve()
        other = LeaveRequest.objects.create(
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=self.day,
            end_date=self.day,
            status="approved",
        )
        self.leave.start_date = self.leave.end_date = date(2026, 1, 6)
        self.leave.save()
        self.assertEqual(self.resolve().covering_leave_id, other.pk)
        other.is_active = False
        other.save()
        self.assertEqual(self.resolve().effective_status, "ABSENT")

    def test_present_late_and_punched_absence_are_preserved(self):
        self.approve()
        for status_value in ["PRESENT", "LATE", "PENDING_HR"]:
            self.record.status = status_value
            self.record.save()
            self.assertEqual(self.resolve().effective_status, status_value)
        self.record.status = "ABSENT"
        self.record.check_in_at = timezone.make_aware(datetime(2026, 1, 5, 9))
        self.record.save()
        self.assertEqual(self.resolve().effective_status, "ABSENT")

    def test_unpaid_leave_explains_absence_without_asserting_pay_entitlement(self):
        self.leave_type.is_paid = False
        self.leave_type.save()
        self.approve()
        self.assertEqual(self.resolve().effective_status, "EXCUSED")

    def test_explicit_override_and_non_system_records_are_preserved(self):
        self.approve()
        self.record.is_overridden = True
        self.record.save()
        self.assertEqual(self.resolve().effective_status, "ABSENT")
        self.record.is_overridden = False
        self.record.source = "HR"
        self.record.save()
        self.assertEqual(self.resolve().effective_status, "ABSENT")

    def test_company_and_employee_boundaries(self):
        other_company = OrganizationNode.objects.create(
            code="OTHER-R", name="Other", node_type=OrganizationNode.NodeType.COMPANY
        )
        other_type = LeaveType.objects.create(company=other_company, name="Annual", code="ANNUAL")
        foreign_profile = EmployeeProfile.objects.create(company=other_company, employee_id="FOREIGN-R")
        LeaveRequest.objects.create(
            employee_profile=foreign_profile,
            company=other_company,
            leave_type=other_type,
            start_date=self.day,
            end_date=self.day,
            status="approved",
        )
        self.assertEqual(self.resolve().effective_status, "ABSENT")
        self.assertFalse(employee_on_leave(self.profile, self.day))
        other_profile = EmployeeProfile.objects.create(company=self.company, employee_id="OTHER-R")
        LeaveRequest.objects.create(
            employee_profile=other_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=self.day,
            end_date=self.day,
            status="approved",
        )
        self.assertEqual(self.resolve().effective_status, "ABSENT")

    def test_legacy_user_link_and_unannotated_serializer(self):
        self.approve()
        LeaveRequest.objects.filter(pk=self.leave.pk).update(employee_profile=None)
        self.assertEqual(AttendanceRecordSerializer(self.record).data["effective_status"], "EXCUSED")

    def test_absence_detection_ignores_deleted_leave_and_skips_active_approved_leave(self):
        settings = SystemSettings.get_solo()
        settings.work_week_days = [0, 1, 2, 3, 4]
        settings.absence_detection_enabled = True
        settings.save()
        self.record.delete()
        self.approve()
        self.assertEqual(mark_absentees_for_date(self.day)["skipped_on_leave"], 1)
        self.leave.is_active = False
        self.leave.save()
        self.assertEqual(mark_absentees_for_date(self.day)["created"], 1)

    def test_api_effective_filter_and_summary_keep_legacy_status(self):
        self.user.groups.add(Group.objects.get_or_create(name="SystemAdmin")[0])
        self.approve()
        client = APIClient()
        client.force_authenticate(self.user)
        response = client.get(
            "/api/attendance/",
            {"date": self.day.isoformat(), "effective_status": "EXCUSED"},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.pk),
        )
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["data"]
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["summary"], {"ABSENT": 1})
        self.assertEqual(data["effective_summary"], {"EXCUSED": 1})
        response = client.get(
            "/api/attendance/",
            {"date": self.day.isoformat(), "effective_status": "ABSENT"},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.pk),
        )
        self.assertEqual(response.data["data"]["count"], 0)

    def test_list_resolution_does_not_query_per_record(self):
        self.approve()
        with self.assertNumQueries(1):
            rows = list(with_leave_resolution(AttendanceRecord.objects.all()))
            self.assertEqual(rows[0].effective_status, "EXCUSED")
