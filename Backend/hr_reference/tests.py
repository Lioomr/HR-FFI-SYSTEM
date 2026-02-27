from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .models import Department, Sponsor

User = get_user_model()


class ReferenceDataTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Setup Roles
        self.admin_group = Group.objects.create(name="SystemAdmin")
        self.hr_group = Group.objects.create(name="HRManager")
        self.emp_group = Group.objects.create(name="Employee")

        # Admin User
        self.admin = User.objects.create_user(email="admin@ffi.com", password="password")
        self.admin.groups.add(self.admin_group)

        # HR User
        self.hr = User.objects.create_user(email="hr@ffi.com", password="password")
        self.hr.groups.add(self.hr_group)

        # Employee
        self.emp = User.objects.create_user(email="emp@ffi.com", password="password")
        self.emp.groups.add(self.emp_group)

    def test_department_crud(self):
        self.client.force_authenticate(user=self.admin)

        # Create
        data = {"code": "IT", "name": "Information Technology", "description": "IT Dept"}
        response = self.client.post("/api/hr/departments/", data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        dept_id = response.data["data"]["id"]

        # Retrieve
        response = self.client.get(f"/api/hr/departments/{dept_id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["name"], "Information Technology")

        # Update
        data["name"] = "Tech"
        response = self.client.put(f"/api/hr/departments/{dept_id}/", data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["name"], "Tech")

        # List
        response = self.client.get("/api/hr/departments/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["data"]), 1)

        # Delete (Soft)
        response = self.client.delete(f"/api/hr/departments/{dept_id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(Department.objects.get(id=dept_id).is_active)

    def test_sponsor_unique_code(self):
        self.client.force_authenticate(user=self.hr)

        Sponsor.objects.create(code="S01", name="Sponsor 1")

        data = {"code": "S01", "name": "Duplicate Sponsor"}
        response = self.client.post("/api/hr/sponsors/", data)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_employee_permission_denied(self):
        self.client.force_authenticate(user=self.emp)
        response = self.client.get("/api/hr/departments/")
        # Should be 403
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
