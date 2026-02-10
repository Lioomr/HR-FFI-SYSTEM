from datetime import date, timedelta
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient
from rest_framework import status
from leaves.models import LeaveType, LeaveRequest
from audit.models import AuditLog

User = get_user_model()


class LeaveManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Setup Roles
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        # Admin User
        self.admin = User.objects.create_user(email="admin@ffi.com", password="password")
        self.admin.groups.add(self.admin_group)

        # HR User
        self.hr = User.objects.create_user(email="hr@ffi.com", password="password")
        self.hr.groups.add(self.hr_group)

        # Employee 1
        self.emp1 = User.objects.create_user(email="emp1@ffi.com", password="password")
        self.emp1.groups.add(self.employee_group)

        # Employee 2
        self.emp2 = User.objects.create_user(email="emp2@ffi.com", password="password")
        self.emp2.groups.add(self.employee_group)

        # Leave Types
        self.annual_leave = LeaveType.objects.create(name="Annual Leave", code="ANNUAL")
        self.sick_leave = LeaveType.objects.create(name="Sick Leave", code="SICK")

    # --- Leave Types ---
    def test_leave_type_crud_admin(self):
        self.client.force_authenticate(user=self.admin)
        data = {"name": "Unpaid Leave", "code": "UNPAID", "is_paid": False}
        response = self.client.post("/api/leaves/leave-types/", data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(LeaveType.objects.filter(code="UNPAID").exists())
        # Audit
        self.assertTrue(
            AuditLog.objects.filter(action="leave_type_created", entity_id=response.data["data"]["id"]).exists()
        )

    def test_leave_type_soft_delete(self):
        self.client.force_authenticate(user=self.admin)
        type_to_delete = LeaveType.objects.create(name="Delete Me", code="DEL")

        response = self.client.delete(f"/api/leaves/leave-types/{type_to_delete.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Verify it still exists but is inactive
        type_to_delete.refresh_from_db()
        self.assertFalse(type_to_delete.is_active)
        self.assertTrue(AuditLog.objects.filter(action="leave_type_deactivated", entity_id=type_to_delete.id).exists())

    def test_leave_type_read_only_employee(self):
        self.client.force_authenticate(user=self.emp1)
        # Employee sees only active types. setUp created 2 active types.

        # Test Create Forbidden
        response = self.client.post("/api/leaves/leave-types/", {"name": "Hack", "code": "HACK"})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Test List
        response = self.client.get("/api/leaves/leave-types/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["data"]), 2)

    # --- Leave Requests ---
    def test_create_leave_request_flow(self):
        self.client.force_authenticate(user=self.emp1)
        start = date.today() + timedelta(days=1)
        end = date.today() + timedelta(days=5)

        data = {"leave_type": self.annual_leave.id, "start_date": str(start), "end_date": str(end), "reason": "Holiday"}

        # 1. Create
        response = self.client.post("/api/leaves/leave-requests/", data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        req_id = response.data["data"]["id"]

        # 2. Verify Status
        req = LeaveRequest.objects.get(pk=req_id)
        # NOTE: Updated to PENDING_HR default, but logic might set to PENDING_MANAGER if manager exists.
        # Here emp1 has no manager set in setUp, so it should default to PENDING_HR.
        # The test originally expected "PENDING". The model default changed to PENDING_HR.
        # But wait, RequestStatus.PENDING was removed? No, I updated RequestStatus choices.
        # Ah, I replaced PENDING with PENDING_MANAGER and PENDING_HR.
        # So this test WILL FAIL if it expects "PENDING".
        # I need to update this test to expect "PENDING_HR".
        self.assertEqual(req.status, LeaveRequest.RequestStatus.PENDING_HR)
        self.assertEqual(req.employee, self.emp1)

        # 3. Approve (HR)
        self.client.force_authenticate(user=self.hr)
        response = self.client.post(f"/api/leaves/leave-requests/{req_id}/approve/", {"decision_reason": "Enjoy"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        req.refresh_from_db()
        self.assertEqual(req.status, "approved")
        self.assertEqual(req.decided_by, self.hr)

    def test_cancel_leave_request(self):
        self.client.force_authenticate(user=self.emp1)
        start = date.today() + timedelta(days=10)
        end = date.today() + timedelta(days=12)

        # Create
        req = LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.sick_leave,
            start_date=start,
            end_date=end,
            status=LeaveRequest.RequestStatus.PENDING_HR,  # Ensure pending state
        )

        # Cancel
        response = self.client.post(f"/api/leaves/leave-requests/{req.id}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        req.refresh_from_db()
        self.assertEqual(req.status, "cancelled")

    def test_view_others_request_forbidden(self):
        # Emp1 creates request
        req = LeaveRequest.objects.create(
            employee=self.emp1, leave_type=self.sick_leave, start_date=date.today(), end_date=date.today()
        )

        # Emp2 tries to view
        self.client.force_authenticate(user=self.emp2)
        response = self.client.get(f"/api/leaves/leave-requests/{req.id}/")

        # 500 debug: likely get_role or something else.
        # But expecting 404.
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_overlapping_requests_forbidden(self):
        self.client.force_authenticate(user=self.emp1)
        start = date.today() + timedelta(days=20)
        end = date.today() + timedelta(days=25)

        # Request 1
        LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual_leave,
            start_date=start,
            end_date=end,
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )

        # Request 2 (Overlap)
        data = {
            "leave_type": self.annual_leave.id,
            "start_date": str(start + timedelta(days=2)),  # Inside range
            "end_date": str(end + timedelta(days=2)),
            "reason": "Overlap",
        }
        response = self.client.post("/api/leaves/leave-requests/", data)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        # Serializer validation error wrapped in error()
        # likely: { "status": "error", "message": "Validation Error", "errors": ["You already have..."] }
        self.assertIn("already have a pending or approved leave", str(response.data))

    def test_start_after_end_fail(self):
        self.client.force_authenticate(user=self.emp1)
        data = {
            "leave_type": self.annual_leave.id,
            "start_date": "2024-01-05",
            "end_date": "2024-01-01",  # Fail
        }
        response = self.client.post("/api/leaves/leave-requests/", data)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_delete_leave_request_forbidden(self):
        self.client.force_authenticate(user=self.admin)
        start = date.today() + timedelta(days=30)
        end = date.today() + timedelta(days=35)
        req = LeaveRequest.objects.create(
            employee=self.emp1, leave_type=self.annual_leave, start_date=start, end_date=end
        )

        response = self.client.delete(f"/api/leaves/leave-requests/{req.id}/")
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


class LeaveBalanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Setup Roles & Users
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        # Create Users
        from employees.models import EmployeeProfile

        # HR
        self.hr = User.objects.create_user(email="hr@ffi.com", password="password")
        self.hr.groups.add(self.hr_group)

        # Employee
        self.emp1 = User.objects.create_user(email="emp1@ffi.com", password="password")
        self.emp1.groups.add(self.employee_group)
        self.profile1 = EmployeeProfile.objects.create(
            user=self.emp1,
            employee_id="EMP001",
            hire_date=date.today() - timedelta(days=700),  # Hired 2 years ago
        )

        # Leave Types
        self.annual = LeaveType.objects.create(
            name="Annual Leave", code="ANNUAL", annual_quota=21.0, allow_carry_over=False
        )
        self.sick = LeaveType.objects.create(
            name="Sick Leave", code="SICK", annual_quota=10.0, allow_carry_over=True, max_carry_over=5.0
        )

    def test_balance_calculation_simple(self):
        # No usage
        from leaves.utils import calculate_leave_balance

        year = date.today().year
        balances = calculate_leave_balance(self.emp1, year)

        # Find annual leave
        annual_bal = next(b for b in balances if b["leave_type_id"] == self.annual.id)
        self.assertEqual(float(annual_bal["remaining_days"]), 21.0)
        self.assertEqual(float(annual_bal["used_days"]), 0.0)

    def test_balance_usage(self):
        year = date.today().year
        # Create Approved Request (2 days)
        start = date(year, 1, 10)
        end = date(year, 1, 11)
        LeaveRequest.objects.create(
            employee=self.emp1,
            leave_type=self.annual,
            start_date=start,
            end_date=end,
            status="approved",
            decided_by=self.hr,
        )

        from leaves.utils import calculate_leave_balance

        balances = calculate_leave_balance(self.emp1, year)
        annual_bal = next(b for b in balances if b["leave_type_id"] == self.annual.id)

        # 21 - 2 = 19
        self.assertEqual(float(annual_bal["used_days"]), 2.0)
        self.assertEqual(float(annual_bal["remaining_days"]), 19.0)

    def test_carry_over_logic(self):
        year = date.today().year
        prev_year = year - 1

        # Set hire date to start of prev_year to avoid earlier carry-over
        self.profile1.hire_date = date(prev_year, 1, 1)
        self.profile1.save()
        self.emp1.refresh_from_db()  # Clear cached related objects like employee_profile

        # 1. Year-1: Use 2 days of Sick Leave (Quota 10) -> Remaining 8
        # Create approved request in prev_year
        start = date(prev_year, 5, 1)
        end = date(prev_year, 5, 2)
        LeaveRequest.objects.create(
            employee=self.emp1, leave_type=self.sick, start_date=start, end_date=end, status="approved"
        )

        # Verify Prev Year
        from leaves.utils import calculate_leave_balance

        prev_balances = calculate_leave_balance(self.emp1, prev_year)
        sick_prev = next(b for b in prev_balances if b["leave_type_id"] == self.sick.id)
        self.assertEqual(float(sick_prev["remaining_days"]), 8.0)

        # 2. Year: Opening should be min(8, max_carry_over=5) = 5
        curr_balances = calculate_leave_balance(self.emp1, year)
        sick_curr = next(b for b in curr_balances if b["leave_type_id"] == self.sick.id)

        # self.assertEqual(float(sick_curr["opening_balance"]), 5.0) # opening_balance is not in dict explicitly?
        # Check remaining instead: Opening(5) + Quota(10) - Used(0) = 15
        self.assertEqual(float(sick_curr["remaining_days"]), 15.0)

    def test_employee_balance_endpoint(self):
        self.client.force_authenticate(user=self.emp1)
        year = date.today().year

        response = self.client.get(f"/api/leaves/employee/leave-balance/?year={year}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        print(f"DEBUG_EMP_BAL: {response.data}")
        # Expect list of balances
        data = response.data["data"]
        # Match structure
        self.assertTrue(isinstance(data, list))
        self.assertTrue(any(item["leave_type"] == "Annual Leave" for item in data))

    def test_employee_cannot_access_global_list(self):
        self.client.force_authenticate(user=self.emp1)
        response = self.client.get(f"/api/leaves/leave-balances/?employee_id={self.profile1.id}&year=2024")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_hr_view_employee_balance(self):
        self.client.force_authenticate(user=self.hr)
        year = date.today().year

        response = self.client.get(f"/api/leaves/leave-balances/?employee_id={self.profile1.id}&year={year}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        data = response.data["data"]
        self.assertTrue(isinstance(data, list))
        self.assertTrue(any(item["leave_type"] == "Annual Leave" for item in data))
