from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from django.utils import timezone

from assets.models import Asset, AssetAssignment
from core.models import DelegationRule, RequestObligation, WorkflowDefinition, WorkflowInstance
from core.services import BUSINESS_TRIP_CODE, sync_leave_obligations
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import apply_hr_cancellation
from organization.models import OrganizationNode, OrganizationScope, OrganizationScopeMembership

User = get_user_model()


class BusinessTripObligationsTests(TestCase):
    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="BT-COMP",
            name="Business Trip Co",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.employee = User.objects.create_user(email="traveller@example.com", password="password")
        self.employee.groups.add(self.employee_group)
        self.delegate = User.objects.create_user(email="delegate@example.com", password="password")
        self.delegate.groups.add(self.employee_group)

        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="BT-EMP-001",
            full_name="Business Traveller",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.delegate,
            company=self.company,
            employee_id="BT-DELEGATE-001",
            full_name="Business Trip Delegate",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.business_trip_type = LeaveType.objects.create(
            company=self.company,
            name="Business Trip",
            code=BUSINESS_TRIP_CODE,
        )
        self.annual_type = LeaveType.objects.create(company=self.company, name="Annual", code="ANNUAL")

    def _leave(self, leave_type=None, **extra):
        start_date = timezone.localdate() + timedelta(days=10)
        defaults = {
            "employee": self.employee,
            "employee_profile": self.profile,
            "company": self.company,
            "leave_type": leave_type or self.business_trip_type,
            "start_date": start_date,
            "end_date": start_date + timedelta(days=3),
            "status": LeaveRequest.RequestStatus.PENDING_CEO,
            "reason": "Trip",
        }
        defaults.update(extra)
        return LeaveRequest.objects.create(**defaults)

    def test_normal_leave_creates_no_business_trip_obligations(self):
        leave_request = self._leave(leave_type=self.annual_type)

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        self.assertEqual(summary["total"], 0)
        self.assertFalse(RequestObligation.objects.filter(parent_object_id=leave_request.pk).exists())

    def test_business_trip_asset_obligation_resolves_after_assignment_return(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="Travel Laptop",
            type=Asset.AssetType.OTHER,
            status=Asset.AssetStatus.ASSIGNED,
            flexible_attributes={"category": "laptop"},
            must_return_before_travel=True,
        )
        assignment = AssetAssignment.objects.create(
            asset=asset,
            employee=self.profile,
            assigned_by=self.employee,
            is_active=True,
        )
        leave_request = self._leave()

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        self.assertEqual(summary["blocking_open"], 1)
        obligation = RequestObligation.objects.get(
            parent_object_id=leave_request.pk,
            type=RequestObligation.ObligationType.ASSET_RETURN,
        )
        self.assertEqual(obligation.status, RequestObligation.Status.OPEN)
        self.assertEqual(obligation.company, self.company)

        assignment.is_active = False
        assignment.returned_at = timezone.now()
        assignment.save(update_fields=["is_active", "returned_at", "updated_at"])
        asset.status = Asset.AssetStatus.AVAILABLE
        asset.save(update_fields=["status", "updated_at"])

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        obligation.refresh_from_db()
        self.assertEqual(summary["blocking_open"], 0)
        self.assertEqual(obligation.status, RequestObligation.Status.RESOLVED)

    def test_pending_approval_obligation_resolves_when_delegate_covers_trip(self):
        other_leave = self._leave(
            leave_type=self.annual_type,
            start_date=date.today() + timedelta(days=1),
            end_date=date.today() + timedelta(days=2),
        )
        definition = WorkflowDefinition.objects.create(
            key="business_trip_test",
            name="Business Trip Test",
            module_key="leaves",
        )
        WorkflowInstance.objects.create(
            definition=definition,
            content_type=ContentType.objects.get_for_model(LeaveRequest),
            object_id=other_leave.pk,
            status=WorkflowInstance.Status.IN_REVIEW,
            current_stage="manager",
            current_approver_role="manager",
            current_actor_user=self.employee,
            submitted_by=self.delegate,
        )
        leave_request = self._leave()

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        self.assertEqual(summary["blocking_open"], 1)
        obligation = RequestObligation.objects.get(
            parent_object_id=leave_request.pk,
            type=RequestObligation.ObligationType.PENDING_APPROVALS,
        )
        self.assertEqual(obligation.status, RequestObligation.Status.OPEN)

        leave_request.delegated_to = self.delegate
        leave_request.save(update_fields=["delegated_to", "updated_at"])

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        obligation.refresh_from_db()
        self.assertEqual(summary["blocking_open"], 0)
        self.assertEqual(obligation.status, RequestObligation.Status.RESOLVED)
        self.assertTrue(
            DelegationRule.objects.filter(
                from_user=self.employee,
                to_user=self.delegate,
                is_active=True,
            ).exists()
        )

    def test_employee_read_scope_does_not_count_as_trip_approval_coverage(self):
        other_leave = self._leave(
            leave_type=self.annual_type,
            start_date=date.today() + timedelta(days=1),
            end_date=date.today() + timedelta(days=2),
        )
        definition = WorkflowDefinition.objects.create(
            key="business_trip_read_scope_test",
            name="Business Trip Read Scope Test",
            module_key="leaves",
        )
        WorkflowInstance.objects.create(
            definition=definition,
            content_type=ContentType.objects.get_for_model(LeaveRequest),
            object_id=other_leave.pk,
            status=WorkflowInstance.Status.IN_REVIEW,
            current_stage="manager",
            current_approver_role="manager",
            current_actor_user=self.employee,
            submitted_by=self.delegate,
        )
        scope = OrganizationScope.objects.create(code="BT-READ-SCOPE", name="Business Trip Read Scope")
        OrganizationScopeMembership.objects.create(scope=scope, company=self.company)
        DelegationRule.objects.create(
            from_user=self.employee,
            to_user=self.delegate,
            start_at=timezone.now() - timedelta(days=1),
            end_at=timezone.now() + timedelta(days=20),
            scope=scope,
            capabilities=[DelegationRule.Capability.EMPLOYEE_READ],
        )
        leave_request = self._leave()

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        self.assertEqual(summary["blocking_open"], 1)
        self.assertTrue(
            RequestObligation.objects.filter(
                parent_object_id=leave_request.pk,
                type=RequestObligation.ObligationType.PENDING_APPROVALS,
                status=RequestObligation.Status.OPEN,
            ).exists()
        )

    def test_hr_cancellation_closes_obligations_and_ends_trip_delegation(self):
        hr_user = User.objects.create_user(email="trip-hr@example.com", password="password")
        leave_request = self._leave(delegated_to=self.delegate, status=LeaveRequest.RequestStatus.APPROVED)
        sync_leave_obligations(leave_request, actor=self.employee)
        RequestObligation.objects.create(
            company=self.company,
            parent_content_type=ContentType.objects.get_for_model(LeaveRequest),
            parent_object_id=leave_request.pk,
            type=RequestObligation.ObligationType.ASSET_RETURN,
            severity=RequestObligation.Severity.BLOCKING,
            title="Return laptop",
        )

        apply_hr_cancellation(leave_request, actor=hr_user, comment="Trip called off")

        leave_request.refresh_from_db()
        self.assertEqual(leave_request.status, LeaveRequest.RequestStatus.CANCELLED)
        trip_delegation = DelegationRule.objects.get(from_user=self.employee, to_user=self.delegate)
        self.assertFalse(trip_delegation.is_active)
        self.assertIsNotNone(trip_delegation.revoked_at)
        self.assertEqual(trip_delegation.revoked_by, hr_user)
        self.assertFalse(
            RequestObligation.objects.filter(
                parent_object_id=leave_request.pk, status=RequestObligation.Status.OPEN
            ).exists()
        )

    def test_replacing_business_trip_delegate_revokes_old_grant(self):
        from leaves.services import apply_delegate_assignment

        replacement = User.objects.create_user(email="trip-replacement@example.com", password="password")
        EmployeeProfile.objects.create(
            user=replacement,
            company=self.company,
            employee_id="BT-REPLACEMENT-001",
            full_name="Replacement Delegate",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        leave_request = self._leave(delegated_to=self.delegate)
        sync_leave_obligations(leave_request, actor=self.employee)
        old_rule = DelegationRule.objects.get(from_user=self.employee, to_user=self.delegate)

        apply_delegate_assignment(
            leave_request,
            actor=self.employee,
            delegated_to=replacement,
            note="Replacement for the trip",
        )

        old_rule.refresh_from_db()
        replacement_rule = DelegationRule.objects.get(from_user=self.employee, to_user=replacement)
        self.assertFalse(old_rule.is_active)
        self.assertIsNotNone(old_rule.revoked_at)
        self.assertEqual(old_rule.revoked_by, self.employee)
        self.assertTrue(replacement_rule.is_active)
        self.assertEqual(
            replacement_rule.source_reference,
            f"business_trip_leave:{leave_request.pk}:{replacement.pk}",
        )
        self.assertEqual(
            DelegationRule.objects.filter(
                source_reference__startswith=f"business_trip_leave:{leave_request.pk}:",
                is_active=True,
            ).count(),
            1,
        )

    def test_non_trip_sync_revokes_trip_generated_delegation(self):
        leave_request = self._leave(delegated_to=self.delegate)
        sync_leave_obligations(leave_request, actor=self.employee)
        rule = DelegationRule.objects.get(from_user=self.employee, to_user=self.delegate)
        leave_request.leave_type = self.annual_type

        sync_leave_obligations(leave_request, actor=self.employee)

        rule.refresh_from_db()
        self.assertFalse(rule.is_active)
        self.assertIsNotNone(rule.revoked_at)

    def test_cross_company_trip_delegate_does_not_create_general_approval_grant_without_scope(self):
        other_company = OrganizationNode.objects.create(
            code="BT-OTHER-COMP",
            name="Other Business Trip Co",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        other_delegate = User.objects.create_user(email="trip-other-delegate@example.com", password="password")
        EmployeeProfile.objects.create(
            user=other_delegate,
            company=other_company,
            employee_id="BT-OTHER-DEL-1",
            full_name="Other Company Delegate",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        leave_request = self._leave(delegated_to=other_delegate)

        sync_leave_obligations(leave_request, actor=self.employee)

        self.assertFalse(
            DelegationRule.objects.filter(from_user=self.employee, to_user=other_delegate, is_active=True).exists()
        )
