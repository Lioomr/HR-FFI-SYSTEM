"""One manager per employee, possibly from another company, never expiring."""

import json
from datetime import date, timedelta
from io import StringIO

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from audit.models import AuditLog
from core.models import CrossCompanyManagerAssignment
from employees.models import EmployeeProfile
from employees.serializers import EmployeeProfileReadSerializer, ScopedEmployeeReadSerializer
from employees.services.manager_relationships import (
    get_effective_manager_profile,
    get_valid_manager_user,
    managed_reports_queryset,
    manager_approval_actor_source,
    set_employee_manager,
)
from leaves.models import LeaveRequest, LeaveType
from organization.models import OrganizationNode, OrganizationScope, OrganizationScopeMembership, UserOrganizationAccess

User = get_user_model()
ALL_CAPABILITIES = sorted(CrossCompanyManagerAssignment.Capability.values)


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True,
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
)
class SingleManagerTestCase(APITestCase):
    def setUp(self):
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.company_a = OrganizationNode.objects.create(
            code="ONE_MGR_A", name="One Manager A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.company_b = OrganizationNode.objects.create(
            code="ONE_MGR_B", name="One Manager B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.company_c = OrganizationNode.objects.create(
            code="ONE_MGR_C", name="One Manager C", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.hr = self._user("hr@one-manager.test", self.company_a, "ONE-HR", hr=True)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company_a)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company_b)

        self.employee = self._user("employee@one-manager.test", self.company_a, "ONE-EMP")
        self.direct_manager = self._user("direct@one-manager.test", self.company_a, "ONE-DIRECT")
        self.cross_manager = self._user("cross@one-manager.test", self.company_b, "ONE-CROSS")
        self.other_cross_manager = self._user("cross2@one-manager.test", self.company_b, "ONE-CROSS-2")
        self.outside_manager = self._user("outside@one-manager.test", self.company_c, "ONE-OUTSIDE")

    def _user(self, email, company, employee_id, *, hr=False, **profile_fields):
        user = User.objects.create_user(email=email, password="StrongPass123!", full_name=employee_id)
        if hr:
            user.groups.add(self.hr_group)
        EmployeeProfile.objects.create(
            user=user, company=company, employee_id=employee_id, full_name=employee_id, **profile_fields
        )
        return user

    def profile(self, user):
        return EmployeeProfile.objects.get(user=user)

    def active_assignments(self, profile=None):
        queryset = CrossCompanyManagerAssignment.objects.filter(is_active=True, revoked_at__isnull=True)
        return queryset.filter(employee=profile) if profile is not None else queryset

    def patch_manager(self, user, profile, manager_profile_id, company=None):
        self.client.force_authenticate(user=user)
        return self.client.patch(
            f"/api/employees/{profile.id}/",
            {"manager_profile_id": manager_profile_id},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str((company or self.company_a).id),
        )


