from django.test import TestCase
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient
from rest_framework import status
from .models import EmployeeProfile
from audit.models import AuditLog

User = get_user_model()

class EmployeeProfileTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        
        # Setup Roles
        self.admin_group = Group.objects.create(name="SystemAdmin")
        self.hr_group = Group.objects.create(name="HRManager")
        self.employee_group = Group.objects.create(name="Employee")

        # Admin User
        self.admin_user = User.objects.create_user(email="admin@ffi.com", password="password")
        self.admin_user.groups.add(self.admin_group)

        # HR User
        self.hr_user = User.objects.create_user(email="hr@ffi.com", password="password")
        self.hr_user.groups.add(self.hr_group)

        # Employee User 1
        self.employee_user = User.objects.create_user(email="emp1@ffi.com", password="password")
        # Employee User 2
        self.employee_user_2 = User.objects.create_user(email="emp2@ffi.com", password="password")

    def test_admin_create_profile(self):
        self.client.force_authenticate(user=self.admin_user)
        data = {
            "user_id": self.employee_user.id,
            "department": "Engineering",
            "job_title": "Developer",
            "hire_date": "2024-01-01",
            "employment_status": "ACTIVE"
        }
        response = self.client.post("/api/employees/", data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(EmployeeProfile.objects.filter(user=self.employee_user).exists())
        
        # Verify Audit Log
        self.assertTrue(AuditLog.objects.filter(action="employee_profile_created", entity_id=response.data["data"]["id"]).exists())

    def test_hr_update_profile(self):
        # Create profile first
        profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            department="Engineering",
            job_title="Dev",
            hire_date="2024-01-01",
            employee_id="EMP-TEST-01"
        )

        self.client.force_authenticate(user=self.hr_user)
        data = {
            "job_title": "Senior Dev"
        }
        # PATCH update
        response = self.client.patch(f"/api/employees/{profile.pk}/", data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        profile.refresh_from_db()
        self.assertEqual(profile.job_title, "Senior Dev")

        # Verify Audit Log
        self.assertTrue(AuditLog.objects.filter(action="employee_profile_updated", entity_id=profile.id).exists())

    def test_employee_me_endpoint(self):
        profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            department="Engineering",
            job_title="Dev",
            hire_date="2024-01-01",
            employee_id="EMP-TEST-ME"
        )
        self.client.force_authenticate(user=self.employee_user)
        response = self.client.get("/api/employees/me/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["employee_id"], "EMP-TEST-ME")

    def test_employee_update_profile_forbidden(self):
        # Create profile first
        profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            department="Engineering",
            job_title="Dev",
            hire_date="2024-01-01",
            employee_id="EMP-TEST-02"
        )
        
        self.client.force_authenticate(user=self.employee_user)
        data = {
            "job_title": "Hacker"
        }
        response = self.client.patch(f"/api/employees/{profile.pk}/", data)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_employee_view_own_profile(self):
        profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            department="Engineering",
            job_title="Dev",
            hire_date="2024-01-01",
            employee_id="EMP-TEST-03"
        )
        
        self.client.force_authenticate(user=self.employee_user)
        response = self.client.get(f"/api/employees/{profile.pk}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["employee_id"], "EMP-TEST-03")

    def test_employee_view_other_profile_forbidden(self):
        # Profile for emp1
        profile1 = EmployeeProfile.objects.create(
            user=self.employee_user,
            department="Engineering",
            job_title="Dev",
            hire_date="2024-01-01",
            employee_id="EMP-TEST-04"
        )
        # Profile for emp2
        profile2 = EmployeeProfile.objects.create(
            user=self.employee_user_2,
            department="Sales",
            job_title="Salesman",
            hire_date="2024-01-01",
            employee_id="EMP-TEST-05"
        )

        # Login as emp1, try to view emp2
        self.client.force_authenticate(user=self.employee_user)
        response = self.client.get(f"/api/employees/{profile2.pk}/")
        
        # Should be 404 because of queryset filtering (or 403 if obj perm fails first, but typically queryset runs first)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_hard_delete_forbidden(self):
        profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            department="Engineering",
            job_title="Dev",
            hire_date="2024-01-01",
            employee_id="EMP-TEST-06"
        )
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.delete(f"/api/employees/{profile.pk}/")
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
