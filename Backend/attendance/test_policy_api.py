from datetime import datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.urls import resolve
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from admin_portal.models import SystemSettings
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_head_office_node

from .biotime_policy import ATTENDANCE_UNAVAILABLE_UNMAPPED_MESSAGE
from .models import AttendanceAdjustment, AttendanceDailyResult, AttendanceLateViolation, BioTimeEmployeeMap
from .policy import AttendancePolicyService
from .views import AttendanceViolationViewSet

User = get_user_model()
RECALCULATE_URL = "/api/attendance/hr/recalculate/"
SUMMARY_URL = "/api/attendance/me/today-summary/"
VIOLATIONS_URL = "/api/attendance/violations/"
NOTICES_URL = "/api/attendance/notices/"


class AttendancePolicyApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.company_a = OrganizationNode.objects.create(
            code="ATT_API_A", name="Attendance API A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.company_b = OrganizationNode.objects.create(
            code="ATT_API_B", name="Attendance API B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.head_office = get_head_office_node()

        self.hr = self._user("att-api-hr@ffi.test", hr_group, self.company_a, self.company_b, self.head_office)
        self.hr_a_only = self._user("att-api-hr-a@ffi.test", hr_group, self.company_a)
        # An employee may be granted several companies but owns one profile.
        self.employee = self._user("att-api-employee@ffi.test", employee_group, self.company_a, self.company_b)
        self.coworker = self._user("att-api-coworker@ffi.test", employee_group, self.company_a)
        self.foreign = self._user("att-api-foreign@ffi.test", employee_group, self.company_b)
        self.profile = self._profile(self.employee, self.company_a, "ATTAPI-A01", "Own Employee")
        self.coworker_profile = self._profile(self.coworker, self.company_a, "ATTAPI-A02", "Coworker Person")
        self.foreign_profile = self._profile(self.foreign, self.company_b, "ATTAPI-B01", "Foreign Person")
        for profile in (self.profile, self.coworker_profile, self.foreign_profile):
            BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code=profile.employee_id)

        settings_obj = SystemSettings.get_solo()
        settings_obj.work_day_start_time = time(9, 0)
        settings_obj.default_shift_end_time = time(18, 0)
        settings_obj.grace_window_minutes = 15
        settings_obj.post_grace_tolerance_minutes = 5
        settings_obj.save()
        self.today = timezone.localdate()

    @staticmethod
    def _user(email, group, *organizations):
        user = User.objects.create_user(email=email, password="password")
        user.groups.add(group)
        for organization in organizations:
            UserOrganizationAccess.objects.create(user=user, organization=organization)
        return user

    @staticmethod
    def _profile(user, company, employee_id, full_name):
        return EmployeeProfile.objects.create(
            user=user, company=company, employee_id=employee_id, full_name=full_name, total_salary=Decimal("3000.00")
        )

    def _late_violation(self, profile, day=None):
        day = day or self.today
        start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        AttendanceDailyResult.objects.create(
            employee_profile=profile,
            company=profile.company,
            date=day,
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start.replace(minute=30),
            final_check_out_at=start.replace(hour=18),
        )
        AttendancePolicyService.reconcile_month(profile, day)
        return AttendanceLateViolation.objects.get(employee_profile=profile, date=day)

    def _get(self, user, url, company):
        self.client.force_authenticate(user=user)
        return self.client.get(url, HTTP_X_ACTIVE_COMPANY_ID=str(company.id))

    def _recalculate(self, user, profile, company):
        self.client.force_authenticate(user=user)
        return self.client.post(
            RECALCULATE_URL,
            {"employee_profile_id": profile.id, "date": self.today.isoformat()},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(company.id),
        )

    @staticmethod
    def _ids(response):
        return {row["id"] for row in response.data["data"]["items"]}

    def test_violation_list_route_is_not_captured_by_attendance_record_detail(self):
        self.assertIs(resolve(VIOLATIONS_URL).func.cls, AttendanceViolationViewSet)

    def test_hr_recalculates_an_active_company_profile(self):
        response = self._recalculate(self.hr, self.profile, self.company_a)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "success")
        [result] = response.data["data"]["results"]
        self.assertEqual(result["date"], self.today.isoformat())
        self.assertEqual(result["grace"], {"consumed": False, "reason": "no_check_in"})
        self.assertIsNone(result["violation"])

    def test_hr_recalculate_hides_profiles_outside_the_selected_company(self):
        response = self._recalculate(self.hr, self.foreign_profile, self.company_a)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(AttendanceDailyResult.objects.filter(employee_profile=self.foreign_profile).exists())
        self.assertEqual(
            self._recalculate(self.hr_a_only, self.foreign_profile, self.company_b).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_hr_recalculate_rejects_an_employee_without_a_biotime_mapping(self):
        BioTimeEmployeeMap.objects.filter(employee_profile=self.coworker_profile).delete()

        response = self._recalculate(self.hr, self.coworker_profile, self.company_a)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(
            response.data["errors"],
            [{"field": "employee_profile_id", "message": "This employee has no active BioTime mapping."}],
        )
        self.assertFalse(AttendanceDailyResult.objects.filter(employee_profile=self.coworker_profile).exists())
        # Company scope still comes first: an unmapped other-company profile is a 404.
        BioTimeEmployeeMap.objects.filter(employee_profile=self.foreign_profile).delete()
        self.assertEqual(
            self._recalculate(self.hr, self.foreign_profile, self.company_a).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_hr_recalculate_requires_company_context_and_hr_role(self):
        self.assertEqual(
            self._recalculate(self.hr, self.profile, self.head_office).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(
            self._recalculate(self.employee, self.profile, self.company_a).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertFalse(AttendanceDailyResult.objects.exists())

    def test_hr_violation_history_is_limited_to_the_selected_company(self):
        own = self._late_violation(self.profile)
        coworker = self._late_violation(self.coworker_profile)
        foreign = self._late_violation(self.foreign_profile)

        self.assertEqual(self._ids(self._get(self.hr, VIOLATIONS_URL, self.company_a)), {own.id, coworker.id})
        self.assertEqual(
            self._get(self.hr, f"{VIOLATIONS_URL}{foreign.id}/", self.company_a).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(self._ids(self._get(self.hr, VIOLATIONS_URL, self.company_b)), {foreign.id})

        detail = self._get(self.hr, f"{VIOLATIONS_URL}{foreign.id}/", self.company_b)
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data["status"], "success")
        self.assertEqual(detail.data["data"]["employee_profile_id"], self.foreign_profile.id)
        self.assertEqual(detail.data["data"]["employee_code"], "ATTAPI-B01")
        self.assertEqual(detail.data["data"]["employee_name"], "Foreign Person")
        self.assertEqual(detail.data["data"]["employee_name_en"], "Foreign Person")
        # A first occurrence is a warning with no payroll deduction.
        self.assertIsNone(detail.data["data"]["payroll_status"])
        self.assertEqual(
            self._get(self.hr, VIOLATIONS_URL, self.head_office).status_code, status.HTTP_403_FORBIDDEN
        )

    def test_employee_violation_history_is_own_and_honors_the_selected_company(self):
        own = self._late_violation(self.profile)
        coworker = self._late_violation(self.coworker_profile)
        self._late_violation(self.foreign_profile)

        self.assertEqual(self._ids(self._get(self.employee, VIOLATIONS_URL, self.company_a)), {own.id})
        self.assertEqual(
            self._get(self.employee, f"{VIOLATIONS_URL}{coworker.id}/", self.company_a).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(self._ids(self._get(self.employee, VIOLATIONS_URL, self.company_b)), set())
        self.assertEqual(
            self._get(self.employee, f"{VIOLATIONS_URL}{own.id}/", self.company_b).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self._get(self.foreign, VIOLATIONS_URL, self.company_a).status_code, status.HTTP_403_FORBIDDEN
        )

    def test_hr_can_explicitly_request_only_their_own_violations_and_notices(self):
        hr_profile = self._profile(self.hr, self.company_a, "ATTAPI-HR01", "HR Self Service")
        BioTimeEmployeeMap.objects.create(employee_profile=hr_profile, biotime_emp_code=hr_profile.employee_id)
        own = self._late_violation(hr_profile)
        self._late_violation(self.coworker_profile)

        violations = self._get(self.hr, f"{VIOLATIONS_URL}?mine=true", self.company_a)
        notices = self._get(self.hr, f"{NOTICES_URL}?mine=true", self.company_a)

        self.assertEqual(self._ids(violations), {own.id})
        self.assertEqual(
            {row["employee_profile_id"] for row in notices.data["data"]["items"]}, {hr_profile.id}
        )

    def test_today_summary_serializes_the_policy_result_for_the_own_company(self):
        violation = self._late_violation(self.profile)

        response = self._get(self.employee, SUMMARY_URL, self.company_a)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "success")
        data = response.data["data"]
        self.assertEqual(data["date"], self.today.isoformat())
        self.assertEqual(set(data["shift"]), {"start_at", "end_at", "scheduled_minutes"})
        self.assertEqual(data["status_input"], "LATE")
        self.assertFalse(data["is_attendance_exempt"])
        self.assertEqual(data["grace"], {"consumed": False, "reason": "outside_grace"})
        self.assertEqual(data["violation"]["id"], violation.id)
        self.assertEqual(data["violation"]["occurrence_number"], 1)
        self.assertEqual(data["violation"]["penalty_amount"], "0.00")
        self.assertEqual(data["violation"]["lifecycle"], "active")
        self.assertIsNone(data["violation"]["payroll_status"])
        self.assertNotIn("provider_payload", data)

    def test_hr_violation_filters_narrow_the_company_history(self):
        yesterday = self.today - timedelta(days=1)
        earlier = self._late_violation(self.profile, yesterday)
        own_today = self._late_violation(self.profile)
        coworker_earlier = self._late_violation(self.coworker_profile, yesterday)
        # Occurrence 2 is monetary, so excusing it leaves a void payroll deduction.
        coworker = self._late_violation(self.coworker_profile)
        AttendanceAdjustment.objects.create(
            employee_profile=self.coworker_profile,
            company=self.company_a,
            date=self.today,
            effective_date=self.today,
            kind=AttendanceAdjustment.Kind.LATE_PERMISSION,
            source_key="api-filter-late",
            approved_minutes=0,
            reason="late:TEST",
        )
        AttendancePolicyService.reconcile_month(self.coworker_profile, self.today)
        foreign = self._late_violation(self.foreign_profile)

        def ids(query):
            return self._ids(self._get(self.hr, f"{VIOLATIONS_URL}?{query}", self.company_a))

        self.assertEqual(ids("lifecycle=void"), {coworker.id})
        self.assertEqual(
            ids("lifecycle=active,void"), {earlier.id, own_today.id, coworker_earlier.id, coworker.id}
        )
        self.assertEqual(ids("payroll_status=void"), {coworker.id})
        self.assertEqual(ids("payroll_status=pending"), {own_today.id})
        self.assertEqual(ids(f"employee_profile_id={self.coworker_profile.id}"), {coworker_earlier.id, coworker.id})
        # Filters never reach outside the selected company.
        self.assertEqual(ids(f"employee_profile_id={self.foreign_profile.id}"), set())
        self.assertNotIn(foreign.id, ids("search=Person"))
        self.assertEqual(ids("search=coworker"), {coworker_earlier.id, coworker.id})
        self.assertEqual(ids("search=ATTAPI-A01"), {earlier.id, own_today.id})
        self.assertEqual(ids(f"date_from={self.today}&date_to={self.today}"), {own_today.id, coworker.id})
        self.assertEqual(ids(f"date_to={yesterday}"), {earlier.id, coworker_earlier.id})
        # Employees keep their own-only scope even when filtering by another employee.
        self.assertEqual(
            self._ids(
                self._get(self.employee, f"{VIOLATIONS_URL}?employee_profile_id={self.coworker_profile.id}", self.company_a)
            ),
            set(),
        )

    def test_invalid_violation_filters_return_field_errors(self):
        for query, field in (
            ("lifecycle=bogus", "lifecycle"),
            ("lifecycle=", "lifecycle"),
            ("payroll_status=paid", "payroll_status"),
            ("employee_profile_id=abc", "employee_profile_id"),
            ("date_from=13-09-2026", "date_from"),
            (f"date_from={self.today}&date_to={self.today - timedelta(days=1)}", "date_to"),
        ):
            with self.subTest(query=query):
                response = self._get(self.hr, f"{VIOLATIONS_URL}?{query}", self.company_a)
                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                self.assertIn(field, {item["field"] for item in response.data["errors"]})

    def test_today_summary_is_unavailable_without_a_biotime_mapping(self):
        BioTimeEmployeeMap.objects.filter(employee_profile=self.profile).delete()

        response = self._get(self.employee, SUMMARY_URL, self.company_a)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["message"], ATTENDANCE_UNAVAILABLE_UNMAPPED_MESSAGE)
        self.assertFalse(AttendanceDailyResult.objects.filter(employee_profile=self.profile).exists())
        # Company checks still come first: another company is a 404, not a mapping disclosure.
        self.assertEqual(
            self._get(self.employee, SUMMARY_URL, self.company_b).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_today_summary_rejects_another_company_and_head_office_context(self):
        self._late_violation(self.profile)

        self.assertEqual(
            self._get(self.employee, SUMMARY_URL, self.company_b).status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(self._get(self.hr, SUMMARY_URL, self.head_office).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self._get(self.employee, SUMMARY_URL, self.head_office).status_code, status.HTTP_403_FORBIDDEN
        )