class SetEmployeeManagerServiceTests(SingleManagerTestCase):
    def test_cross_company_manager_clears_direct_manager_and_creates_one_full_never_expiring_assignment(self):
        employee = self.profile(self.employee)
        set_employee_manager(employee, self.profile(self.direct_manager), actor=self.hr)

        change = set_employee_manager(employee, self.profile(self.cross_manager), actor=self.hr, source="test")

        employee.refresh_from_db()
        self.assertIsNone(employee.manager_profile_id)
        self.assertIsNone(employee.manager_id)
        assignment = self.active_assignments(employee).get()
        self.assertEqual(change.assignment, assignment)
        self.assertTrue(change.assignment_created)
        self.assertEqual(assignment.manager_profile, self.profile(self.cross_manager))
        self.assertEqual(sorted(assignment.capabilities), ALL_CAPABILITIES)
        self.assertFalse(hasattr(assignment, "end_at"))
        # No covering scope existed: one is created for exactly the two companies.
        self.assertEqual(assignment.scope.code, f"auto-{self.company_a.id}-{self.company_b.id}")
        self.assertEqual(
            set(assignment.scope.memberships.values_list("company_id", flat=True)),
            {self.company_a.id, self.company_b.id},
        )
        self.assertEqual(get_effective_manager_profile(employee), self.profile(self.cross_manager))
        self.assertTrue(
            AuditLog.objects.filter(
                action="cross_company_manager_assignment_created", entity_id=str(assignment.id)
            ).exists()
        )
        self.assertTrue(AuditLog.objects.filter(action="employee_manager_changed", entity_id=str(employee.id)).exists())

    def test_reassigning_the_same_cross_company_manager_reuses_the_assignment(self):
        employee = self.profile(self.employee)
        first = set_employee_manager(employee, self.profile(self.cross_manager), actor=self.hr).assignment
        CrossCompanyManagerAssignment.objects.filter(pk=first.pk).update(capabilities=["employees.view"])

        second = set_employee_manager(employee, self.profile(self.cross_manager), actor=self.hr)

        self.assertEqual(second.assignment.pk, first.pk)
        self.assertFalse(second.assignment_created)
        self.assertEqual(self.active_assignments(employee).count(), 1)
        first.refresh_from_db()
        self.assertEqual(sorted(first.capabilities), ALL_CAPABILITIES)

    def test_switching_cross_company_manager_revokes_the_previous_assignment(self):
        employee = self.profile(self.employee)
        first = set_employee_manager(employee, self.profile(self.cross_manager), actor=self.hr).assignment

        change = set_employee_manager(employee, self.profile(self.other_cross_manager), actor=self.hr)

        first.refresh_from_db()
        self.assertFalse(first.is_active)
        self.assertIsNotNone(first.revoked_at)
        self.assertEqual(first.revoked_by, self.hr)
        self.assertEqual(change.revoked_assignment_ids, [first.pk])
        self.assertEqual(
            self.active_assignments(employee).get().manager_profile, self.profile(self.other_cross_manager)
        )

    def test_same_company_manager_revokes_the_cross_company_assignment(self):
        employee = self.profile(self.employee)
        assignment = set_employee_manager(employee, self.profile(self.cross_manager), actor=self.hr).assignment

        set_employee_manager(employee, self.profile(self.direct_manager), actor=self.hr)

        employee.refresh_from_db()
        assignment.refresh_from_db()
        self.assertEqual(employee.manager_profile, self.profile(self.direct_manager))
        self.assertEqual(employee.manager_id, self.direct_manager.id)
        self.assertFalse(assignment.is_active)
        self.assertFalse(self.active_assignments(employee).exists())

    def test_none_clears_both_kinds_of_manager(self):
        employee = self.profile(self.employee)
        set_employee_manager(employee, self.profile(self.cross_manager), actor=self.hr)
        set_employee_manager(employee, None, actor=self.hr)
        self.assertIsNone(get_effective_manager_profile(employee))
        self.assertFalse(self.active_assignments(employee).exists())

        set_employee_manager(employee, self.profile(self.direct_manager), actor=self.hr)
        set_employee_manager(employee, None, actor=self.hr)
        employee.refresh_from_db()
        self.assertIsNone(employee.manager_profile_id)
        self.assertIsNone(employee.manager_id)

    def test_most_specific_existing_scope_is_reused(self):
        broad = OrganizationScope.objects.create(code="ONE-BROAD", name="Broad")
        for company in (self.company_a, self.company_b, self.company_c):
            OrganizationScopeMembership.objects.create(scope=broad, company=company)
        narrow = OrganizationScope.objects.create(code="ONE-NARROW", name="Narrow")
        for company in (self.company_a, self.company_b):
            OrganizationScopeMembership.objects.create(scope=narrow, company=company)

        assignment = set_employee_manager(self.profile(self.employee), self.profile(self.cross_manager)).assignment

        self.assertEqual(assignment.scope, narrow)
        self.assertFalse(OrganizationScope.objects.filter(code__startswith="auto-").exists())

    def test_employee_without_a_login_can_have_a_cross_company_manager_that_survives_linking_one(self):
        unlinked = EmployeeProfile.objects.create(company=self.company_a, employee_id="ONE-NO-LOGIN", full_name="X")
        assignment = set_employee_manager(unlinked, self.profile(self.cross_manager)).assignment

        later_user = User.objects.create_user(email="later@one-manager.test", password="StrongPass123!")
        unlinked.user = later_user
        unlinked.save(update_fields=["user", "updated_at"])

        assignment.refresh_from_db()
        self.assertTrue(assignment.is_active)

    def test_cycles_are_rejected_across_direct_and_cross_company_links(self):
        employee = self.profile(self.employee)
        cross_manager = self.profile(self.cross_manager)
        # cross_manager (B) -> employee (A) via a cross-company link ...
        set_employee_manager(cross_manager, employee, actor=self.hr)
        # ... so employee -> cross_manager would close the loop.
        with self.assertRaisesMessage(ValidationError, "reporting cycle"):
            set_employee_manager(employee, cross_manager, actor=self.hr)

        # A longer loop: direct_manager -> employee (direct), employee -> cross_manager (cross) is fine,
        # then cross_manager -> direct_manager (cross) must be rejected.
        set_employee_manager(cross_manager, None)
        set_employee_manager(self.profile(self.direct_manager), employee)
        set_employee_manager(employee, cross_manager)
        with self.assertRaisesMessage(ValidationError, "reporting cycle"):
            set_employee_manager(cross_manager, self.profile(self.direct_manager))
        self.assertFalse(self.active_assignments(cross_manager).exists())

    def test_database_rejects_a_second_active_assignment(self):
        employee = self.profile(self.employee)
        assignment = set_employee_manager(employee, self.profile(self.cross_manager)).assignment
        with self.assertRaises(IntegrityError), transaction.atomic():
            CrossCompanyManagerAssignment.objects.bulk_create(
                [
                    CrossCompanyManagerAssignment(
                        employee=employee,
                        manager_profile=self.profile(self.other_cross_manager),
                        scope=assignment.scope,
                        start_at=timezone.now(),
                        capabilities=ALL_CAPABILITIES,
                    )
                ]
            )
        # A revoked row does not count.
        CrossCompanyManagerAssignment.objects.bulk_create(
            [
                CrossCompanyManagerAssignment(
                    employee=employee,
                    manager_profile=self.profile(self.other_cross_manager),
                    scope=assignment.scope,
                    start_at=timezone.now(),
                    capabilities=ALL_CAPABILITIES,
                    is_active=False,
                    revoked_at=timezone.now(),
                )
            ]
        )
        self.assertEqual(self.active_assignments(employee).count(), 1)


