from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory, APITestCase

from employees.models import EmployeeProfile
from leaves.models import LeaveType
from leaves.serializers import HRManualLeaveRequestSerializer, LeaveRequestCreateSerializer

User = get_user_model()


class EmployeeLeaveBackdatingTests(APITestCase):
    def setUp(self):
        self.today = date(2026, 8, 11)
        self.user = User.objects.create_user(email="leave-backdating@ffi.test", password="password")
        EmployeeProfile.objects.create(
            user=self.user,
            employee_id="LEAVE-BACKDATE-001",
            hire_date=date(2020, 1, 1),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.leave_type = LeaveType.objects.create(name="Other Leave", code="OTHER", is_active=True)
        self.request = APIRequestFactory().post("/api/leaves/leave-requests/")
        self.request.user = self.user

    def _serializer_for_start(self, start_date):
        return LeaveRequestCreateSerializer(
            data={
                "leave_type": self.leave_type.id,
                "start_date": start_date.isoformat(),
                "end_date": start_date.isoformat(),
                "reason": "Backdate boundary test",
            },
            context={"request": self.request},
        )

    @patch("leaves.serializers.timezone.localdate")
    def test_exactly_seven_days_ago_is_valid(self, localdate_mock):
        localdate_mock.return_value = self.today
        serializer = self._serializer_for_start(self.today - timedelta(days=7))

        self.assertTrue(serializer.is_valid(), serializer.errors)

    @patch("leaves.serializers.timezone.localdate")
    def test_eight_days_ago_returns_start_date_validation_error(self, localdate_mock):
        localdate_mock.return_value = self.today
        serializer = self._serializer_for_start(self.today - timedelta(days=8))

        self.assertFalse(serializer.is_valid())
        self.assertEqual(
            str(serializer.errors["start_date"][0]),
            "Leave can be submitted up to 7 calendar days after it starts.",
        )

    def test_hr_manual_serializer_still_accepts_older_historical_dates(self):
        historical_date = self.today - timedelta(days=30)
        serializer = HRManualLeaveRequestSerializer(
            data={
                "employee_id": self.user.employee_profile.id,
                "leave_type": self.leave_type.id,
                "start_date": historical_date.isoformat(),
                "end_date": historical_date.isoformat(),
                "reason": "Historical HR entry",
                "manual_entry_reason": "Imported from the paper archive.",
                "source_document_ref": "archive-2026-001",
            },
            context={"request": self.request},
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
