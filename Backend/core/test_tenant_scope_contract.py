from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from core.delegation import get_active_employee_read_scope_ids
from core.models import CrossCompanyManagerAssignment, DelegationRule
from employees.models import EmployeeProfile
from employees.services.manager_relationships import manager_approval_actor_source
from leaves.models import LeaveRequest, LeaveType
from organization.models import OrganizationNode, OrganizationScope, OrganizationScopeMembership, UserOrganizationAccess

User = get_user_model()


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True,
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
)
class TenantScopeContractTests(APITestCase):
    def setUp(self):
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.company_a = OrganizationNode.objects.create(
            code="SCOPE_A", name="Scope A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.company_b = OrganizationNode.objects.create(
            code="SCOPE_B", name="Scope B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.scope = OrganizationScope.objects.create(code="SCOPE_AB", name="Approved scope")
        OrganizationScopeMembership.objects.create(scope=self.scope, company=self.company_a)
        OrganizationScopeMembership.objects.create(scope=self.scope, company=self.company_b)
        self.other_scope = OrganizationScope.objects.create(code="SCOPE_OTHER", name="Other scope")
        OrganizationScopeMembership.objects.create(scope=self.other_scope, company=self.company_a)

        self.hr = self._user("hr@scope-contract.test", self.company_a, "SCOPE-HR", is_hr=True)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company_a)
        self.source_manager = self._user("source@scope-contract.test", self.company_a, "SCOPE-SOURCE")
        self.delegate = self._user("delegate@scope-contract.test", self.company_b, "SCOPE-DELEGATE")
        self.employee_a = self._user("employee-a@scope-contract.test", self.company_a, "SCOPE-EMP-A")
        self.employee_b = self._user("employee-b@scope-contract.test", self.company_b, "SCOPE-EMP-B")
        self.company_c = OrganizationNode.objects.create(
            code="SCOPE_C", name="Scope C", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.employee_c = self._user("employee-c@scope-contract.test", self.company_c, "SCOPE-EMP-C")

    def _user(self, email, company, employee_id, *, is_hr=False):
        user = User.objects.create_user(email=email, password="StrongPass123!", full_name=employee_id)
        if is_hr:
            user.groups.add(self.hr_group)
        EmployeeProfile.objects.create(user=user, company=company, employee_id=employee_id, full_name=employee_id)
        return user

    def _scope_headers(self, scope=None):
        return {"HTTP_X_ORGANIZATION_SCOPE_ID": str((scope or self.scope).id)}

    def test_delegated_cross_company_employee_visibility_is_limited_to_approved_scope(self):
        grant = DelegationRule.objects.create(
            from_user=self.source_manager,
            to_user=self.delegate,
            scope=self.scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        self.client.force_authenticate(user=self.delegate)

        response = self.client.get("/api/employees/?page_size=100", **self._scope_headers())

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        items = response.data["data"].get("items", response.data["data"].get("results", []))
        returned_ids = {item["id"] for item in items}
        self.assertIn(self.employee_a.employee_profile.id, returned_ids)
        self.assertIn(self.employee_b.employee_profile.id, returned_ids)
        self.assertEqual(grant.scope_id, self.scope.id)

    def test_delegated_employee_read_grant_authorizes_list_detail_pagination_and_search_without_sensitive_fields(self):
        DelegationRule.objects.create(
            from_user=self.source_manager,
            to_user=self.delegate,
            scope=self.scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        profile = self.employee_a.employee_profile
        profile.mobile = "555111222"
        profile.passport_no = "P-SECRET"
        profile.national_id = "N-SECRET"
        profile.basic_salary = 9999
        profile.health_card = "HC-SECRET"
        profile.save()
        self.client.force_authenticate(user=self.delegate)

        listing = self.client.get("/api/employees/?page_size=1&search=SCOPE-EMP-A", **self._scope_headers())
        detail = self.client.get(f"/api/employees/{profile.id}/", **self._scope_headers())
        out_of_scope = self.client.get(f"/api/employees/{self.employee_c.employee_profile.id}/", **self._scope_headers())

        self.assertEqual(listing.status_code, status.HTTP_200_OK, listing.data)
        self.assertEqual(listing.data["data"]["count"], 1)
        self.assertEqual(detail.status_code, status.HTTP_200_OK, detail.data)
        self.assertEqual(out_of_scope.status_code, status.HTTP_404_NOT_FOUND)
        forbidden_fields = {
            "email", "mobile", "passport", "passport_no", "national_id", "health_card", "basic_salary",
            "total_salary", "leave_balances", "leave_balance_year", "created_at", "updated_at", "archived_at",
        }
        returned = detail.data["data"]
        self.assertFalse(forbidden_fields & set(returned), returned)
        self.assertEqual(returned["id"], profile.id)

    def test_cross_company_capabilities_are_per_workflow_and_team_visibility_is_not_approval(self):
        assignment = CrossCompanyManagerAssignment.objects.create(
            employee=self.employee_a.employee_profile,
            manager_profile=self.employee_b.employee_profile,
            scope=self.scope,
            capabilities=[CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        for capability in (
            CrossCompanyManagerAssignment.Capability.LEAVE_APPROVE,
            CrossCompanyManagerAssignment.Capability.ATTENDANCE_APPROVE,
            CrossCompanyManagerAssignment.Capability.LOAN_APPROVE,
            CrossCompanyManagerAssignment.Capability.ASSET_APPROVE,
            CrossCompanyManagerAssignment.Capability.ANNOUNCEMENT_MANAGE,
        ):
            self.assertIsNone(
                manager_approval_actor_source(self.employee_b, self.employee_a.employee_profile, capability=capability)
            )

        assignment.capabilities = [
            CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW,
            CrossCompanyManagerAssignment.Capability.LEAVE_APPROVE,
        ]
        assignment.save()
        self.assertEqual(
            manager_approval_actor_source(
                self.employee_b,
                self.employee_a.employee_profile,
                capability=CrossCompanyManagerAssignment.Capability.LEAVE_APPROVE,
            ),
            "cross_company_assignment",
        )
        self.assertIsNone(
            manager_approval_actor_source(
                self.employee_b,
                self.employee_a.employee_profile,
                capability=CrossCompanyManagerAssignment.Capability.LOAN_APPROVE,
            )
        )
        self.client.force_authenticate(user=self.employee_b)
        team = self.client.get("/api/employees/manager/team/?page_size=100", **self._scope_headers())
        self.assertEqual(team.status_code, status.HTTP_200_OK, team.data)
        team_item = team.data["data"]["results"][0]
        self.assertNotIn("mobile", team_item)
        self.assertNotIn("basic_salary", team_item)

    def test_scope_metadata_hides_expired_revoked_and_inactive_user_history(self):
        rule = DelegationRule.objects.create(
            from_user=self.source_manager,
            to_user=self.delegate,
            scope=self.scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        self.client.force_authenticate(user=self.delegate)
        visible = self.client.get("/api/core/organization-scopes/")
        self.assertEqual(visible.status_code, status.HTTP_200_OK)
        self.assertEqual({item["id"] for item in visible.data["data"]["items"]}, {self.scope.id})

        rule.is_active = False
        rule.revoked_at = timezone.now()
        rule.save(update_fields=["is_active", "revoked_at", "updated_at"])
        hidden = self.client.get("/api/core/organization-scopes/")
        self.assertEqual(hidden.data["data"]["items"], [])
        self.assertEqual(self.client.get("/api/core/cross-company-manager-assignments/").data["data"]["items"], [])

    def test_assignment_lifecycle_revokes_when_an_assigned_profile_or_user_becomes_invalid(self):
        assignment = CrossCompanyManagerAssignment.objects.create(
            employee=self.employee_a.employee_profile,
            manager_profile=self.employee_b.employee_profile,
            scope=self.scope,
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        # Database-trigger coverage: ordinary lifecycle changes revoke only the
        # exceptional edge; they do not alter the employee's direct manager link.
        EmployeeProfile.objects.filter(pk=self.employee_a.employee_profile.pk).update(is_archived=True)
        assignment.refresh_from_db()
        self.assertFalse(assignment.is_active)
        self.assertIsNotNone(assignment.revoked_at)

    def test_forged_conflicting_expired_and_revoked_scope_selectors_fail_closed(self):
        DelegationRule.objects.create(
            from_user=self.source_manager,
            to_user=self.delegate,
            scope=self.scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
            start_at=timezone.now() - timedelta(hours=2),
            end_at=timezone.now() - timedelta(minutes=1),
            created_by=self.hr,
        )
        self.client.force_authenticate(user=self.delegate)

        expired = self.client.get("/api/employees/?page_size=100", **self._scope_headers())
        expired_detail = self.client.get(
            f"/api/employees/{self.employee_a.employee_profile.id}/", **self._scope_headers()
        )
        forged = self.client.get("/api/employees/?page_size=100", **self._scope_headers(self.other_scope))
        conflict = self.client.get(
            f"/api/employees/?organization_scope_id={self.scope.id}", **self._scope_headers(self.other_scope)
        )

        self.assertEqual(expired.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(expired_detail.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(forged.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(conflict.status_code, status.HTTP_403_FORBIDDEN)

        grant = DelegationRule.objects.create(
            from_user=self.source_manager,
            to_user=self.delegate,
            scope=self.scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            is_active=False,
            revoked_at=timezone.now(),
            created_by=self.hr,
        )
        revoked = self.client.get("/api/employees/?page_size=100", **self._scope_headers())
        revoked_detail = self.client.get(
            f"/api/employees/{self.employee_a.employee_profile.id}/", **self._scope_headers()
        )
        self.assertEqual(revoked.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(revoked_detail.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(grant.is_active)

    def test_active_scope_membership_cannot_expand_employee_read_access(self):
        DelegationRule.objects.create(
            from_user=self.source_manager,
            to_user=self.delegate,
            scope=self.scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            OrganizationScopeMembership.objects.create(scope=self.scope, company=self.company_c)
        with self.assertRaises(IntegrityError), transaction.atomic():
            OrganizationScopeMembership.objects.filter(scope=self.scope, company=self.company_b).delete()

        self.client.force_authenticate(user=self.delegate)
        listing = self.client.get("/api/employees/?page_size=100", **self._scope_headers())
        self.assertEqual(listing.status_code, status.HTTP_200_OK, listing.data)
        returned_ids = {item["id"] for item in listing.data["data"]["results"]}
        self.assertNotIn(self.employee_c.employee_profile.id, returned_ids)

    def test_scope_membership_move_cannot_remove_company_from_protected_source_scope(self):
        DelegationRule.objects.create(
            from_user=self.source_manager,
            to_user=self.delegate,
            scope=self.scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )

        with self.assertRaises(IntegrityError), transaction.atomic():
            OrganizationScopeMembership.objects.filter(scope=self.scope, company=self.company_b).update(
                scope=self.other_scope
            )

        self.assertTrue(
            OrganizationScopeMembership.objects.filter(scope=self.scope, company=self.company_b).exists()
        )
        self.assertFalse(
            OrganizationScopeMembership.objects.filter(scope=self.other_scope, company=self.company_b).exists()
        )

    def test_scope_deactivate_reactivate_cannot_silently_restore_employee_read_access(self):
        grant = DelegationRule.objects.create(
            from_user=self.source_manager,
            to_user=self.delegate,
            scope=self.scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            OrganizationScope.objects.filter(pk=self.scope.pk).update(is_active=False)

        grant.is_active = False
        grant.revoked_at = timezone.now()
        grant.save(update_fields=["is_active", "revoked_at", "updated_at"])
        OrganizationScope.objects.filter(pk=self.scope.pk).update(is_active=False)
        OrganizationScope.objects.filter(pk=self.scope.pk).update(is_active=True)

        self.client.force_authenticate(user=self.delegate)
        response = self.client.get("/api/employees/?page_size=100", **self._scope_headers())
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_database_rejects_same_company_employee_read_grant_without_active_scope(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            DelegationRule.objects.create(
                from_user=self.source_manager,
                to_user=self.employee_a,
                capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
                start_at=timezone.now() - timedelta(minutes=1),
                end_at=timezone.now() + timedelta(hours=1),
                created_by=self.hr,
            )

    def test_employee_read_scope_resolver_fails_closed_for_a_legacy_invalid_delegate(self):
        grant = DelegationRule.objects.create(
            from_user=self.source_manager,
            to_user=self.delegate,
            scope=self.scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        User.objects.filter(pk=self.delegate.pk).update(is_active=False)

        # The trigger revokes it today. Mocking the pre-filter models an old row
        # that existed before lifecycle triggers were deployed; the resolver must
        # still reject that row itself.
        with patch("core.delegation._active_delegation_queryset", return_value=DelegationRule.objects.filter(pk=grant.pk)):
            self.assertEqual(get_active_employee_read_scope_ids(self.delegate), set())

    def test_delegation_lifecycle_revokes_archived_disabled_moved_and_unlinked_profiles(self):
        def create_delegate(label):
            user = self._user(f"{label}@scope-contract.test", self.company_b, f"SCOPE-{label.upper()}")
            rule = DelegationRule.objects.create(
                from_user=self.source_manager,
                to_user=user,
                scope=self.scope,
                capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
                start_at=timezone.now() - timedelta(minutes=1),
                end_at=timezone.now() + timedelta(hours=1),
                created_by=self.hr,
            )
            return user, rule

        archived_user, archived_rule = create_delegate("archived")
        EmployeeProfile.objects.filter(pk=archived_user.employee_profile.pk).update(is_archived=True)
        disabled_user, disabled_rule = create_delegate("disabled")
        User.objects.filter(pk=disabled_user.pk).update(is_active=False)
        moved_user, moved_rule = create_delegate("moved")
        EmployeeProfile.objects.filter(pk=moved_user.employee_profile.pk).update(company=self.company_c)
        unlinked_user, unlinked_rule = create_delegate("unlinked")
        EmployeeProfile.objects.filter(pk=unlinked_user.employee_profile.pk).update(user=None)

        for rule in (archived_rule, disabled_rule, moved_rule, unlinked_rule):
            rule.refresh_from_db()
            self.assertFalse(rule.is_active)
            self.assertIsNotNone(rule.revoked_at)

    def test_database_rejects_new_active_employee_read_grant_for_disabled_or_invalid_delegate(self):
        disabled_delegate = self._user("new-disabled@scope-contract.test", self.company_b, "SCOPE-NEW-DISABLED")
        User.objects.filter(pk=disabled_delegate.pk).update(is_active=False)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DelegationRule.objects.create(
                from_user=self.source_manager,
                to_user=disabled_delegate,
                scope=self.scope,
                capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
                start_at=timezone.now() - timedelta(minutes=1),
                end_at=timezone.now() + timedelta(hours=1),
                created_by=self.hr,
            )

    def test_view_only_or_expired_assignment_cannot_use_employee_or_workflow_endpoints(self):
        assignment = CrossCompanyManagerAssignment.objects.create(
            employee=self.employee_a.employee_profile,
            manager_profile=self.employee_b.employee_profile,
            scope=self.scope,
            capabilities=[CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW],
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        leave_type = LeaveType.objects.create(company=self.company_a, code="SCOPE-LV", name="Scope leave", annual_quota=21)
        leave = LeaveRequest.objects.create(
            employee=self.employee_a,
            employee_profile=self.employee_a.employee_profile,
            company=self.company_a,
            leave_type=leave_type,
            start_date=date(2026, 2, 1),
            end_date=date(2026, 2, 1),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )
        self.client.force_authenticate(user=self.employee_b)
        denied_approval = self.client.post(f"/api/leaves/manager/leave-requests/{leave.id}/approve/", {}, format="json")
        self.assertEqual(denied_approval.status_code, status.HTTP_404_NOT_FOUND)

        assignment.end_at = timezone.now() - timedelta(seconds=1)
        assignment.start_at = timezone.now() - timedelta(hours=1)
        assignment.save()
        list_response = self.client.get("/api/employees/?page_size=100", **self._scope_headers())
        detail_response = self.client.get(
            f"/api/employees/{self.employee_a.employee_profile.id}/", **self._scope_headers()
        )
        expired_approval = self.client.post(f"/api/leaves/manager/leave-requests/{leave.id}/approve/", {}, format="json")
        self.assertEqual(list_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(detail_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(expired_approval.status_code, status.HTTP_404_NOT_FOUND)

    def test_hr_can_create_cross_company_manager_assignment_without_changing_direct_manager(self):
        self.client.force_authenticate(user=self.hr)
        create = self.client.post(
            "/api/core/cross-company-manager-assignments/",
            {
                "employee_id": self.employee_a.employee_profile.id,
                "manager_profile_id": self.employee_b.employee_profile.id,
                "scope_id": self.scope.id,
                "start_at": (timezone.now() - timedelta(minutes=1)).isoformat(),
                "end_at": (timezone.now() + timedelta(hours=1)).isoformat(),
                "reason": "Temporary approved coverage",
            },
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )

        self.assertEqual(create.status_code, status.HTTP_201_CREATED, create.data)
        self.employee_a.employee_profile.refresh_from_db()
        self.assertIsNone(self.employee_a.employee_profile.manager_profile_id)
        self.assertEqual(CrossCompanyManagerAssignment.objects.count(), 1)

        self.client.force_authenticate(user=self.employee_b)
        team = self.client.get("/api/employees/manager/team/?page_size=100", **self._scope_headers())
        self.assertEqual(team.status_code, status.HTTP_200_OK, team.data)
        team_items = team.data["data"].get("items", team.data["data"].get("results", []))
        self.assertEqual({item["id"] for item in team_items}, {self.employee_a.employee_profile.id})

    def test_cross_company_manager_assignment_prevents_reporting_cycle(self):
        CrossCompanyManagerAssignment.objects.create(
            employee=self.employee_a.employee_profile,
            manager_profile=self.employee_b.employee_profile,
            scope=self.scope,
            start_at=timezone.now() - timedelta(minutes=1),
            end_at=timezone.now() + timedelta(hours=1),
            created_by=self.hr,
        )
        self.client.force_authenticate(user=self.hr)

        response = self.client.post(
            "/api/core/cross-company-manager-assignments/",
            {
                "employee_id": self.employee_b.employee_profile.id,
                "manager_profile_id": self.employee_a.employee_profile.id,
                "scope_id": self.scope.id,
                "start_at": timezone.now().isoformat(),
                "end_at": (timezone.now() + timedelta(hours=1)).isoformat(),
            },
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(CrossCompanyManagerAssignment.objects.count(), 1)