class CrossCompanyManagerRightsTests(SingleManagerTestCase):
    def setUp(self):
        super().setUp()
        set_employee_manager(self.profile(self.employee), self.profile(self.cross_manager), actor=self.hr)

    def test_every_capability_reaches_the_cross_company_manager(self):
        employee = self.profile(self.employee)
        for capability in ALL_CAPABILITIES:
            with self.subTest(capability=capability):
                self.assertIn(
                    employee, managed_reports_queryset(self.cross_manager, cross_company_capability=capability)
                )
                self.assertEqual(
                    manager_approval_actor_source(self.cross_manager, employee, capability=capability),
                    "cross_company_assignment",
                )
                self.assertEqual(
                    get_valid_manager_user(employee, cross_company_capability=capability), self.cross_manager
                )

    def test_workflow_engine_routes_every_request_type_with_a_capability_to_the_cross_company_manager(self):
        from assets.models import AssetReturnRequest
        from attendance.models import AttendanceCorrectionRequest, AttendanceRecord
        from core.services.workflow_engine import _get_manager_user_for_instance
        from loans.models import LoanRequest

        employee = self.profile(self.employee)
        for instance in (
            LeaveRequest(employee=self.employee, employee_profile=employee),
            LoanRequest(employee=self.employee, employee_profile=employee),
            AttendanceRecord(employee_profile=employee),
            AttendanceCorrectionRequest(employee_profile=employee),
            AssetReturnRequest(employee=employee),
        ):
            with self.subTest(model=instance.__class__.__name__):
                self.assertEqual(_get_manager_user_for_instance(instance, self.employee), self.cross_manager)

    def test_cross_company_manager_can_open_the_attendance_manager_queue(self):
        self.client.force_authenticate(user=self.cross_manager)
        response = self.client.get("/api/manager/attendance/")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

    def test_a_leftover_direct_manager_loses_approval_to_the_cross_company_manager(self):
        employee = self.profile(self.employee)
        # Simulate legacy data that has both links (as consolidation finds in production).
        EmployeeProfile.objects.filter(pk=employee.pk).update(
            manager_profile=self.profile(self.direct_manager), manager_id=self.direct_manager.id
        )
        employee = self.profile(self.employee)
        self.assertIsNone(manager_approval_actor_source(self.direct_manager, employee, capability="leaves.approve"))
        self.assertEqual(
            get_valid_manager_user(employee, cross_company_capability="leaves.approve"), self.cross_manager
        )
        self.assertEqual(get_effective_manager_profile(employee), self.profile(self.cross_manager))

    def test_cross_company_manager_approves_a_leave_end_to_end(self):
        leave_type = LeaveType.objects.create(company=self.company_a, code="ONE-AL", name="Annual", annual_quota=30)
        self.client.force_authenticate(user=self.employee)
        start = timezone.localdate() + timedelta(days=3)
        submitted = self.client.post(
            "/api/leaves/leave-requests/",
            {"leave_type": leave_type.id, "start_date": str(start), "end_date": str(start), "reason": "Trip"},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )
        self.assertEqual(submitted.status_code, status.HTTP_201_CREATED, submitted.data)
        request_id = submitted.data["data"]["id"]
        self.assertEqual(submitted.data["data"]["status"], LeaveRequest.RequestStatus.PENDING_MANAGER)
        self.assertEqual(submitted.data["data"]["workflow"]["current_actor"]["id"], self.cross_manager.id)

        self.client.force_authenticate(user=self.cross_manager)
        approval = self.client.post(f"/api/leaves/manager/leave-requests/{request_id}/approve/", {"comment": "OK"})
        self.assertEqual(approval.status_code, status.HTTP_200_OK, approval.data)
        self.assertEqual(approval.data["data"]["status"], LeaveRequest.RequestStatus.PENDING_HR)


