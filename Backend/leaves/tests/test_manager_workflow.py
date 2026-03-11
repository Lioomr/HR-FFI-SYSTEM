from datetime import date

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType

User = get_user_model()


class ManagerWorkflowTests(APITestCase):
    def setUp(self):
        # Create Leave Type
        self.leave_type = LeaveType.objects.create(name="Annual Leave", code="ANNUAL", is_active=True)

        # Create Systems Admin Group
        self.admin_group = Group.objects.create(name="SystemAdmin")

        # Create HR Group
        self.hr_group = Group.objects.create(name="HRManager")
        self.ceo_group = Group.objects.create(name="CEO")
        self.cfo_group = Group.objects.create(name="CFO")

        # Create Manager
        self.manager_user = User.objects.create_user(email="manager@example.com", password="password")
        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager_user,
            employee_id="EMP-MGR",
            department="IT",
            job_title="Manager",
            hire_date=date(2020, 1, 1),
        )

        # Create Employee (with Manager)
        self.employee_user = User.objects.create_user(email="employee@example.com", password="password")
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            employee_id="EMP-001",
            department="IT",
            job_title="Developer",
            hire_date=date(2021, 1, 1),
            manager_profile=self.manager_profile,  # Linked to manager profile
        )

        # Create Independent Employee (No Manager)
        self.indep_employee_user = User.objects.create_user(email="independent@example.com", password="password")
        self.indep_employee_profile = EmployeeProfile.objects.create(
            user=self.indep_employee_user,
            employee_id="EMP-002",
            department="HR",
            job_title="Recruiter",
            hire_date=date(2021, 1, 1),
            manager_profile=None,
        )

        # Create HR User
        self.hr_user = User.objects.create_user(email="hr@example.com", password="password")
        self.hr_user.groups.add(self.hr_group)

        self.ceo_user = User.objects.create_user(email="ceo@example.com", password="password")
        self.ceo_user.groups.add(self.ceo_group)
        self.ceo_profile = EmployeeProfile.objects.create(
            user=self.ceo_user,
            employee_id="EMP-CEO",
            department="Executive",
            job_title="CEO",
            hire_date=date(2020, 1, 1),
        )

        self.ceo_report_user = User.objects.create_user(email="ceo-report@example.com", password="password")
        self.ceo_report_profile = EmployeeProfile.objects.create(
            user=self.ceo_report_user,
            employee_id="EMP-CEO-REPORT",
            department="Ops",
            job_title="Lead",
            hire_date=date(2021, 1, 1),
            manager_profile=self.ceo_profile,
        )

        self.cfo_user = User.objects.create_user(email="cfo@example.com", password="password")
        self.cfo_user.groups.add(self.cfo_group)
        self.cfo_profile = EmployeeProfile.objects.create(
            user=self.cfo_user,
            employee_id="EMP-CFO",
            department="Finance",
            job_title="CFO",
            hire_date=date(2020, 1, 1),
        )

        self.cfo_report_user = User.objects.create_user(email="cfo-report@example.com", password="password")
        self.cfo_report_profile = EmployeeProfile.objects.create(
            user=self.cfo_report_user,
            employee_id="EMP-CFO-REPORT",
            department="Finance",
            job_title="Analyst",
            hire_date=date(2021, 1, 1),
            manager_profile=self.cfo_profile,
        )

        self.employee_manager_user = User.objects.create_user(email="employee-manager@example.com", password="password")
        self.employee_manager_profile = EmployeeProfile.objects.create(
            user=self.employee_manager_user,
            employee_id="EMP-EMP-MGR",
            department="Operations",
            job_title="Supervisor",
            hire_date=date(2020, 1, 1),
        )
        self.employee_manager_report_user = User.objects.create_user(
            email="employee-manager-report@example.com", password="password"
        )
        self.employee_manager_report_profile = EmployeeProfile.objects.create(
            user=self.employee_manager_report_user,
            employee_id="EMP-EMP-REPORT",
            department="Operations",
            job_title="Coordinator",
            hire_date=date(2021, 1, 1),
            manager_profile=self.employee_manager_profile,
        )

        # URLs
        self.requests_url = "/api/leaves/leave-requests/"
        self.manager_inbox_url = "/api/leaves/manager/leave-requests/"

    def test_submission_with_manager_sets_pending_manager(self):
        """
        Employee with manager -> Status PENDING_MANAGER
        """
        self.client.force_authenticate(user=self.employee_user)
        data = {
            "leave_type": self.leave_type.id,
            "start_date": str(date(2026, 6, 1)),
            "end_date": str(date(2026, 6, 5)),
            "reason": "Vacation",
        }
        response = self.client.post(self.requests_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], LeaveRequest.RequestStatus.PENDING_MANAGER)

    def test_submission_without_manager_sets_pending_hr(self):
        """
        Employee without manager -> Status PENDING_HR
        """
        self.client.force_authenticate(user=self.indep_employee_user)
        data = {
            "leave_type": self.leave_type.id,
            "start_date": str(date(2026, 7, 1)),
            "end_date": str(date(2026, 7, 5)),
            "reason": "Vacation",
        }
        response = self.client.post(self.requests_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], LeaveRequest.RequestStatus.PENDING_HR)

    def test_submission_with_unlinked_manager_profile_sets_pending_hr(self):
        """
        Employee with manager_profile but no resolvable manager user -> Status PENDING_HR
        """
        orphan_manager = EmployeeProfile.objects.create(
            employee_id="EMP-ORPHAN-MGR",
            full_name="Orphan Manager",
            department="IT",
            job_title="Manager",
            hire_date=date(2021, 1, 1),
        )
        self.employee_profile.manager_profile = orphan_manager
        self.employee_profile.manager = None
        self.employee_profile.save(update_fields=["manager_profile", "manager", "updated_at"])

        self.client.force_authenticate(user=self.employee_user)
        data = {
            "leave_type": self.leave_type.id,
            "start_date": str(date(2026, 8, 1)),
            "end_date": str(date(2026, 8, 3)),
            "reason": "Vacation",
        }
        response = self.client.post(self.requests_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], LeaveRequest.RequestStatus.PENDING_HR)

    def test_manager_sees_only_reports(self):
        """
        Manager should see their reports' requests but not independent employee's.
        """
        # Create requests
        # 1. Employee (Report)
        LeaveRequest.objects.create(
            employee=self.employee_user,
            leave_type=self.leave_type,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 5),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )
        # 2. Independent (Not Report)
        LeaveRequest.objects.create(
            employee=self.indep_employee_user,
            leave_type=self.leave_type,
            start_date=date(2026, 7, 1),
            end_date=date(2026, 7, 5),
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )

        self.client.force_authenticate(user=self.manager_user)
        response = self.client.get(self.manager_inbox_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        print(f"DEBUG_FULL_RESPONSE: {response.data}")
        data_body = response.data.get("data", {})
        results = data_body.get("items", data_body.get("results", []))

        print(f"DEBUG_RESULTS: {results}")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["employee"]["id"], self.employee_user.id)

    def test_manager_approve_workflow(self):
        """
        Manager approval transitions to PENDING_HR
        """
        lr = LeaveRequest.objects.create(
            employee=self.employee_user,
            leave_type=self.leave_type,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 5),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.manager_user)
        url = f"{self.manager_inbox_url}{lr.id}/approve/"

        response = self.client.post(url, {"comment": "Enjoy!"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LeaveRequest.RequestStatus.PENDING_HR)

        lr.refresh_from_db()
        self.assertEqual(lr.status, LeaveRequest.RequestStatus.PENDING_HR)
        self.assertEqual(lr.manager_decision_by, self.manager_user)
        self.assertEqual(lr.manager_decision_note, "Enjoy!")

    def test_hr_approval_finalizes(self):
        """
        HR approval transitions PENDING_HR to APPROVED
        """
        lr = LeaveRequest.objects.create(
            employee=self.employee_user,
            leave_type=self.leave_type,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 5),
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )

        self.client.force_authenticate(user=self.hr_user)
        url = f"{self.requests_url}{lr.id}/approve/"
        response = self.client.post(url, {"comment": "Final Approve"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LeaveRequest.RequestStatus.APPROVED)

    def test_manager_can_preview_leave_document(self):
        lr = LeaveRequest.objects.create(
            employee=self.employee_user,
            leave_type=self.leave_type,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 5),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )
        lr.document = SimpleUploadedFile("manager_doc.txt", b"doc content", content_type="text/plain")
        lr.save()

        self.client.force_authenticate(user=self.manager_user)
        url = f"{self.manager_inbox_url}{lr.id}/document/"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("manager_doc", response.get("Content-Disposition", ""))

    def test_hr_can_download_leave_document(self):
        lr = LeaveRequest.objects.create(
            employee=self.employee_user,
            leave_type=self.leave_type,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 5),
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )
        lr.document = SimpleUploadedFile("hr_doc.txt", b"doc content", content_type="text/plain")
        lr.save()

        self.client.force_authenticate(user=self.hr_user)
        url = f"{self.requests_url}{lr.id}/document/?download=1"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("attachment", response.get("Content-Disposition", "").lower())

    def test_ceo_manager_scope_is_direct_reports_only(self):
        direct_request = LeaveRequest.objects.create(
            employee=self.ceo_report_user,
            leave_type=self.leave_type,
            start_date=date(2026, 9, 1),
            end_date=date(2026, 9, 3),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )
        LeaveRequest.objects.create(
            employee=self.employee_user,
            leave_type=self.leave_type,
            start_date=date(2026, 9, 10),
            end_date=date(2026, 9, 12),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.ceo_user)
        response = self.client.get(self.manager_inbox_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        items = response.data["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], direct_request.id)

    def test_ceo_can_approve_direct_report_leave_from_manager_endpoint(self):
        request_obj = LeaveRequest.objects.create(
            employee=self.ceo_report_user,
            leave_type=self.leave_type,
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 2),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.ceo_user)
        response = self.client.post(f"{self.manager_inbox_url}{request_obj.id}/approve/", {"comment": "Approved"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LeaveRequest.RequestStatus.PENDING_HR)

    def test_cfo_can_approve_direct_report_leave_from_manager_endpoint(self):
        request_obj = LeaveRequest.objects.create(
            employee=self.cfo_report_user,
            leave_type=self.leave_type,
            start_date=date(2026, 10, 5),
            end_date=date(2026, 10, 6),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.cfo_user)
        response = self.client.post(f"{self.manager_inbox_url}{request_obj.id}/approve/", {"comment": "Approved"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LeaveRequest.RequestStatus.PENDING_HR)

    def test_employee_role_direct_manager_can_use_manager_leave_inbox(self):
        request_obj = LeaveRequest.objects.create(
            employee=self.employee_manager_report_user,
            leave_type=self.leave_type,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 2),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.employee_manager_user)
        response = self.client.get(self.manager_inbox_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        items = response.data["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], request_obj.id)
