from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model
from employees.models import EmployeeProfile
from leaves.models import LeaveType, LeaveRequest
from datetime import date, timedelta
from django.contrib.auth.models import Group

User = get_user_model()

class ManagerWorkflowTests(APITestCase):
    def setUp(self):
        # Create Leave Type
        self.leave_type = LeaveType.objects.create(name="Annual Leave", code="ANNUAL", is_active=True)

        # Create Systems Admin Group
        self.admin_group = Group.objects.create(name="SystemAdmin")
        
        # Create HR Group
        self.hr_group = Group.objects.create(name="HRManager")

        # Create Manager
        self.manager_user = User.objects.create_user(email="manager@example.com", password="password")
        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager_user,
            employee_id="EMP-MGR",
            department="IT",
            job_title="Manager",
            hire_date=date(2020, 1, 1)
        )

        # Create Employee (with Manager)
        self.employee_user = User.objects.create_user(email="employee@example.com", password="password")
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            employee_id="EMP-001",
            department="IT",
            job_title="Developer",
            hire_date=date(2021, 1, 1),
            manager=self.manager_user # Linked to manager
        )

        # Create Independent Employee (No Manager)
        self.indep_employee_user = User.objects.create_user(email="independent@example.com", password="password")
        self.indep_employee_profile = EmployeeProfile.objects.create(
            user=self.indep_employee_user,
            employee_id="EMP-002",
            department="HR",
            job_title="Recruiter",
            hire_date=date(2021, 1, 1),
            manager=None
        )

        # Create HR User
        self.hr_user = User.objects.create_user(email="hr@example.com", password="password")
        self.hr_user.groups.add(self.hr_group)
        
        # URLs
        self.requests_url = "/api/leaves/leave-requests/"
        self.manager_inbox_url = "/api/leaves/manager/requests/"

    def test_submission_with_manager_sets_pending_manager(self):
        """
        Employee with manager -> Status PENDING_MANAGER
        """
        self.client.force_authenticate(user=self.employee_user)
        data = {
            "leave_type": self.leave_type.id,
            "start_date": str(date(2026, 6, 1)),
            "end_date": str(date(2026, 6, 5)),
            "reason": "Vacation"
        }
        response = self.client.post(self.requests_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['data']['status'], LeaveRequest.RequestStatus.PENDING_MANAGER)

    def test_submission_without_manager_sets_pending_hr(self):
        """
        Employee without manager -> Status PENDING_HR
        """
        self.client.force_authenticate(user=self.indep_employee_user)
        data = {
            "leave_type": self.leave_type.id,
            "start_date": str(date(2026, 7, 1)),
            "end_date": str(date(2026, 7, 5)),
            "reason": "Vacation"
        }
        response = self.client.post(self.requests_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['data']['status'], LeaveRequest.RequestStatus.PENDING_HR)

    def test_manager_sees_only_reports(self):
        """
        Manager should see their reports' requests but not independent employee's.
        """
        # Create requests
        # 1. Employee (Report)
        LeaveRequest.objects.create(
            employee=self.employee_user, 
            leave_type=self.leave_type, 
            start_date=date(2026,6,1), 
            end_date=date(2026,6,5), 
            status=LeaveRequest.RequestStatus.PENDING_MANAGER
        )
        # 2. Independent (Not Report)
        LeaveRequest.objects.create(
            employee=self.indep_employee_user, 
            leave_type=self.leave_type, 
            start_date=date(2026,7,1), 
            end_date=date(2026,7,5), 
            status=LeaveRequest.RequestStatus.PENDING_HR
        )

        self.client.force_authenticate(user=self.manager_user)
        response = self.client.get(self.manager_inbox_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        print(f"DEBUG_FULL_RESPONSE: {response.data}")
        data_body = response.data.get('data', {})
        results = data_body.get('items', data_body.get('results', []))
        
        print(f"DEBUG_RESULTS: {results}")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['employee']['id'], self.employee_user.id)

    def test_manager_approve_workflow(self):
        """
        Manager approval transitions to PENDING_HR
        """
        lr = LeaveRequest.objects.create(
            employee=self.employee_user, 
            leave_type=self.leave_type, 
            start_date=date(2026,6,1), 
            end_date=date(2026,6,5), 
            status=LeaveRequest.RequestStatus.PENDING_MANAGER
        )
        
        self.client.force_authenticate(user=self.manager_user)
        url = f"{self.manager_inbox_url}{lr.id}/approve/"
        
        response = self.client.post(url, {"decision_reason": "Enjoy!"}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['data']['status'], LeaveRequest.RequestStatus.PENDING_HR)
        
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
            start_date=date(2026,6,1), 
            end_date=date(2026,6,5), 
            status=LeaveRequest.RequestStatus.PENDING_HR
        )
        
        self.client.force_authenticate(user=self.hr_user)
        url = f"{self.requests_url}{lr.id}/approve/"
        response = self.client.post(url, {"decision_reason": "Final Approve"}, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['data']['status'], LeaveRequest.RequestStatus.APPROVED)
