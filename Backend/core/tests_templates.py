import os
import tempfile

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from core.views_templates import TEMPLATE_CATALOG, TEMPLATES_DIR, get_template_search_dirs, resolve_template_path


User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False)
class TemplateLibraryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.hr = User.objects.create_user(email="hr-templ@ffi.com", password="password")
        self.hr.groups.add(self.hr_group)

        self.admin = User.objects.create_user(email="admin-templ@ffi.com", password="password")
        self.admin.groups.add(self.admin_group)

        self.employee = User.objects.create_user(email="emp-templ@ffi.com", password="password")
        self.employee.groups.add(self.employee_group)

    def test_list_returns_catalog_for_hr(self):
        self.client.force_authenticate(user=self.hr)
        response = self.client.get("/api/core/templates/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        items = response.data["data"]["items"]
        self.assertEqual(len(items), len(TEMPLATE_CATALOG))
        keys = {item["key"] for item in items}
        self.assertIn("leave_request", keys)
        self.assertIn("loan_request", keys)
        self.assertIn("termination_letter", keys)

    def test_list_forbidden_for_non_hr(self):
        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/core/templates/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_download_unknown_key_returns_404(self):
        self.client.force_authenticate(user=self.hr)
        response = self.client.get("/api/core/templates/nonexistent-key/download/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_download_returns_pdf_when_available(self):
        key = "loan_request"
        template = next(t for t in TEMPLATE_CATALOG if t["key"] == key)
        path = os.path.join(TEMPLATES_DIR, template["filename"])
        if not os.path.exists(path):
            self.skipTest("Template file not generated yet; run generate_blank_templates.")

        self.client.force_authenticate(user=self.hr)
        response = self.client.get(f"/api/core/templates/{key}/download/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("attachment", response["Content-Disposition"])

    def test_empty_external_templates_dir_falls_back_to_bundled_templates(self):
        with tempfile.TemporaryDirectory() as tmpdir, override_settings(HR_TEMPLATES_DIR=tmpdir):
            search_dirs = get_template_search_dirs()
            path = resolve_template_path("leave_request_blank.pdf")

        self.assertEqual(search_dirs[0], tmpdir)
        self.assertTrue(path.endswith(os.path.join("static", "pdf_templates", "leave_request_blank.pdf")))
        self.assertTrue(os.path.exists(path))

    def test_download_forbidden_for_non_hr(self):
        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/core/templates/loan_request/download/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
