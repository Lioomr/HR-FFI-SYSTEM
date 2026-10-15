from datetime import date, datetime, time, timedelta
from decimal import Decimal

from attendance.models import AttendanceDailyResult, AttendanceRecord, BioTimeEmployeeMap
from attendance.schedule import is_working_day
from audit.models import AuditLog
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from django.utils import timezone
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess
from rest_framework.test import APIClient

from .catalog import CATALOG
from .models import PenaltyCatalog, PenaltyRecord
from .services import EXECUTIVE_PENALTY_REASON, sync_absence_candidates, sync_attendance_candidates
from .tasks import issue_auto_warnings

User = get_user_model()


@override_settings(PENALTIES_EFFECTIVE_FROM="2026-09-29")
class ExecutivePenaltyTests(TestCase):
    """The CEO and General Manager are never penalized; other employees are unaffected."""

    @classmethod
    def setUpTestData(cls):
        for row in CATALOG:
            PenaltyCatalog.objects.update_or_create(code=row["code"], defaults=row)
        cls.company = OrganizationNode.objects.create(
            code="PENALTY_EXEC", name="Penalty exec", node_type=OrganizationNode.NodeType.COMPANY
        )
        cls.hr = User.objects.create_user(email="penalty-exec-hr@ffi.test", password="test")
        cls.hr.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        UserOrganizationAccess.objects.create(user=cls.hr, organization=cls.company)
        cls.employee = cls._profile("PEN-EXEC-EMP")
        ceo = User.objects.create_user(email="penalty-exec-ceo@ffi.test", password="test")
        ceo.groups.add(Group.objects.get_or_create(name="CEO")[0])
        cls.ceo = cls._profile("PEN-EXEC-CEO", user=ceo)
        cls.gm = cls._profile("PEN-EXEC-GM", job_title="General Manager")

    @classmethod
    def _profile(cls, employee_id, *, user=None, job_title="Staff"):
        profile = EmployeeProfile.objects.create(
            user=user,
            company=cls.company,
            employee_id=employee_id,
            job_title=job_title,
            total_salary=Decimal("3000.00"),
            basic_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code=employee_id)
        return profile

    def _absence(self, profile):
        day = date(2026, 9, 29)
        while not is_working_day(profile, day):
            day += timedelta(days=1)
        return AttendanceRecord.objects.create(
            employee_profile=profile,
            date=day,
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.ABSENT,
        )

    def _late_result(self, profile):
        day = date(2026, 9, 30)
        start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        return AttendanceDailyResult.objects.create(
            employee_profile=profile,
            company=self.company,
            date=day,
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start + timedelta(minutes=20),
            final_check_out_at=start.replace(hour=18),
        )

    def test_attendance_produces_candidates_for_employees_only(self):
        sync_absence_candidates([self._absence(profile) for profile in (self.employee, self.ceo, self.gm)])
        for profile in (self.employee, self.ceo, self.gm):
            sync_attendance_candidates(self._late_result(profile))

        penalized = set(PenaltyRecord.objects.values_list("employee_profile_id", "source_kind"))
        self.assertEqual(penalized, {(self.employee.pk, "absence"), (self.employee.pk, "late_arrival")})

    def test_existing_executive_candidates_are_withdrawn_once_and_hidden(self):
        records = []
        for profile in (self.ceo, self.gm):
            row = self._absence(profile)
            records.append(
                PenaltyRecord.objects.create(
                    company=self.company,
                    employee_profile=profile,
                    catalog=PenaltyCatalog.objects.get(code="W11"),
                    occurred_on=row.date,
                    occurrence_number=0,
                    action="pending_hr_mark",
                    status=PenaltyRecord.Status.PENDING_HR_MARK,
                    source=PenaltyRecord.Source.AUTOMATIC,
                    source_kind="absence",
                    attendance_record=row,
                )
            )

        issue_auto_warnings()
        issue_auto_warnings()
        sync_absence_candidates([record.attendance_record for record in records])

        for record in records:
            record.refresh_from_db()
            self.assertEqual(record.status, PenaltyRecord.Status.WAIVED)
            self.assertEqual(record.resolution["reason"], EXECUTIVE_PENALTY_REASON)
            self.assertEqual(AuditLog.objects.filter(action="penalty_waived", entity_id=str(record.pk)).count(), 1)
        client = APIClient()
        client.force_authenticate(self.hr)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        listed = client.get("/api/penalties/", {"include_automated": "1"})
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data["data"]["items"], [])

    def test_hr_cannot_issue_a_penalty_to_an_executive(self):
        client = APIClient()
        client.force_authenticate(self.hr)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        for profile in (self.ceo, self.gm):
            body = {"employee_profile_id": profile.pk, "occurred_on": "2026-09-29", "catalog_code": "O01", "note": "X"}
            response = client.post("/api/penalties/", body, format="json")
            self.assertEqual(response.status_code, 422)
            self.assertIn(EXECUTIVE_PENALTY_REASON, str(response.data))
        self.assertFalse(PenaltyRecord.objects.exists())