class EmployeeManagerApiTests(SingleManagerTestCase):
    def test_hr_sets_a_cross_company_manager_through_the_employee_endpoint(self):
        response = self.patch_manager(self.hr, self.profile(self.employee), self.profile(self.cross_manager).id)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        data = response.data["data"]
        self.assertEqual(data["manager_profile_id"], self.profile(self.cross_manager).id)
        self.assertEqual(data["manager_profile_name"], "ONE-CROSS")
        self.assertEqual(data["manager_id"], self.cross_manager.id)
        self.assertEqual(self.active_assignments(self.profile(self.employee)).count(), 1)

        detail = self.client.get(
            f"/api/employees/{self.profile(self.employee).id}/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id)
        )
        listing = self.client.get("/api/employees/?page_size=100", HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id))
        list_item = next(
            item for item in listing.data["data"]["results"] if item["id"] == self.profile(self.employee).id
        )
        for payload in (detail.data["data"], list_item):
            self.assertEqual(payload["manager_profile_id"], self.profile(self.cross_manager).id)
            self.assertNotIn("cross_company_managers", payload)
            self.assertNotIn("manager_company_name", json.dumps(payload))
            self.assertNotIn("One Manager B", json.dumps(payload))

    def test_me_endpoint_shows_only_the_manager_name(self):
        set_employee_manager(self.profile(self.employee), self.profile(self.cross_manager))
        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/employees/me/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        data = response.data["data"]
        self.assertEqual(data["manager_profile_id"], self.profile(self.cross_manager).id)
        self.assertEqual(data["manager_profile_name"], "ONE-CROSS")
        serialized = json.dumps(data, default=str)
        self.assertNotIn("One Manager B", serialized)
        self.assertNotIn("cross_company", serialized)
        self.assertNotIn("end_at", serialized)

    def test_serializers_expose_the_effective_manager_without_company_or_expiry(self):
        employee = self.profile(self.employee)
        set_employee_manager(employee, self.profile(self.cross_manager))
        employee = self.profile(self.employee)
        for serializer_class in (EmployeeProfileReadSerializer, ScopedEmployeeReadSerializer):
            with self.subTest(serializer=serializer_class.__name__):
                data = serializer_class(employee).data
                self.assertEqual(data["manager_profile_id"], self.profile(self.cross_manager).id)
                self.assertEqual(data["manager_profile_name"], "ONE-CROSS")
                self.assertFalse({"cross_company_managers", "manager_company_name", "end_at"} & set(data))

    def test_hr_cannot_pick_a_manager_from_a_company_outside_their_access(self):
        response = self.patch_manager(self.hr, self.profile(self.employee), self.profile(self.outside_manager).id)

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.data)
        self.assertNotIn("One Manager C", json.dumps(response.data))
        self.assertFalse(self.active_assignments().exists())

    def test_create_with_a_cross_company_manager(self):
        self.client.force_authenticate(user=self.hr)
        from hr_reference.models import Department, Position

        department = Department.objects.create(company=self.company_a, code="ONE-DEP", name="Ops")
        position = Position.objects.create(company=self.company_a, code="ONE-POS", name="Clerk")
        response = self.client.post(
            "/api/employees/",
            {
                "full_name": "New Hire",
                "department_id": department.id,
                "position_id": position.id,
                "join_date": str(date(2026, 1, 1)),
                "manager_profile_id": self.profile(self.cross_manager).id,
            },
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        created = EmployeeProfile.objects.get(pk=response.data["data"]["id"])
        self.assertIsNone(created.manager_profile_id)
        self.assertEqual(self.active_assignments(created).get().manager_profile, self.profile(self.cross_manager))
        self.assertEqual(response.data["data"]["manager_profile_id"], self.profile(self.cross_manager).id)

    def test_cycle_through_the_api_is_a_validation_error(self):
        set_employee_manager(self.profile(self.cross_manager), self.profile(self.employee))
        response = self.patch_manager(self.hr, self.profile(self.employee), self.profile(self.cross_manager).id)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.data)
        self.assertIn("cycle", json.dumps(response.data))


