from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APITestCase

from audit.models import AuditLog


class AuditExportTests(APITestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.admin_user = self.user_model.objects.create_user(
            email="audit-admin@test.com",
            password="StrongPass123!",
            full_name="Audit Admin",
        )
        self.admin_user.groups.add(self.admin_group)
        self.client.force_authenticate(user=self.admin_user)

        AuditLog.objects.create(
            actor=self.admin_user,
            action="user_created",
            entity="User",
            entity_id="15",
            ip_address="127.0.0.1",
        )

    def test_audit_logs_export_returns_xlsx_when_requested(self):
        response = self.client.get("/api/audit-logs/export/?file_format=xlsx")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertIn('filename="audit_logs.xlsx"', response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"PK"))

    def test_audit_logs_export_rejects_unsupported_format(self):
        response = self.client.get("/api/audit-logs/export/?file_format=pdf")

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data["status"], "error")
        self.assertIn("file_format", response.data["errors"])
