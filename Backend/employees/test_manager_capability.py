import json
from io import StringIO

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APITestCase

from audit.models import AuditLog
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()


class ManagerCapabilityTests(APITestCase):
    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="MGR-CAP",
            name="Manager Capability Co",
            node_type=OrganizationNode.NodeType.COMPANY,
            employee_id_prefix="MC",
        )
        self.other_company = OrganizationNode.objects.create(
            code="MGR-OTHER",
            name="Other Manager Co",
            node_type=OrganizationNode.NodeType.COMPANY,
            employee_id_prefix="MO",
        )
        self.department = Department.objects.create(
            company=self.company,
            code="MGR-DEP",
            name="Operations",
        )
        self.position = Position.objects.create(
            company=self.company,
            code="MGR-POS",
            name="Coordinator",
        )
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.manager_group, _ = Group.objects.get_or_create(name="Manager")

        self.hr_user = User.objects.create_user(email="manager-cap-hr@example.com", password="password")
        self.hr_user.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)

        self.manager_user = User.objects.create_user(email="manager-cap@example.com", password="password")
        self.manager_profile = self._profile(self.manager_user, "MC-MANAGER")
        self.employee_user = User.objects.create_user(email="manager-cap-employee@example.com", password="password")
        self.employee_profile = self._profile(self.employee_user, "MC-EMPLOYEE")

    def _profile(self, user, employee_id, **overrides):
        values = {
            "user": user,
            "company": self.company,
            "employee_id": employee_id,
            "full_name": employee_id,
            "department_ref": self.department,
            "position_ref": self.position,
            "hire_date": "2024-01-01",
        }
        values.update(overrides)
        return EmployeeProfile.objects.create(**values)

    def _patch_employee(self, profile, payload):
        self.client.force_authenticate(user=self.hr_user)
        return self.client.patch(
            f"/api/employees/{profile.id}/",
            payload,
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

    def test_access_is_relationship_based_and_counts_only_active_reports(self):
        self.employee_profile.manager_profile = self.manager_profile
        self.employee_profile.save(update_fields=["manager_profile", "updated_at"])

        suspended_user = User.objects.create_user(email="suspended-report@example.com", password="password")
        self._profile(
            suspended_user,
            "MC-SUSPENDED",
            manager_profile=self.manager_profile,
            employment_status=EmployeeProfile.EmploymentStatus.SUSPENDED,
        )
        archived_user = User.objects.create_user(email="archived-report@example.com", password="password")
        self._profile(
            archived_user,
            "MC-ARCHIVED",
            manager_profile=self.manager_profile,
            is_archived=True,
        )
        inactive_user = User.objects.create_user(
            email="inactive-report@example.com",
            password="password",
            is_active=False,
        )
        self._profile(inactive_user, "MC-INACTIVE-USER", manager_profile=self.manager_profile)

        self.client.force_authenticate(user=self.manager_user)
        response = self.client.get("/api/employees/manager/access/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["data"],
            {
                "has_access": True,
                "managed_employee_count": 1,
                "source": "direct_reports",
                "scopes": ["leave", "loan", "attendance", "asset", "announcement"],
            },
        )

        compatibility_response = self.client.get("/employees/manager/access/")
        self.assertEqual(compatibility_response.data["data"], response.data["data"])

    def test_employee_and_manager_group_user_without_reports_have_no_access(self):
        self.manager_user.groups.add(self.manager_group)
        self.client.force_authenticate(user=self.manager_user)

        response = self.client.get("/api/employees/manager/access/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["data"],
            {"has_access": False, "managed_employee_count": 0, "source": "none", "scopes": []},
        )

    def test_hr_can_assign_change_and_clear_manager_with_audit(self):
        other_manager_user = User.objects.create_user(email="manager-cap-2@example.com", password="password")
        other_manager_profile = self._profile(other_manager_user, "MC-MANAGER-2")

        assign_response = self._patch_employee(
            self.employee_profile,
            {"manager_profile_id": self.manager_profile.id},
        )
        self.assertEqual(assign_response.status_code, status.HTTP_200_OK)
        self.employee_profile.refresh_from_db()
        self.assertEqual(self.employee_profile.manager_profile_id, self.manager_profile.id)
        self.assertEqual(self.employee_profile.manager_id, self.manager_user.id)

        change_response = self._patch_employee(
            self.employee_profile,
            {"manager_profile_id": other_manager_profile.id},
        )
        self.assertEqual(change_response.status_code, status.HTTP_200_OK)
        self.employee_profile.refresh_from_db()
        self.assertEqual(self.employee_profile.manager_profile_id, other_manager_profile.id)
        self.assertEqual(self.employee_profile.manager_id, other_manager_user.id)

        clear_response = self._patch_employee(self.employee_profile, {"manager_profile_id": None})
        self.assertEqual(clear_response.status_code, status.HTTP_200_OK)
        self.employee_profile.refresh_from_db()
        self.assertIsNone(self.employee_profile.manager_profile_id)
        self.assertIsNone(self.employee_profile.manager_id)

        changes = AuditLog.objects.filter(
            action="employee_manager_changed",
            entity_id=str(self.employee_profile.id),
        ).order_by("created_at")
        self.assertEqual(changes.count(), 3)
        self.assertTrue(all(change.actor_id == self.hr_user.id for change in changes))
        self.assertTrue(all(change.metadata["changed_by"] == self.hr_user.id for change in changes))

    def test_invalid_manager_assignments_are_rejected(self):
        self_response = self._patch_employee(
            self.employee_profile,
            {"manager_profile_id": self.employee_profile.id},
        )
        self.assertEqual(self_response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

        other_manager_user = User.objects.create_user(email="other-company-manager@example.com", password="password")
        other_manager = EmployeeProfile.objects.create(
            user=other_manager_user,
            company=self.other_company,
            employee_id="MO-MANAGER",
        )
        cross_company_response = self._patch_employee(
            self.employee_profile,
            {"manager_profile_id": other_manager.id},
        )
        self.assertEqual(cross_company_response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

        archived_user = User.objects.create_user(email="archived-manager@example.com", password="password")
        archived_manager = self._profile(archived_user, "MC-ARCH-MANAGER", is_archived=True)
        archived_response = self._patch_employee(
            self.employee_profile,
            {"manager_profile_id": archived_manager.id},
        )
        self.assertEqual(archived_response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

        inactive_user = User.objects.create_user(email="inactive-manager@example.com", password="password")
        inactive_manager = self._profile(
            inactive_user,
            "MC-INACTIVE-MANAGER",
            employment_status=EmployeeProfile.EmploymentStatus.SUSPENDED,
        )
        inactive_response = self._patch_employee(
            self.employee_profile,
            {"manager_profile_id": inactive_manager.id},
        )
        self.assertEqual(inactive_response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

        disabled_user = User.objects.create_user(
            email="disabled-manager@example.com",
            password="password",
            is_active=False,
        )
        disabled_manager = self._profile(disabled_user, "MC-DISABLED-MANAGER")
        disabled_response = self._patch_employee(
            self.employee_profile,
            {"manager_profile_id": disabled_manager.id},
        )
        self.assertEqual(disabled_response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_manager_cycle_is_rejected(self):
        self.manager_profile.manager_profile = self.employee_profile
        self.manager_profile.save(update_fields=["manager_profile", "updated_at"])

        response = self._patch_employee(
            self.employee_profile,
            {"manager_profile_id": self.manager_profile.id},
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.employee_profile.refresh_from_db()
        self.assertIsNone(self.employee_profile.manager_profile_id)

    def test_sync_command_dry_run_backfills_clean_mapping_and_preserves_conflict(self):
        clean_employee_user = User.objects.create_user(email="legacy-clean@example.com", password="password")
        clean_employee = self._profile(clean_employee_user, "MC-LEGACY-CLEAN")
        EmployeeProfile.objects.filter(pk=clean_employee.pk).update(manager_id=self.manager_user.id)

        archived_user = User.objects.create_user(email="legacy-conflict-manager@example.com", password="password")
        archived_manager = self._profile(archived_user, "MC-CONFLICT-MGR", is_archived=True)
        conflict_user = User.objects.create_user(email="legacy-conflict@example.com", password="password")
        conflict_employee = self._profile(
            conflict_user,
            "MC-CONFLICT-EMP",
            manager_profile=archived_manager,
        )
        EmployeeProfile.objects.filter(pk=conflict_employee.pk).update(manager_id=self.manager_user.id)

        dry_run_output = StringIO()
        call_command("sync_manager_relationships", format="json", stdout=dry_run_output)
        dry_run = json.loads(dry_run_output.getvalue())
        clean_employee.refresh_from_db()
        self.assertTrue(dry_run["dry_run"])
        self.assertIsNone(clean_employee.manager_profile_id)
        self.assertTrue(
            any(item["employee_profile_id"] == conflict_employee.id for item in dry_run["conflicts"])
        )

        apply_output = StringIO()
        call_command("sync_manager_relationships", apply=True, format="json", stdout=apply_output)
        applied = json.loads(apply_output.getvalue())
        clean_employee.refresh_from_db()
        conflict_employee.refresh_from_db()
        self.assertFalse(applied["dry_run"])
        self.assertEqual(clean_employee.manager_profile_id, self.manager_profile.id)
        self.assertEqual(clean_employee.manager_id, self.manager_user.id)
        self.assertEqual(conflict_employee.manager_profile_id, archived_manager.id)
        self.assertEqual(conflict_employee.manager_id, self.manager_user.id)

    def test_audit_command_reports_every_required_category_without_writes(self):
        self.manager_user.groups.add(self.manager_group)
        EmployeeProfile.objects.filter(pk=self.employee_profile.pk).update(manager_id=self.manager_user.id)
        before = EmployeeProfile.objects.values_list("id", "manager_id", "manager_profile_id").order_by("id")
        before = list(before)

        output = StringIO()
        call_command("audit_manager_relationships", format="json", stdout=output)
        report = json.loads(output.getvalue())

        self.assertEqual(
            set(report),
            {
                "legacy_manager_missing_manager_profile",
                "manager_profile_legacy_mismatch",
                "manager_profile_without_linked_active_user",
                "self_manager_records",
                "cross_company_manager_assignments",
                "archived_or_inactive_managers",
                "reporting_cycles",
                "active_employees_without_manager_profile",
                "manager_group_users_without_direct_reports",
            },
        )
        self.assertTrue(
            any(
                item["employee_profile_id"] == self.employee_profile.id
                for item in report["legacy_manager_missing_manager_profile"]
            )
        )
        after = list(EmployeeProfile.objects.values_list("id", "manager_id", "manager_profile_id").order_by("id"))
        self.assertEqual(after, before)