class ManagerOptionsEndpointTests(SingleManagerTestCase):
    url = "/api/employees/manager-options/"

    def get(self, user=None, **params):
        self.client.force_authenticate(user=user or self.hr)
        return self.client.get(self.url, params, HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id))

    def test_lists_active_employees_from_every_accessible_company_without_company_fields(self):
        response = self.get(page_size=100)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        items = response.data["data"]["items"]
        ids = {item["id"] for item in items}
        self.assertIn(self.profile(self.cross_manager).id, ids)
        self.assertIn(self.profile(self.direct_manager).id, ids)
        self.assertNotIn(self.profile(self.outside_manager).id, ids)
        self.assertEqual(set(items[0]), {"id", "employee_id", "full_name", "full_name_en", "full_name_ar"})
        self.assertEqual(response.data["data"]["page"], 1)

    def test_excludes_the_edited_employee_their_reports_and_inactive_people(self):
        employee = self.profile(self.employee)
        set_employee_manager(self.profile(self.direct_manager), employee)
        set_employee_manager(self.profile(self.cross_manager), self.profile(self.direct_manager))
        inactive = self._user("inactive@one-manager.test", self.company_a, "ONE-INACTIVE")
        User.objects.filter(pk=inactive.pk).update(is_active=False)
        self._user("archived@one-manager.test", self.company_a, "ONE-ARCHIVED", is_archived=True)

        response = self.get(employee_profile_id=employee.id, page_size=100)

        ids = {item["id"] for item in response.data["data"]["items"]}
        self.assertNotIn(employee.id, ids)
        self.assertNotIn(self.profile(self.direct_manager).id, ids)
        self.assertNotIn(self.profile(self.cross_manager).id, ids)
        self.assertIn(self.profile(self.other_cross_manager).id, ids)
        self.assertNotIn(self.profile(inactive).id, ids)
        self.assertFalse(EmployeeProfile.objects.filter(employee_id="ONE-ARCHIVED", id__in=ids).exists())

    def test_search_by_name_or_employee_id(self):
        by_code = self.get(search="ONE-CROSS-2")
        self.assertEqual([item["employee_id"] for item in by_code.data["data"]["items"]], ["ONE-CROSS-2"])

    def test_hidden_employee_is_a_generic_404_and_employees_cannot_use_it(self):
        hidden = self.get(employee_profile_id=self.profile(self.outside_manager).id)
        self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.get(employee_profile_id="abc").status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(self.get(user=self.employee).status_code, status.HTTP_403_FORBIDDEN)


