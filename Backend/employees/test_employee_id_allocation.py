from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.test import TestCase
from rest_framework.test import APIClient

from employees.models import EmployeeIdAlias, EmployeeProfile
from employees.services.employee_ids import allocate_employee_id
from organization.models import OrganizationNode, UserOrganizationAccess


class EmployeeIdAllocationTests(TestCase):
    def setUp(self):
        self.ffi, _ = OrganizationNode.objects.get_or_create(
            code="FFI",
            defaults={"name": "FFI", "node_type": OrganizationNode.NodeType.COMPANY, "employee_id_prefix": "FFI"},
        )
        self.aseco, _ = OrganizationNode.objects.get_or_create(
            code="ASECO_PRO",
            defaults={"name": "Aseco", "node_type": OrganizationNode.NodeType.COMPANY, "employee_id_prefix": "ASECO"},
        )
        self.athroya, _ = OrganizationNode.objects.get_or_create(
            code="ATHROYA",
            defaults={"name": "Athroya", "node_type": OrganizationNode.NodeType.COMPANY, "employee_id_prefix": "ATH"},
        )

    def test_separate_company_sequences_reserve_first_two_numbers(self):
        with transaction.atomic():
            self.assertEqual(allocate_employee_id(self.aseco), "ASECO-0003")
            EmployeeProfile.objects.create(company=self.aseco, employee_id="ASECO-0003")
        with transaction.atomic():
            self.assertEqual(allocate_employee_id(self.aseco), "ASECO-0004")
            self.assertEqual(allocate_employee_id(self.athroya), "ATH-0003")

    def test_ffi_sequence_includes_archived_profiles_and_aliases(self):
        EmployeeProfile.objects.create(company=self.ffi, employee_id="FFI-0001")
        EmployeeProfile.objects.create(company=self.ffi, employee_id="FFI-0002")
        archived = EmployeeProfile.objects.create(company=self.ffi, employee_id="FFI-0003", is_archived=True)
        EmployeeIdAlias.objects.create(
            company=self.ffi, employee_profile=archived, old_employee_id="FFI-123456", new_employee_id="FFI-0003"
        )
        with transaction.atomic():
            self.assertEqual(allocate_employee_id(self.ffi), "FFI-0004")

    def test_legacy_company_continues_legacy_format_until_migrated(self):
        EmployeeProfile.objects.create(company=self.ffi, employee_id="FFI-123456")
        with transaction.atomic():
            self.assertRegex(allocate_employee_id(self.ffi), r"^FFI-\d{6}$")

    def test_employee_list_search_finds_old_alias_within_company_scope(self):
        profile = EmployeeProfile.objects.create(company=self.ffi, employee_id="FFI-0003", full_name="Mapped Employee")
        EmployeeIdAlias.objects.create(
            company=self.ffi, employee_profile=profile, old_employee_id="FFI-123456", new_employee_id="FFI-0003"
        )
        user = get_user_model().objects.create_user(email="hr-id-search@example.com", password="password")
        user.groups.add(Group.objects.create(name="HRManager"))
        UserOrganizationAccess.objects.create(user=user, organization=self.ffi)
        client = APIClient()
        client.force_authenticate(user=user)
        response = client.get("/api/employees/?search=FFI-123456", HTTP_X_ACTIVE_COMPANY_ID=str(self.ffi.pk))
        self.assertEqual(response.status_code, 200)
        self.assertIn("FFI-0003", str(response.data))