class CrossCompanyAssignmentAdminApiTests(SingleManagerTestCase):
    url = "/api/core/cross-company-manager-assignments/"

    def test_admin_create_replaces_the_existing_manager(self):
        employee = self.profile(self.employee)
        set_employee_manager(employee, self.profile(self.direct_manager))
        self.client.force_authenticate(user=self.hr)

        first = self.client.post(
            self.url,
            {"employee_id": employee.id, "manager_profile_id": self.profile(self.cross_manager).id},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )
        second = self.client.post(
            self.url,
            {"employee_id": employee.id, "manager_profile_id": self.profile(self.other_cross_manager).id},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED, second.data)
        employee.refresh_from_db()
        self.assertIsNone(employee.manager_profile_id)
        self.assertEqual(self.active_assignments(employee).get().id, second.data["data"]["id"])
        self.assertNotIn("end_at", second.data["data"])

    def test_admin_create_rejects_a_same_company_manager(self):
        self.client.force_authenticate(user=self.hr)
        response = self.client.post(
            self.url,
            {"employee_id": self.profile(self.employee).id, "manager_profile_id": self.profile(self.direct_manager).id},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.data)
        self.assertFalse(self.active_assignments().exists())

    def test_admin_delete_revokes_and_leaves_no_manager(self):
        employee = self.profile(self.employee)
        assignment = set_employee_manager(employee, self.profile(self.cross_manager)).assignment
        self.client.force_authenticate(user=self.hr)
        response = self.client.delete(f"{self.url}{assignment.id}/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNone(get_effective_manager_profile(self.profile(self.employee)))


class ConsolidateManagerRelationshipsCommandTests(SingleManagerTestCase):
    def _legacy_data(self):
        """Production-shaped rows: duplicates to one manager plus a leftover direct manager."""
        employee = self.profile(self.employee)
        scope = OrganizationScope.objects.create(code="ONE-LEGACY", name="All Active Companies")
        for company in (self.company_a, self.company_b):
            OrganizationScopeMembership.objects.create(scope=scope, company=company)
        EmployeeProfile.objects.filter(pk=employee.pk).update(
            manager_profile=self.profile(self.direct_manager), manager_id=self.direct_manager.id
        )
        legacy_capabilities = ["employees.view", "leaves.approve", "attendance.approve"]
        older = CrossCompanyManagerAssignment.objects.create(
            employee=employee,
            manager_profile=self.profile(self.cross_manager),
            scope=scope,
            start_at=timezone.now() - timedelta(days=2),
            capabilities=legacy_capabilities,
        )
        # The unique index now forbids a second active row, so the duplicate is
        # written the way old data got there: without it (restored after --apply).
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute("DROP INDEX core_cross_mgr_one_active_per_employee")
        (newer,) = CrossCompanyManagerAssignment.objects.bulk_create(
            [
                CrossCompanyManagerAssignment(
                    employee=employee,
                    manager_profile=self.profile(self.cross_manager),
                    scope=scope,
                    start_at=timezone.now() - timedelta(days=1),
                    capabilities=legacy_capabilities,
                )
            ]
        )
        return employee, older, newer

    def _restore_constraint(self):
        from django.db import connection

        with connection.cursor() as cursor:
            # Flush deferred FK checks queued by the writes, then rebuild the index.
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS core_cross_mgr_one_active_per_employee "
                "ON core_crosscompanymanagerassignment (employee_id) WHERE is_active AND revoked_at IS NULL"
            )

    def test_dry_run_reports_without_writing_and_apply_enforces_cross_wins(self):
        employee, older, newer = self._legacy_data()

        dry = StringIO()
        call_command("consolidate_manager_relationships", format="json", stdout=dry)
        report = json.loads(dry.getvalue())
        self.assertEqual(report["summary"]["mode"], "dry-run")
        self.assertEqual(report["summary"]["duplicate_assignments_revoked"], 1)
        self.assertEqual(report["summary"]["direct_managers_cleared"], 1)
        self.assertEqual(self.active_assignments(employee).count(), 2)
        employee.refresh_from_db()
        self.assertIsNotNone(employee.manager_profile_id)

        applied = StringIO()
        call_command("consolidate_manager_relationships", "--apply", format="json", stdout=applied)
        self.assertEqual(json.loads(applied.getvalue())["summary"]["employees_still_needing_changes"], 0)
        self._restore_constraint()

        employee.refresh_from_db()
        older.refresh_from_db()
        newer.refresh_from_db()
        self.assertIsNone(employee.manager_profile_id)
        self.assertIsNone(employee.manager_id)
        self.assertFalse(older.is_active)
        self.assertTrue(newer.is_active)
        self.assertEqual(sorted(newer.capabilities), ALL_CAPABILITIES)
        self.assertEqual(get_effective_manager_profile(employee), self.profile(self.cross_manager))
        self.assertTrue(
            AuditLog.objects.filter(action="cross_company_manager_assignment_revoked", entity_id=str(older.id)).exists()
        )

        again = StringIO()
        call_command("consolidate_manager_relationships", "--apply", stdout=again)
        self.assertIn("Nothing to change", again.getvalue())
